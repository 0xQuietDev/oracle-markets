// WS-B Task B1 — TDD for shared/src/x402-lite.ts (plan §2.4, DESIGN §8.2).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { verifyTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Middleware, wrapFetchWithPayment } from "@oracle/shared/x402-lite";
import {
  EIP3009_TYPES,
  decodePaymentHeader,
  encodePaymentHeader,
  type PaymentPayload,
  type X402Challenge,
} from "@oracle/shared/x402-types";

// anvil account 1
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const account = privateKeyToAccount(KEY);
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65" as Address;
const PAY_TO = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" as Address; // anvil 8 (revenue wallet)
const DOMAIN = { name: "USD Coin", version: "2" };
const CHAIN_ID = 43113;
const NETWORK = "avalanche-fuji";

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

/** Stub facilitator: /verify does a REAL EIP-712 signature check; /settle always succeeds. */
function facilitatorApp(calls: { verify: number; settle: number }) {
  const app = express();
  app.use(express.json());
  app.post("/verify", async (req, res) => {
    calls.verify++;
    try {
      const { paymentPayload: p, paymentRequirements: r } = req.body;
      const a = p.payload.authorization;
      const ok = await verifyTypedData({
        address: a.from,
        domain: { name: r.extra.name, version: r.extra.version, chainId: CHAIN_ID, verifyingContract: r.asset },
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: a.from, to: a.to, value: BigInt(a.value),
          validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce,
        },
        signature: p.payload.signature,
      });
      res.json(ok ? { isValid: true } : { isValid: false, invalidReason: "invalid_signature" });
    } catch {
      res.json({ isValid: false, invalidReason: "invalid_signature" });
    }
  });
  app.post("/settle", (_req, res) => {
    calls.settle++;
    res.json({ success: true, txHash: ("0x" + "ab".repeat(32)) as Hex });
  });
  return app;
}

describe("x402Middleware", () => {
  const calls = { verify: 0, settle: 0 };
  let fac: { url: string; server: Server };
  let gated: { url: string; server: Server };

  beforeAll(async () => {
    fac = await listen(facilitatorApp(calls));
    const app = express();
    app.get(
      "/v1/agents/:agentId/trust",
      x402Middleware({
        payTo: PAY_TO,
        priceUnits: 5000n,
        asset: USDC,
        network: NETWORK,
        facilitatorUrl: fac.url,
        description: "ORACLE Trust Tuple",
        usdcDomain: DOMAIN,
      }),
      (_req, res) => res.json({ secret: 42 }),
    );
    gated = await listen(app);
  });
  afterAll(() => {
    fac.server.close();
    gated.server.close();
  });

  async function signedPayment(over: { value?: string; from?: Address; signature?: Hex } = {}): Promise<string> {
    const auth = {
      from: over.from ?? account.address,
      to: PAY_TO,
      value: over.value ?? "5000",
      validAfter: "0",
      validBefore: String(Math.floor(Date.now() / 1000) + 600),
      nonce: ("0x" + "11".repeat(32)) as Hex,
    };
    const signature =
      over.signature ??
      (await account.signTypedData({
        domain: { name: DOMAIN.name, version: DOMAIN.version, chainId: CHAIN_ID, verifyingContract: USDC },
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: auth.from, to: auth.to, value: BigInt(auth.value),
          validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: auth.nonce,
        },
      }));
    const payload: PaymentPayload = {
      x402Version: 1, scheme: "exact", network: NETWORK,
      payload: { signature, authorization: auth },
    };
    return encodePaymentHeader(payload);
  }

  it("missing X-PAYMENT header -> 402 challenge with exact DESIGN §8.2 shape", async () => {
    const res = await fetch(`${gated.url}/v1/agents/12/trust`);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toEqual({
      x402Version: 1,
      error: "Payment required",
      accepts: [
        {
          scheme: "exact",
          network: "avalanche-fuji",
          maxAmountRequired: "5000",
          resource: "/v1/agents/12/trust",
          description: "ORACLE Trust Tuple",
          mimeType: "application/json",
          payTo: PAY_TO,
          asset: USDC,
          maxTimeoutSeconds: 60,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    });
  });

  it("bad signature -> 402 (facilitator /verify rejects)", async () => {
    // signed by account but claiming to be from a different address
    const header = await signedPayment({ from: PAY_TO });
    const res = await fetch(`${gated.url}/v1/agents/12/trust`, { headers: { "X-PAYMENT": header } });
    expect(res.status).toBe(402);
  });

  it("garbage signature bytes -> 402", async () => {
    const header = await signedPayment({ signature: ("0x" + "22".repeat(65)) as Hex });
    const res = await fetch(`${gated.url}/v1/agents/12/trust`, { headers: { "X-PAYMENT": header } });
    expect(res.status).toBe(402);
  });

  it("underpayment -> 402 without hitting facilitator", async () => {
    const before = calls.verify;
    const header = await signedPayment({ value: "10" });
    const res = await fetch(`${gated.url}/v1/agents/12/trust`, { headers: { "X-PAYMENT": header } });
    expect(res.status).toBe(402);
    expect(calls.verify).toBe(before);
  });

  it("malformed header -> 402", async () => {
    const res = await fetch(`${gated.url}/v1/agents/12/trust`, { headers: { "X-PAYMENT": "not-base64-json!!" } });
    expect(res.status).toBe(402);
  });

  it("happy path: wrapFetchWithPayment pays, gets 200 + X-PAYMENT-RESPONSE", async () => {
    const verifyBefore = calls.verify;
    const settleBefore = calls.settle;
    const wrapped = wrapFetchWithPayment(fetch, {
      privateKey: KEY, chainId: CHAIN_ID, usdc: USDC, usdcDomain: DOMAIN,
    });
    const res = await wrapped(`${gated.url}/v1/agents/12/trust`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ secret: 42 });
    const pr = res.headers.get("X-PAYMENT-RESPONSE");
    expect(pr).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(pr!, "base64").toString("utf8"));
    expect(decoded).toEqual({ success: true, txHash: "0x" + "ab".repeat(32), networkId: NETWORK });
    expect(calls.verify).toBe(verifyBefore + 1);
    expect(calls.settle).toBe(settleBefore + 1);
  });
});

