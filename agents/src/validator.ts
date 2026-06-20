// Validator daemon (DESIGN §8.3, plan §5/C3). Deterministic verdicts only:
// no LLM anywhere near R2/R3.
//
// - Serves x402-gated POST /v1/validate-intake (PORTS.validatorIntake, 10000 units).
// - On DeliverySubmitted where validatorAgentId == mine: download the
//   deliverable, drop it as solution.ts next to the hidden suite for the
//   template, run vitest (JSON reporter), score = round(100 * passed / total),
//   publish the report as an artifact, post validationResponse on-chain, then
//   volunteer as cranker: settleWithValidation + withdrawValidatorFees.
import express from "express";
import { keccak256, stringToBytes, type Hex } from "viem";
import { PORTS, PRICES, SERVER_URL, loadDeployment } from "@oracle/shared";
import {
  getOracleEvents,
  getTask,
  makeClients,
  stateName,
  watchOracleEvent,
  writeOracle,
  writeValidationRegistry,
} from "./lib/chain.js";
import { templateFromSpecURI } from "./lib/confidence.js";
import { runHarness } from "./lib/harness.js";
import { makeGate } from "./lib/payments.js";
import { reportActivity, reportPayment, x402Settlement } from "./lib/report.js";

async function main() {
  const deployment = loadDeployment();
  const c = makeClients("validator", deployment);
  const entry = deployment.agents.validator;
  if (!entry) throw new Error("agents.validator missing from deployment JSON — run register-agents first");
  const myAgentId = BigInt(entry.agentId);
  console.log(`[validator] agentId=${myAgentId} addr=${c.account.address}`);

  // --- x402-gated intake endpoint (records intent; the verdict pipeline is event-driven) ---
  const app = express();
  app.use(express.json());
  app.post(
    "/v1/validate-intake",
    makeGate(deployment, {
      payTo: c.account.address,
      priceUnits: PRICES.validatorIntake,
      description: "ORACLE validator evaluation intake fee",
    }),
    (req, res) => {
      const { taskId, evidenceURI } = (req.body ?? {}) as { taskId?: number; evidenceURI?: string };
      console.log(`[validator] intake paid for task ${taskId} (${evidenceURI ?? "no evidence yet"})`);
      // The gate above only runs this handler once x402 settlement succeeded, so
      // reaching here means a real paid request was received.
      const { from, txHash } = x402Settlement(
        (n) => req.header(n),
        res.getHeader("X-PAYMENT-RESPONSE") as string | undefined,
      );
      reportPayment({
        taskId: typeof taskId === "number" ? taskId : undefined,
        from,
        to: c.account.address,
        amountUnits: String(PRICES.validatorIntake),
        purpose: "validator-intake",
        txHash,
      });
      res.json({ ok: true, taskId: taskId ?? null, recordedAt: Date.now() });
    },
  );
  app.get("/healthz", (_req, res) => res.json({ ok: true, role: "validator", address: c.account.address }));
  app.listen(PORTS.validatorIntake, () => {
    console.log(`[validator] intake on :${PORTS.validatorIntake} (price ${PRICES.validatorIntake} units)`);
  });

  // --- verdict pipeline ---
  const processed = new Set<string>();

  async function handleDelivery(taskId: bigint, requestHash: Hex, evidenceURI: string): Promise<void> {
    const key = taskId.toString();
    if (processed.has(key)) return;
    processed.add(key);
    try {
      const t = await getTask(c, taskId);
      if (t.validatorAgentId !== myAgentId) {
        processed.delete(key);
        return;
      }
      if (stateName(t.state) !== "Delivered") return; // stale catch-up event

      const template = templateFromSpecURI(t.specURI);
      console.log(`[validator] task ${taskId}: scoring template=${template} evidence=${evidenceURI}`);
      const evidenceRes = await fetch(evidenceURI);
      if (!evidenceRes.ok) throw new Error(`GET evidence -> ${evidenceRes.status}`);
      const solution = await evidenceRes.text();

      const { passed, total, score } = await runHarness(template, solution, `task-${key}`);
      console.log(`[validator] task ${taskId}: ${passed}/${total} passed -> score ${score}`);
      reportActivity({
        taskId: Number(taskId),
        agent: "ORACLE Validator",
        role: "validator",
        kind: "verdict",
        text: `${passed}/${total} hidden tests passed`,
        score,
      });

      const report = JSON.stringify(
        {
          taskId: Number(taskId),
          template,
          evidenceURI,
          passed,
          total,
          score,
          validatorAgentId: Number(myAgentId),
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      );
      let reportUri = "";
      try {
        const up = await fetch(`${SERVER_URL}/artifacts`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: report,
        });
        if (up.ok) reportUri = ((await up.json()) as { uri: string }).uri;
      } catch (err) {
        console.error("[validator] report upload failed (continuing):", (err as Error).message);
      }

      // The worker files validationRequest in a separate tx from submitDelivery;
      // tolerate it landing a block or two behind the DeliverySubmitted event.
      let posted = false;
      for (let attempt = 1; attempt <= 5 && !posted; attempt++) {
        try {
          await writeValidationRegistry(c, "validationResponse", [
            requestHash,
            score,
            reportUri,
            keccak256(stringToBytes(report)),
            "oracle",
          ]);
          posted = true;
        } catch (err) {
          if (attempt === 5) throw err;
          console.log(`[validator] validationResponse attempt ${attempt} reverted (request not landed yet?), retrying in 2s`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      console.log(`[validator] task ${taskId}: validationResponse(${score}) posted`);

      try {
        await writeOracle(c, "settleWithValidation", [taskId]);
        console.log(`[validator] task ${taskId}: settled via validation`);
      } catch (err) {
        console.log(`[validator] settleWithValidation(${taskId}) reverted (someone else cranked?):`, (err as Error).message);
      }
      try {
        await writeOracle(c, "withdrawValidatorFees", []);
        console.log("[validator] validator fees withdrawn");
      } catch (err) {
        console.log("[validator] withdrawValidatorFees reverted (nothing accrued yet):", (err as Error).message);
      }
    } catch (err) {
      console.error(`[validator] task ${taskId} verdict failed:`, err);
      processed.delete(key);
    }
  }

  for (const log of await getOracleEvents(c, "DeliverySubmitted")) {
    void handleDelivery(
      log.args.taskId as bigint,
      log.args.validationRequestHash as Hex,
      log.args.evidenceURI as string,
    );
  }
  watchOracleEvent(c, "DeliverySubmitted", (logs) => {
    for (const log of logs) {
      void handleDelivery(
        log.args.taskId as bigint,
        log.args.validationRequestHash as Hex,
        log.args.evidenceURI as string,
      );
    }
  });
  console.log("[validator] watching DeliverySubmitted");
}

main().catch((err) => {
  console.error("[validator] fatal:", err);
  process.exit(1);
});
