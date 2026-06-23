// Worker daemon — DESIGN §8.3 loop with DR-6 path (b).
//
// TaskCreated(worker=me) -> fetch specURI (free) -> estimateConfidence ->
// acceptAndStake -> wait betCutoff (block timestamps) -> x402-buy vendor input
// -> solve via solver registry -> POST /artifacts (deliverable = standalone
// solver module source) -> x402-pay validator intake -> submitDelivery ->
// ValidationRegistry.validationRequest (worker calls it itself, DR-6 path b).
// After OutcomeResolved: claim (try/catch).
import { encodeAbiParameters, keccak256, stringToBytes, type Hex } from "viem";
import { ORACLE_CORE_ABI, PORTS, SERVER_URL } from "@oracle/shared";
import {
  approveUsdcOnce,
  getTask,
  keyFor,
  makeClients,
  stateName,
  waitForTimestamp,
  watchOracleEvent,
  writeOracle,
  writeValidationRegistry,
} from "./lib/chain.js";
import {
  estimateConfidence,
  fnNameFromSpec,
  stakeFor,
  templateFromSpecURI,
  type TaskSpec,
} from "./lib/confidence.js";
import { deliverableSource, hasSolver } from "./lib/deliverables.js";
import { makePaidFetch } from "./lib/payments.js";
import { reportActivity } from "./lib/report.js";
import { llmEnabled, GEMINI_MODEL } from "./mastra/model.js";
import { llmConfidence, llmSolution } from "./mastra/agents.js";

const WORKER_AGENT = "ORACLE Worker";

const VENDOR_URL = process.env.ORACLE_VENDOR_URL ?? `http://localhost:${PORTS.vendor}`;
const VALIDATOR_INTAKE_URL =
  process.env.ORACLE_VALIDATOR_INTAKE_URL ?? `http://localhost:${PORTS.validatorIntake}`;