describe("wrapFetchWithPayment", () => {
  it("signs valid EIP-3009 typed data on a 402 (validAfter=0, validBefore=now+600, 32B nonce)", async () => {
    const challenge: X402Challenge = {
      x402Version: 1,
      error: "Payment required",
      accepts: [
        {
          scheme: "exact", network: NETWORK, maxAmountRequired: "5000",
          resource: "/v1/agents/12/trust", description: "ORACLE Trust Tuple",
          mimeType: "application/json", payTo: PAY_TO, asset: USDC,
          maxTimeoutSeconds: 60, extra: DOMAIN,
        },
      ],
    };
    let captured: string | undefined;
    const fake = (async (input: any, init?: any) => {
      const h = new Headers(init?.headers);
      if (!h.has("X-PAYMENT")) {
        return new Response(JSON.stringify(challenge), { status: 402, headers: { "content-type": "application/json" } });
      }
      captured = h.get("X-PAYMENT")!;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const wrapped = wrapFetchWithPayment(fake, { privateKey: KEY, chainId: CHAIN_ID, usdc: USDC, usdcDomain: DOMAIN });
    const before = Math.floor(Date.now() / 1000);
    const res = await wrapped("http://stub/v1/agents/12/trust");
    expect(res.status).toBe(200);
    expect(captured).toBeTruthy();

    const payment = decodePaymentHeader(captured!);
    expect(payment.x402Version).toBe(1);
    expect(payment.scheme).toBe("exact");
    expect(payment.network).toBe(NETWORK);
    const a = payment.payload.authorization;
    expect(a.from).toBe(account.address);
    expect(a.to).toBe(PAY_TO);
    expect(a.value).toBe("5000");
    expect(a.validAfter).toBe("0");
    const vb = Number(a.validBefore);
    expect(vb).toBeGreaterThanOrEqual(before + 590);
    expect(vb).toBeLessThanOrEqual(before + 610);
    expect(a.nonce).toMatch(/^0x[0-9a-f]{64}$/);

    const ok = await verifyTypedData({
      address: account.address,
      domain: { name: DOMAIN.name, version: DOMAIN.version, chainId: CHAIN_ID, verifyingContract: USDC },
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: a.from, to: a.to, value: BigInt(a.value),
        validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce,
      },
      signature: payment.payload.signature,
    });
    expect(ok).toBe(true);
  });

  it("passes through non-402 responses untouched", async () => {
    const fake = (async () => new Response("plain", { status: 200 })) as unknown as typeof fetch;
    const wrapped = wrapFetchWithPayment(fake, { privateKey: KEY, chainId: CHAIN_ID, usdc: USDC, usdcDomain: DOMAIN });
    const res = await wrapped("http://stub/anything");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("plain");
  });
});
