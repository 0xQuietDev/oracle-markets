// Shared bettor daemon harness (plan §5/C5). Strategy logic stays pure in
// strategies.ts; this file is thin polling/tx glue.
//
// Loop: poll free /v1/tasks every 3 s -> for each Open task before cutoff,
// pay x402 for /v1/markets/:id/odds (every bettor is a paying customer),
// run the strategy once, placeBet on-chain; after settlement, claim (try/catch).
import { PRICES, SERVER_URL } from "@oracle/shared";
import {
  approveUsdcOnce,
  getTask,
  keyFor,
  makeClients,
  sleep,
  writeOracle,
  type Clients,
  type Role,
} from "./chain.js";
import { makePaidFetch } from "./payments.js";
import type { Decision } from "./strategies.js";

export type NormalizedTask = {
  taskId: number;
  state: string;
  workerAgentId: number;
  reward: bigint;
  selfStake: bigint;
  acceptedAt: number;
  betCutoff: number;
};

export type BettorContext = {
  c: Clients;
  agentId: number;
  serverUrl: string;
  paidFetch: typeof fetch;
};

export type DecideFn = (
  ctx: BettorContext,
  task: NormalizedTask,
  allTasks: NormalizedTask[],
  odds: { pBps: number },
) => Promise<Decision> | Decision;

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const big = (v: unknown): bigint => {
  if (typeof v === "bigint") return v;
  if (v == null || v === "") return 0n;
  return BigInt(String(v));
};

/** Accepts camelCase (protocol §2.5) and snake_case rows defensively. */
export function normalizeTaskRow(row: Record<string, unknown>): NormalizedTask {
  return {
    taskId: num(row.taskId ?? row.task_id),
    state: String(row.state ?? ""),
    workerAgentId: num(row.workerAgentId ?? row.worker_agent_id),
    reward: big(row.reward),
    selfStake: big(row.selfStake ?? row.self_stake),
    acceptedAt: num(row.acceptedAt ?? row.accepted_at),
    betCutoff: num(row.betCutoff ?? row.bet_cutoff),
  };
}

export async function fetchTasks(serverUrl: string): Promise<NormalizedTask[]> {
  const res = await fetch(`${serverUrl}/v1/tasks`);
  if (!res.ok) throw new Error(`GET /v1/tasks -> ${res.status}`);
  const body = (await res.json()) as unknown;
  const rows = Array.isArray(body) ? body : ((body as { tasks?: unknown[] }).tasks ?? []);
  return (rows as Record<string, unknown>[]).map(normalizeTaskRow);
}

async function fetchOdds(ctx: BettorContext, taskId: number): Promise<{ pBps: number }> {
  const res = await ctx.paidFetch(`${ctx.serverUrl}/v1/markets/${taskId}/odds`);
  if (!res.ok) throw new Error(`paid GET /odds(${taskId}) -> ${res.status}`);
  const j = (await res.json()) as Record<string, unknown>;
  return { pBps: num(j.p_bps ?? j.pBps) };
}

export async function runBettor(opts: {
  role: Extract<Role, "bettorRep" | "bettorSkeptic" | "bettorMirror">;
  decide: DecideFn;
  /** Optional pre-action delay (mirror waits half the remaining window). */
  delayMsFor?: (task: NormalizedTask, nowMs: number) => number;
  pollMs?: number;
}): Promise<never> {
  const c = makeClients(opts.role);
  const entry = c.deployment.agents[opts.role];
  if (!entry) throw new Error(`agents.${opts.role} missing from deployment JSON — run register-agents first`);
  const ctx: BettorContext = {
    c,
    agentId: entry.agentId,
    serverUrl: SERVER_URL,
    paidFetch: makePaidFetch(c.deployment, keyFor(opts.role)),
  };
  await approveUsdcOnce(c);
  console.log(`[${opts.role}] agentId=${ctx.agentId} addr=${c.account.address} watching ${ctx.serverUrl}/v1/tasks (odds price ${PRICES.odds} units)`);

  const acted = new Set<number>(); // decided (bet or abstain) once per task
  const betOn = new Set<number>();
  const claimed = new Set<number>();
  const firstSeenMs = new Map<number, number>();

  for (;;) {
    try {
      const tasks = await fetchTasks(ctx.serverUrl);
      const nowSec = Math.floor(Date.now() / 1000);

      for (const task of tasks) {
        if (task.state !== "Open" || acted.has(task.taskId)) continue;
        if (task.betCutoff !== 0 && task.betCutoff <= nowSec + 2) continue; // too late to land a tx
        if (!firstSeenMs.has(task.taskId)) firstSeenMs.set(task.taskId, Date.now());
        const delay = opts.delayMsFor?.(task, firstSeenMs.get(task.taskId)!) ?? 0;
        if (Date.now() < firstSeenMs.get(task.taskId)! + delay) continue;

        // x402-paid odds read — every bettor is a customer of the feed
        const odds = await fetchOdds(ctx, task.taskId);
        const decision = await opts.decide(ctx, task, tasks, odds);
        acted.add(task.taskId);
        if (decision.action === "abstain") {
          console.log(`[${opts.role}] task ${task.taskId}: abstain (p=${odds.pBps}bps)`);
          continue;
        }
        console.log(
          `[${opts.role}] task ${task.taskId}: bet ${decision.side === 0 ? "YES" : "NO"} ${decision.amount} units (p=${odds.pBps}bps)`,
        );
        try {
          await writeOracle(c, "placeBet", [
            BigInt(task.taskId),
            BigInt(ctx.agentId),
            decision.side,
            decision.amount,
          ]);
          betOn.add(task.taskId);
        } catch (err) {
          console.error(`[${opts.role}] placeBet(${task.taskId}) failed:`, (err as Error).message);
        }
      }

      // claims after settlement
      for (const task of tasks) {
        if (!betOn.has(task.taskId) || claimed.has(task.taskId)) continue;
        if (task.state !== "Settled") continue;
        claimed.add(task.taskId);
        try {
          await writeOracle(c, "claim", [BigInt(task.taskId)]);
          console.log(`[${opts.role}] claimed task ${task.taskId}`);
        } catch (err) {
          // NothingToClaim is the normal losing-side outcome
          console.log(`[${opts.role}] claim(${task.taskId}) reverted (likely NothingToClaim):`, (err as Error).message);
        }
      }
    } catch (err) {
      console.error(`[${opts.role}] tick error:`, (err as Error).message);
    }
    await sleep(opts.pollMs ?? 3000);
  }
}

/** Settled-task count for a worker, derived from the free task list. */
export function settledCountFor(all: NormalizedTask[], workerAgentId: number): number {
  return all.filter((t) => t.workerAgentId === workerAgentId && t.state === "Settled").length;
}

// Re-exported so daemons can read on-chain task facts if the server lags.
export { getTask };
