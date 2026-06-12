// WS-B Task B4 — API surface per DESIGN §8.2 (free routes 200, gated routes
// 402 with the exact challenge shape, artifacts roundtrip, public specs).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, verifyTypedData, type Address, type Hex } from "viem";
import { EIP3009_TYPES } from "@oracle/shared/x402-types";
import { wrapFetchWithPayment } from "@oracle/shared/x402-lite";
import type { Deployment } from "@oracle/shared/config";
import { OracleDb } from "../src/db.js";
import { createApp } from "../src/api.js";

const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65" as Address;
const PAY_TO = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" as Address;
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex; // anvil 1

const DEP = {
  chainId: 43113,
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  deployBlock: 0,
  contracts: {
    oracleCore: "0x1111111111111111111111111111111111111111",
    usdc: USDC,
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validationRegistry: "0x5555555555555555555555555555555555555555",
  },
  usdcDomain: { name: "USD Coin", version: "2" },
  params: {
    minSelfStakeBps: 1000, protocolFeeBps: 200, validatorFeeShareBps: 5000,
    bettingWindow: 180, acceptWindow: 300, disputeWindow: 120, graceWindow: 60,
    validationThreshold: 80, minBet: "100000", maxPoolPerSide: "10000000000", minReward: "1000000",
  },
  agents: {},
} as unknown as Deployment;

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server });
    });
  });
}

function facilitatorStub() {
  const app = express();
  app.use(express.json());
  app.post("/verify", async (req, res) => {
    try {
      const { paymentPayload: p, paymentRequirements: r } = req.body;
      const a = p.payload.authorization;
      const ok = await verifyTypedData({
        address: a.from,
        domain: { name: r.extra.name, version: r.extra.version, chainId: DEP.chainId, verifyingContract: r.asset },
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: a.from, to: a.to, value: BigInt(a.value),
          validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce,
        },
        signature: p.payload.signature,
      });
      res.json({ isValid: ok });
    } catch {
      res.json({ isValid: false, invalidReason: "invalid_signature" });
    }
  });
  app.post("/settle", (_req, res) => res.json({ success: true, txHash: "0x" + "cd".repeat(32) }));
  return app;
}