async function main() {
  const c = makeClients("worker");
  const entry = c.deployment.agents.worker;
  if (!entry) throw new Error("agents.worker missing from deployment JSON — run register-agents first");
  const myAgentId = BigInt(entry.agentId);
  const paidFetch = makePaidFetch(c.deployment, keyFor("worker"));
  await approveUsdcOnce(c);
  console.log(`[worker] agentId=${myAgentId} addr=${c.account.address}`);

  const inFlight = new Set<string>();
  const claimedTasks = new Set<string>();
  const mine = (addr: string) => addr.toLowerCase() === c.account.address.toLowerCase();

  // Single resumable entry point: drive a task forward from whatever on-chain
  // state it is currently in. Both live events and reconcile() funnel here, so a
  // crash mid-flow is recovered by re-deriving the next action from chain state
  // rather than from the (already consumed) TaskCreated event.
  async function driveTask(taskId: bigint): Promise<void> {
    const key = taskId.toString();
    if (inFlight.has(key)) return; // a concurrent run owns it; reconcile retries later
    inFlight.add(key);
    try {
      const t = await getTask(c, taskId);
      const st = stateName(t.state);
      switch (st) {
        case "Created":
          await acceptIfMine(taskId, t);
          break;
        case "Open":
        case "Executing":
          // We staked on this task (acceptAndStake succeeded) but a crash may
          // have happened before we delivered. Resume execute -> deliver ->
          // validationRequest if it's ours and not yet delivered.
          if (mine(t.workerWallet) && t.deliveredAt === 0n) {
            await executeAndDeliver(taskId, t);
          }
          break;
        case "Settled":
          if (mine(t.workerWallet)) await maybeClaim(taskId, t);
          break;
        default:
          break; // None / Delivered (validator's turn) / Cancelled — nothing to do
      }
    } catch (err) {
      console.error(`[worker] task ${taskId} drive failed:`, (err as Error).message);
    } finally {
      // Always release so the next reconcile/event can retry after a failure.
      inFlight.delete(key);
    }
  }

  // state Created: evaluate confidence, then acceptAndStake (the original step 1-2).
  async function acceptIfMine(taskId: bigint, t: Awaited<ReturnType<typeof getTask>>): Promise<void> {
      // Autonomous job board: take a task if it's pre-assigned to me OR it's an
      // OPEN job (workerAgentId == 0) that I choose to claim. Anything assigned
      // to a different worker is not mine.
      const isOpen = t.workerAgentId === 0n;
      if (!isOpen && t.workerAgentId !== myAgentId) return;

      // 1. fetch spec (free — it markets the paid endpoints)
      const specRes = await fetch(t.specURI);
      if (!specRes.ok) throw new Error(`GET spec ${t.specURI} -> ${specRes.status}`);
      const spec = (await specRes.json()) as TaskSpec;
      const template = spec.template ?? templateFromSpecURI(t.specURI);
      const fnName = fnNameFromSpec(spec);
      // With a real LLM the worker can attempt any task it can write code for;
      // offline it is limited to templates with a canned solver.
      if (!llmEnabled() && !hasSolver(template)) {
        console.log(`[worker] task ${taskId}: no solver for template "${template}" — not accepting`);
        return;
      }
      if (llmEnabled() && !fnName) {
        console.log(`[worker] task ${taskId}: spec has no parseable fn name — not accepting`);
        return;
      }

      // 2. assess confidence -> stake -> accept (acceptance IS a bet on yourself)
      let conf: number;
      let confSource: "gemini" | "rule" = "rule";
      let confReasoning = "";
      if (llmEnabled()) {
        try {
          const a = await llmConfidence(spec);
          conf = a.confidence;
          confSource = "gemini";
          confReasoning = a.reasoning;
          console.log(`[worker] task ${taskId}: [${GEMINI_MODEL}] confidence=${conf.toFixed(2)} — ${a.reasoning}`);
        } catch (err) {
          conf = estimateConfidence(spec);
          confReasoning = `deterministic confidence estimate (LLM failed: ${(err as Error).message})`;
          console.error(`[worker] task ${taskId}: LLM confidence failed (${(err as Error).message}); using rule`);
        }
      } else {
        conf = estimateConfidence(spec);
        confReasoning = "deterministic confidence estimate (offline)";
      }
      reportActivity({
        taskId: Number(taskId),
        agent: WORKER_AGENT,
        role: "worker",
        kind: "confidence",
        text: `${isOpen ? "Considering open job — " : ""}${confReasoning}`,
        confidence: conf,
        source: confSource,
      });

      // Honest job selection: decline a job I'd almost certainly fail rather than
      // burn a self-stake on it. (Floor matches the min self-stake ratio.)
      const FLOOR = 0.1;
      if (conf < FLOOR) {
        console.log(`[worker] task ${taskId}: declining (confidence ${conf.toFixed(2)} < ${FLOOR})`);
        reportActivity({
          taskId: Number(taskId),
          agent: WORKER_AGENT,
          role: "worker",
          kind: "info",
          text: `Passed on this job — confidence ${(conf * 100).toFixed(0)}% is too low to stake on.`,
          source: confSource,
        });
        return;
      }

      const stake = stakeFor(t.reward, conf);
      console.log(`[worker] task ${taskId}: ${isOpen ? "claiming open job " : ""}template=${template} conf=${conf} stake=${stake} units`);
      try {
        await writeOracle(c, "acceptAndStake", [taskId, myAgentId, stake]);
      } catch (err) {
        // On an open job another worker may have claimed it first (WrongState).
        const msg = (err as Error).message;
        if (isOpen && /WrongState|reverted/.test(msg)) {
          console.log(`[worker] task ${taskId}: open job already claimed by another worker — skipping`);
          return;
        }
        throw err;
      }
      reportActivity({
        taskId: Number(taskId),
        agent: WORKER_AGENT,
        role: "worker",
        kind: "accept",
        text: `Accepted task and staked ${stake} units on myself`,
        amount: stake.toString(),
      });

      // Flow straight into execution. If we crash anywhere below, reconcile()
      // will find this task in Open/Executing and re-enter executeAndDeliver().
      const accepted = await getTask(c, taskId);
      await executeAndDeliver(taskId, accepted);
  }

  // state Open/Executing (mine, not yet delivered): the original steps 3-7.
  // Each external write is guarded so a re-entry after a crash does not
  // double-submit (deliveredAt re-checked before submit; intermediate failures
  // are logged-and-continued).
  async function executeAndDeliver(
    taskId: bigint,
    t0: Awaited<ReturnType<typeof getTask>>,
  ): Promise<void> {
      const spec = (await (await fetch(t0.specURI)).json()) as TaskSpec;
      const template = spec.template ?? templateFromSpecURI(t0.specURI);
      const fnName = fnNameFromSpec(spec);

      // 3. market freeze — wait out the betting window on chain time
      console.log(`[worker] task ${taskId}: resuming execution, betCutoff=${t0.betCutoff}`);
      await waitForTimestamp(c, t0.betCutoff);

      // Re-check we still own delivery rights (idempotency: another resume path
      // or a prior run may have already delivered between the wait and here).
      const t = await getTask(c, taskId);
      if (t.deliveredAt !== 0n) {
        console.log(`[worker] task ${taskId}: already delivered — skipping execute`);
        return;
      }
      if (!mine(t.workerWallet)) return;

      // 4. buy task input from the vendor over x402 (pillar: agents pay)
      try {
        const inputRes = await paidFetch(`${VENDOR_URL}/v1/input`);
        const input = inputRes.ok ? await inputRes.json() : null;
        console.log(`[worker] task ${taskId}: bought vendor input:`, input);
      } catch (err) {
        console.error(`[worker] vendor input purchase failed (continuing):`, (err as Error).message);
      }

      // 5. produce deliverable = standalone module source.
      //    Real mode: Gemini writes the solution. Fallback: canned solver (if any).
      let source: string;
      let solSource: "gemini" | "rule" = "rule";
      if (llmEnabled()) {
        try {
          source = await llmSolution(spec, fnName);
          solSource = "gemini";
          console.log(`[worker] task ${taskId}: [${GEMINI_MODEL}] wrote ${source.length}-char solution for ${fnName}()`);
        } catch (err) {
          if (!hasSolver(template)) throw err;
          source = deliverableSource(template);
          console.error(`[worker] task ${taskId}: LLM solution failed (${(err as Error).message}); using canned solver`);
        }
      } else {
        source = deliverableSource(template);
      }
      reportActivity({
        taskId: Number(taskId),
        agent: WORKER_AGENT,
        role: "worker",
        kind: "solution",
        text:
          solSource === "gemini"
            ? `Wrote ${source.length}-char solution for ${fnName}()`
            : `Used canned ${template} solver for ${fnName}()`,
        code: source,
        source: solSource,
      });
      const deliverableHash = keccak256(stringToBytes(source));
      const upload = await fetch(`${SERVER_URL}/artifacts`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: source,
      });
      if (!upload.ok) throw new Error(`POST /artifacts -> ${upload.status}`);
      const { uri: evidenceURI } = (await upload.json()) as { uri: string; hash?: string };
      console.log(`[worker] task ${taskId}: artifact at ${evidenceURI} hash=${deliverableHash}`);

      // 6. pay the validator's x402 intake fee (pillar: agent pays agent)
      try {
        const intake = await paidFetch(`${VALIDATOR_INTAKE_URL}/v1/validate-intake`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId: Number(taskId), evidenceURI }),
        });
        console.log(`[worker] task ${taskId}: validator intake paid -> ${intake.status}`);
      } catch (err) {
        console.error(`[worker] validator intake payment failed (continuing):`, (err as Error).message);
      }

      // 7. DR-6 path (b): file the validation request BEFORE submitDelivery —
      // the validator triggers on DeliverySubmitted, so the request must already
      // exist or a fast validator races into RequestNotFound. The hash binds the
      // request to this exact delivery either way.
      const requestHash: Hex = keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "bytes32" }],
          [taskId, deliverableHash],
        ),
      );
      await writeValidationRegistry(c, "validationRequest", [
        t.validatorWallet,
        myAgentId,
        evidenceURI,
        requestHash,
      ]);
      await writeOracle(c, "submitDelivery", [taskId, deliverableHash, evidenceURI]);
      console.log(`[worker] task ${taskId}: validationRequest filed (${requestHash}), delivered`);
      reportActivity({
        taskId: Number(taskId),
        agent: WORKER_AGENT,
        role: "worker",
        kind: "deliver",
        text: `Delivered solution and filed validation request`,
      });
  }

  // state Settled (mine, unclaimed): claim reward + stake. Errors here propagate
  // to driveTask, which logs and retries on the next reconcile.
  async function maybeClaim(taskId: bigint, t?: Awaited<ReturnType<typeof getTask>>): Promise<void> {
    const key = taskId.toString();
    if (claimedTasks.has(key)) return;
    if (!t) t = await getTask(c, taskId);
    if (t.workerWallet.toLowerCase() !== c.account.address.toLowerCase()) return;
    claimedTasks.add(key);
    try {
      await writeOracle(c, "claim", [taskId]);
      console.log(`[worker] claimed task ${taskId}`);
      reportActivity({
        taskId: Number(taskId),
        agent: WORKER_AGENT,
        role: "worker",
        kind: "claim",
        text: `Claimed reward + stake for task ${taskId}`,
        amount: t.reward.toString(),
      });
    } catch (err) {
      // Could be a real revert (lost stake / NothingToClaim) or a transient RPC
      // error. Release so the next reconcile can retry; a genuine NothingToClaim
      // simply reverts again, harmlessly.
      claimedTasks.delete(key);
      console.log(`[worker] claim(${taskId}) reverted (lost stake / NothingToClaim):`, (err as Error).message);
    }
  }

  // Consider every TaskCreated — driveTask() decides whether to take it
  // (mine if pre-assigned, or an OPEN job I choose to claim).
  const mineOrOpen = (workerAgentId: bigint) => workerAgentId === myAgentId || workerAgentId === 0n;

  // ---------------------------------------------------------------------------
  // reconcile(): the crash-safety core. Scan every task id [0, nextTaskId) and
  // re-drive any that is mine — derived from current on-chain state, NOT from a
  // (possibly already-consumed) event. Runs once on boot and then on a timer, so
  // a handler that died mid-flow is resumed on the next tick / restart.
  //
  // "Mine" is decided per state inside driveTask: Created -> mine-or-open job;
  // Open/Executing/Settled -> workerWallet == me. We scan the whole id range
  // (getTask on an unused id returns state None, which driveTask ignores) — the
  // simplest correct approach using only existing helpers.
  // ---------------------------------------------------------------------------
  async function reconcile(): Promise<void> {
    let next: bigint;
    try {
      next = (await c.publicClient.readContract({
        address: c.deployment.contracts.oracleCore,
        abi: ORACLE_CORE_ABI,
        functionName: "nextTaskId",
      })) as bigint;
    } catch (err) {
      console.error("[worker] reconcile: nextTaskId read failed:", (err as Error).message);
      return;
    }
    for (let id = 0n; id < next; id++) {
      try {
        const t = await getTask(c, id);
        const st = stateName(t.state);
        // Cheap pre-filter: only spend a driveTask slot on tasks that are
        // plausibly mine, to avoid scanning effort on other workers' jobs.
        const relevant =
          (st === "Created" && mineOrOpen(t.workerAgentId)) ||
          ((st === "Open" || st === "Executing" || st === "Settled") && mine(t.workerWallet));
        if (relevant) await driveTask(id);
      } catch (err) {
        console.error(`[worker] reconcile: task ${id} failed:`, (err as Error).message);
      }
    }
  }

  // Live watchers funnel into the same resumable driveTask handler.
  watchOracleEvent(c, "TaskCreated", (logs) => {
    for (const log of logs) {
      if (mineOrOpen(log.args.workerAgentId as bigint)) void driveTask(log.args.taskId as bigint);
    }
  });
  watchOracleEvent(c, "OutcomeResolved", (logs) => {
    for (const log of logs) void driveTask(log.args.taskId as bigint);
  });

  // Boot reconcile (catch up + resume in-flight) then periodic self-heal.
  await reconcile();
  setInterval(() => void reconcile(), 20_000);
  console.log("[worker] watching TaskCreated / OutcomeResolved + reconcile every 20s");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
