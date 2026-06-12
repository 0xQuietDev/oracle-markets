// Demo driver (plan §5/C5): acts as the CLIENT (anvil index 1).
//
//   tsx src/cli/demo.ts [--task a|b] [--both] [--assert]
//
// Approves USDC, creates the task (reward 100e6, deadline = now +
// bettingWindow + 600, specHash = keccak256 of the spec JSON bytes fetched
// from the server), waits for OutcomeResolved, prints the settlement table
// (outcome, viaRule, score, pools, previewPayout for every fleet wallet +
// client) and then the Claimed events as the fleet collects.
//
// With --assert: exit non-zero unless A => Yes via rule 2 score 100 and
// B => No via rule 3 score <= 50.
import { keccak256 } from "viem";
import { ORACLE_CORE_ABI, OUTCOME, SERVER_URL } from "@oracle/shared";
import {
  approveUsdcOnce,
  getTask,
  makeClients,
  sleep,
  stateName,
  type Clients,
} from "../lib/chain.js";

type TaskKind = "a" | "b";
const SPEC_FILES: Record<TaskKind, string> = {
  a: "task-a-slugify.json",
  b: "task-b-nextbusinessday.json",
};
const REWARD = 100_000_000n; // 100 USDC
const CLAIM_WAIT_MS = Number(process.env.DEMO_CLAIM_WAIT_MS ?? 20_000);

type SettlementSummary = { outcome: number; viaRule: number; validatorScore: number };

function parseArgs(argv: string[]): { kinds: TaskKind[]; assert: boolean } {
  const kinds: TaskKind[] = [];
  let assert = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--both") kinds.push("a", "b");
    else if (argv[i] === "--assert") assert = true;
    else if (argv[i] === "--task") {
      const v = argv[++i];
      if (v !== "a" && v !== "b") throw new Error(`--task expects a|b, got "${v}"`);
      kinds.push(v);
    }
  }
  if (kinds.length === 0) kinds.push("a");
  return { kinds, assert };
}

const fmtUsdc = (v: bigint) => `${(Number(v) / 1e6).toFixed(6).replace(/\.?0+$/, "")} USDC`;