describe("oracle-server API", () => {
  let db: OracleDb;
  let api: { url: string; server: Server };
  let fac: { url: string; server: Server };
  let artifactsDir: string;

  beforeAll(async () => {
    fac = await listen(facilitatorStub());
    artifactsDir = mkdtempSync(join(tmpdir(), "oracle-artifacts-"));
    db = new OracleDb(":memory:");
    db.setMeta("lastBlock", "42");
    // open task with bets
    db.insertTask({ taskId: 1, client: "0xc1", workerAgentId: 1, validatorAgentId: 2, reward: "100000000", createdAt: 1000, deadline: 9999, specUri: "http://localhost:8402/specs/task-a-slugify.json" });
    db.markAccepted(1, { workerWallet: "0xw1", selfStake: "15000000", acceptedAt: 1100, betCutoff: 1280 });
    db.insertSnapshot(1, 1100, 10000);
    db.updatePools(1, "50000000", "50000000");
    db.insertBet({ taskId: 1, agentId: 4, bettor: "0xb4", side: "Yes", amount: "35000000", yesPoolAfter: "50000000", noPoolAfter: "0", blockNumber: 5, txHash: "0xt1", ts: 1150 });
    db.insertSnapshot(1, 1150, 10000);
    db.insertBet({ taskId: 1, agentId: 5, bettor: "0xb5", side: "No", amount: "50000000", yesPoolAfter: "50000000", noPoolAfter: "50000000", blockNumber: 6, txHash: "0xt2", ts: 1200 });
    db.insertSnapshot(1, 1200, 5000);
    // settled task
    db.insertTask({ taskId: 2, client: "0xc1", workerAgentId: 1, validatorAgentId: 2, reward: "100000000", createdAt: 2000, deadline: 9999, specUri: "http://localhost:8402/specs/task-b-nextbusinessday.json" });
    db.markAccepted(2, { workerWallet: "0xw1", selfStake: "12000000", acceptedAt: 2100, betCutoff: 2280 });
    db.setPCutoffBps(2, 5000);
    db.markSettled(2, { outcome: "No", viaRule: 3, validatorScore: 50 });

    const app = createApp({
      db,
      dep: DEP,
      gate: { payTo: PAY_TO, asset: USDC, network: "avalanche-fuji", facilitatorUrl: fac.url, usdcDomain: DEP.usdcDomain },
      artifactsDir,
      baseUrl: "http://localhost:8402",
      readSummary: async () => ({ count: 1, sum: "0" }),
    });
    api = await listen(app);
  });

  afterAll(() => {
    api.server.close();
    fac.server.close();
    db.close();
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  it("GET /healthz -> {ok, block}", async () => {
    const res = await fetch(`${api.url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, block: 42 });
  });

  it("GET /v1/tasks -> all tasks, camelCase rows", async () => {
    const res = await fetch(`${api.url}/v1/tasks`);
    expect(res.status).toBe(200);
    const tasks = await res.json();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].taskId).toBe(2); // newest first
    expect(tasks[1]).toMatchObject({ taskId: 1, state: "Open", selfStake: "15000000", yesPool: "50000000", noPool: "50000000", betCutoff: 1280 });
  });

  it("GET /v1/tasks/:id -> task; unknown id -> 404", async () => {
    const res = await fetch(`${api.url}/v1/tasks/2`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ taskId: 2, state: "Settled", outcome: "No", viaRule: 3, validatorScore: 50, pCutoffBps: 5000 });
    expect((await fetch(`${api.url}/v1/tasks/777`)).status).toBe(404);
  });

  it("GET /v1/markets/:taskId/odds without payment -> 402, exact DESIGN §8.2 challenge", async () => {
    const res = await fetch(`${api.url}/v1/markets/1/odds`);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      x402Version: 1,
      error: "Payment required",
      accepts: [{
        scheme: "exact",
        network: "avalanche-fuji",
        maxAmountRequired: "1000",
        resource: "/v1/markets/1/odds",
        description: "ORACLE live odds",
        mimeType: "application/json",
        payTo: PAY_TO,
        asset: USDC,
        maxTimeoutSeconds: 60,
        extra: { name: "USD Coin", version: "2" },
      }],
    });
  });

  it("GET /v1/agents/:agentId/trust without payment -> 402 at 5000 units", async () => {
    const res = await fetch(`${api.url}/v1/agents/1/trust`);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.accepts[0].maxAmountRequired).toBe("5000");
    expect(body.accepts[0].resource).toBe("/v1/agents/1/trust");
    expect(body.accepts[0].description).toBe("ORACLE Trust Tuple");
  });

  it("paid GET /odds via wrapFetchWithPayment -> 200 odds payload", async () => {
    const wrapped = wrapFetchWithPayment(fetch, { privateKey: KEY, chainId: DEP.chainId, usdc: USDC, usdcDomain: DEP.usdcDomain });
    const res = await wrapped(`${api.url}/v1/markets/1/odds`);
    expect(res.status).toBe(200);
    const odds = await res.json();
    expect(odds).toMatchObject({ taskId: 1, p_bps: 5000, yesPool: "50000000", noPool: "50000000", betCutoff: 1280 });
    expect(odds.series).toEqual([
      { t: 1100, p_bps: 10000 },
      { t: 1150, p_bps: 10000 },
      { t: 1200, p_bps: 5000 },
    ]);
  });

  it("paid GET /trust via wrapFetchWithPayment -> 200 Trust Tuple", async () => {
    const wrapped = wrapFetchWithPayment(fetch, { privateKey: KEY, chainId: DEP.chainId, usdc: USDC, usdcDomain: DEP.usdcDomain });
    const res = await wrapped(`${api.url}/v1/agents/1/trust`);
    expect(res.status).toBe(200);
    const tuple = await res.json();
    expect(tuple).toMatchObject({
      agentId: 1,
      agentRegistry: `eip155:43113:${DEP.contracts.identityRegistry}`,
      n: 1,
      brier: "0.2500",
      winRate: 0,
      forfeited: "12000000",
      rep8004: { count: 1, sum: "0" },
    });
    expect(tuple.p_live).toEqual([{ taskId: 1, pBps: 5000 }]);
  });

  it("POST /artifacts stores by keccak256 and serves it back", async () => {
    const body = "export function slugify(t: string): string { return t; }\n";
    const res = await fetch(`${api.url}/artifacts`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body });
    expect(res.status).toBe(200);
    const { uri, hash } = await res.json();
    expect(hash).toBe(keccak256(Buffer.from(body, "utf8")));
    expect(uri).toBe(`http://localhost:8402/artifacts/${hash}.ts`);
    // served from the same instance (uri advertises the public port; fetch via test port)
    const got = await fetch(`${api.url}/artifacts/${hash}.ts`);
    expect(got.status).toBe(200);
    expect(await got.text()).toBe(body);
  });

  it("serves public task specs (Task B omits Pongal/Onam)", async () => {
    const a = await fetch(`${api.url}/specs/task-a-slugify.json`);
    expect(a.status).toBe(200);
    const specA = await a.json();
    expect(specA.template).toBe("task-a-slugify");
    expect(specA.examples).toContainEqual(["Crème Brûlée!", "creme-brulee"]);

    const b = await fetch(`${api.url}/specs/task-b-nextbusinessday.json`);
    expect(b.status).toBe(200);
    const text = JSON.stringify(await b.json());
    expect(text).toContain("2026-01-26");
    expect(text).not.toMatch(/pongal|onam|2026-01-15|2026-08-26/i);
  });
});
