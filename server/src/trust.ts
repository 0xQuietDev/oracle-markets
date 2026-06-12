// ORACLE Trust Tuple — DESIGN §6.6 (the paid data product).
import type { Deployment } from "@oracle/shared/config";
import type { OracleDb } from "./db.js";

export type SettledWorkerTask = {
  pCutoffBps: number | null; // implied probability at betCutoff, bps; null => 10000 (self-stake only)
  outcome: "Yes" | "No";
  selfStake: bigint;
  reward: bigint;
};

export type TrustCore = {
  n: number;
  winRate: number;
  brier: number;
  ssr: number;
  forfeited: bigint; // USDC units of self-stake lost to skeptics, lifetime
};

export type Rep8004 = { count: number; sum: string } | null;
export type ReadSummary = (agentId: number) => Promise<Rep8004>;

export type TrustTuple = {
  agentId: number;
  agentRegistry: string; // eip155:<chainId>:<IdentityRegistry>
  n: number;
  p_live: { taskId: number; pBps: number }[];
  brier: string; // 4-decimal fixed string
  winRate: number;
  ssr: number;
  forfeited: string;
  rep8004: Rep8004;
};

export function computeTrustCore(tasks: SettledWorkerTask[]): TrustCore {
  const n = tasks.length;
  if (n === 0) return { n: 0, winRate: 0, brier: 0, ssr: 0, forfeited: 0n };
  let brierSum = 0;
  let wins = 0;
  let ssrSum = 0;
  let forfeited = 0n;
  for (const t of tasks) {
    const p = (t.pCutoffBps ?? 10_000) / 10_000;
    const o = t.outcome === "Yes" ? 1 : 0;
    brierSum += (p - o) ** 2;
    wins += o;
    ssrSum += Number(t.selfStake) / Number(t.reward);
    if (t.outcome === "No") forfeited += t.selfStake;
  }
  return { n, winRate: wins / n, brier: brierSum / n, ssr: ssrSum / n, forfeited };
}

export function settledInputsFor(db: OracleDb, agentId: number): SettledWorkerTask[] {
  return db.settledForWorker(agentId).map((r) => ({
    pCutoffBps: r.pCutoffBps,
    outcome: r.outcome as "Yes" | "No",
    selfStake: BigInt(r.selfStake ?? "0"),
    reward: BigInt(r.reward),
  }));
}

export async function buildTrustTuple(
  db: OracleDb,
  dep: Deployment,
  agentId: number,
  readSummary?: ReadSummary,
): Promise<TrustTuple> {
  const core = computeTrustCore(settledInputsFor(db, agentId));
  const p_live = db.openForWorker(agentId).map((t) => {
    const y = BigInt(t.yesPool);
    const n = BigInt(t.noPool);
    const total = y + n;
    return { taskId: t.taskId, pBps: total > 0n ? Number((y * 10_000n) / total) : 10_000 };
  });
  let rep8004: Rep8004 = null;
  if (readSummary) {
    try {
      rep8004 = await readSummary(agentId);
    } catch {
      rep8004 = null; // tolerate registry revert / RPC failure (DESIGN §6.6)
    }
  }
  return {
    agentId,
    agentRegistry: `eip155:${dep.chainId}:${dep.contracts.identityRegistry}`,
    n: core.n,
    p_live,
    brier: core.brier.toFixed(4),
    winRate: core.winRate,
    ssr: core.ssr,
    forfeited: core.forfeited.toString(),
    rep8004,
  };
}