async function runTask(c: Clients, kind: TaskKind): Promise<SettlementSummary> {
  const dep = c.deployment;
  const worker = dep.agents.worker;
  const validator = dep.agents.validator;
  if (!worker || !validator) throw new Error("agents map incomplete — run register-agents first");

  // spec bytes from the server are the canonical hash input
  const specURI = `${SERVER_URL}/specs/${SPEC_FILES[kind]}`;
  const specRes = await fetch(specURI);
  if (!specRes.ok) throw new Error(`GET ${specURI} -> ${specRes.status}`);
  const specBytes = new Uint8Array(await specRes.arrayBuffer());
  const specHash = keccak256(specBytes);

  const nowChain = (await c.publicClient.getBlock()).timestamp;
  const deadline = nowChain + BigInt(dep.params.bettingWindow + 600);

  const { result: taskId, request } = await c.publicClient.simulateContract({
    account: c.account,
    address: dep.contracts.oracleCore,
    abi: ORACLE_CORE_ABI,
    functionName: "createTask",
    args: [BigInt(worker.agentId), BigInt(validator.agentId), REWARD, deadline, specHash, specURI],
  });
  const hash = await c.walletClient.writeContract(request);
  const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
  console.log(`\n=== Task ${kind.toUpperCase()} created: taskId=${taskId} reward=${fmtUsdc(REWARD)} deadline=${deadline} (block ${receipt.blockNumber}) ===`);

  // wait for settlement (fleet does everything autonomously)
  const settleTimeoutMs =
    (dep.params.bettingWindow + 600 + dep.params.disputeWindow + dep.params.graceWindow + 300) * 1000;
  const startMs = Date.now();
  for (;;) {
    const t = await getTask(c, BigInt(taskId));
    if (stateName(t.state) === "Settled") break;
    if (Date.now() - startMs > settleTimeoutMs) throw new Error(`task ${taskId} did not settle in time`);
    await sleep(2000);
  }

  const resolved = await c.publicClient.getContractEvents({
    address: dep.contracts.oracleCore,
    abi: ORACLE_CORE_ABI,
    eventName: "OutcomeResolved",
    args: { taskId },
    fromBlock: receipt.blockNumber,
    toBlock: "latest",
  });
  const ev = resolved[0]?.args as
    | { outcome?: number; viaRule?: number; validatorScore?: number }
    | undefined;
  const t = await getTask(c, BigInt(taskId));
  const summary: SettlementSummary = {
    outcome: ev?.outcome ?? t.outcome,
    viaRule: ev?.viaRule ?? -1,
    validatorScore: ev?.validatorScore ?? 0,
  };

  console.log(`\n--- Settlement: taskId=${taskId} ---`);
  console.log(`outcome=${OUTCOME[summary.outcome]} viaRule=R${summary.viaRule} validatorScore=${summary.validatorScore}`);
  console.log(`pools: YES=${fmtUsdc(t.yesPool)} NO=${fmtUsdc(t.noPool)} selfStake=${fmtUsdc(t.selfStake)}`);

  const wallets: [string, `0x${string}`][] = [
    ...Object.entries(dep.agents).map(([name, a]) => [name, a.address] as [string, `0x${string}`]),
    ["client", c.account.address],
  ];
  console.log("previewPayout:");
  for (const [name, addr] of wallets) {
    const payout = (await c.publicClient.readContract({
      address: dep.contracts.oracleCore,
      abi: ORACLE_CORE_ABI,
      functionName: "previewPayout",
      args: [taskId, addr],
    })) as bigint;
    console.log(`  ${name.padEnd(14)} ${addr}  ${fmtUsdc(payout)}`);
  }

  // observe claims as the fleet collects
  console.log(`\nobserving Claimed events for ${CLAIM_WAIT_MS / 1000}s...`);
  const seen = new Set<string>();
  const claimDeadline = Date.now() + CLAIM_WAIT_MS;
  while (Date.now() < claimDeadline) {
    const claims = await c.publicClient.getContractEvents({
      address: dep.contracts.oracleCore,
      abi: ORACLE_CORE_ABI,
      eventName: "Claimed",
      args: { taskId },
      fromBlock: receipt.blockNumber,
      toBlock: "latest",
    });
    for (const cl of claims) {
      const a = cl.args as { account?: `0x${string}`; amount?: bigint };
      const key = `${a.account}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const who = wallets.find(([, addr]) => addr.toLowerCase() === a.account?.toLowerCase())?.[0] ?? "unknown";
      console.log(`  Claimed: ${who.padEnd(14)} ${a.account} ${fmtUsdc(a.amount ?? 0n)}`);
    }
    await sleep(2000);
  }
  return summary;
}

function assertExpectation(kind: TaskKind, s: SettlementSummary): string | null {
  if (kind === "a") {
    if (OUTCOME[s.outcome] === "Yes" && s.viaRule === 2 && s.validatorScore === 100) return null;
    return `Task A expected Yes/R2/score 100, got ${OUTCOME[s.outcome]}/R${s.viaRule}/score ${s.validatorScore}`;
  }
  if (OUTCOME[s.outcome] === "No" && s.viaRule === 3 && s.validatorScore <= 50) return null;
  return `Task B expected No/R3/score<=50, got ${OUTCOME[s.outcome]}/R${s.viaRule}/score ${s.validatorScore}`;
}

async function main() {
  const { kinds, assert } = parseArgs(process.argv.slice(2));
  const c = makeClients("client");
  await approveUsdcOnce(c);
  console.log(`[demo] client=${c.account.address} tasks=[${kinds.join(", ")}] assert=${assert}`);

  const failures: string[] = [];
  for (const kind of kinds) {
    const summary = await runTask(c, kind);
    const failure = assertExpectation(kind, summary);
    if (failure) {
      console.error(`[demo] ASSERTION ${assert ? "FAILED" : "(informational) failed"}: ${failure}`);
      failures.push(failure);
    } else {
      console.log(`[demo] task ${kind.toUpperCase()} settled exactly as scripted.`);
    }
  }
  if (assert && failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
