// Vendor daemon (DESIGN §8.3): sells "task inputs" to the worker over x402.
// GET /v1/input on PORTS.vendor, price 10000 units ($0.01) — flavor only,
// but it is a real paid hop in the demo's economic loop.
import express from "express";
import { PORTS, PRICES, loadDeployment } from "@oracle/shared";
import { makeClients } from "./lib/chain.js";
import { makeGate } from "./lib/payments.js";
import { reportPayment, x402Settlement } from "./lib/report.js";

const deployment = loadDeployment();
const c = makeClients("vendor", deployment);

const app = express();

app.get(
  "/v1/input",
  makeGate(deployment, {
    payTo: c.account.address,
    priceUnits: PRICES.vendorInput,
    description: "ORACLE demo task input (unicode folding hint)",
  }),
  (req, res) => {
    // The gate above only reaches here once x402 settlement succeeded — a real
    // paid request. Best-effort report it to the console payment channel.
    const { from, txHash } = x402Settlement(
      (n) => req.header(n),
      res.getHeader("X-PAYMENT-RESPONSE") as string | undefined,
    );
    reportPayment({
      from,
      to: c.account.address,
      amountUnits: String(PRICES.vendorInput),
      purpose: "vendor",
      txHash,
    });
    res.json({ hint: "unicode NFKD fold", ts: Date.now() });
  },
);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, role: "vendor", address: c.account.address });
});

app.listen(PORTS.vendor, () => {
  console.log(`[vendor] selling /v1/input on :${PORTS.vendor} (price ${PRICES.vendorInput} units, payTo ${c.account.address})`);
});
