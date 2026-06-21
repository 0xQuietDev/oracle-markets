// Worker daemon — DESIGN §8.3 loop with DR-6 path (b).
//
// TaskCreated(worker=me) -> fetch specURI (free) -> estimateConfidence ->
// acceptAndStake -> wait betCutoff (block timestamps) -> x402-buy vendor input
// -> solve via solver registry -> POST /artifacts (deliverable = standalone
// solver module source) -> x402-pay validator intake -> submitDelivery ->
// ValidationRegistry.validationRequest (worker calls it itself, DR-6 path b).
// After OutcomeResolved: claim (try/catch).
import { encodeAbiParameters, keccak256, stringToBytes, type Hex } from "viem";
import { PORTS, SERVER_URL } from "@oracle/shared";
import {
  approveUsdcOnce,
  getOracleEvents,
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

  async function handleTask(taskId: bigint): Promise<void> {
    const key = taskId.toString();
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const t = await getTask(c, taskId);
      if (stateName(t.state) !== "Created") return; // already accepted / stale event
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
        inFlight.delete(key);
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

      // 3. market freeze — wait out the betting window on chain time
      const accepted = await getTask(c, taskId);
      console.log(`[worker] task ${taskId}: accepted, betCutoff=${accepted.betCutoff}`);
      await waitForTimestamp(c, accepted.betCutoff);

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
    } catch (err) {
      console.error(`[worker] task ${taskId} failed:`, err);
      inFlight.delete(key); // allow retry on next sighting
    }
  }

  async function maybeClaim(taskId: bigint): Promise<void> {
    const key = taskId.toString();
    if (claimedTasks.has(key)) return;
    const t = await getTask(c, taskId);
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
      console.log(`[worker] claim(${taskId}) reverted (lost stake / NothingToClaim):`, (err as Error).message);
    }
  }

  // Consider every TaskCreated — handleTask() decides whether to take it
  // (mine if pre-assigned, or an OPEN job I choose to claim).
  const mineOrOpen = (workerAgentId: bigint) => workerAgentId === myAgentId || workerAgentId === 0n;

  // catch-up for tasks created before boot, then live watch
  for (const log of await getOracleEvents(c, "TaskCreated")) {
    if (mineOrOpen(log.args.workerAgentId as bigint)) void handleTask(log.args.taskId as bigint);
  }
  watchOracleEvent(c, "TaskCreated", (logs) => {
    for (const log of logs) {
      if (mineOrOpen(log.args.workerAgentId as bigint)) void handleTask(log.args.taskId as bigint);
    }
  });
  watchOracleEvent(c, "OutcomeResolved", (logs) => {
    for (const log of logs) void maybeClaim(log.args.taskId as bigint);
  });
  console.log("[worker] watching TaskCreated / OutcomeResolved");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
