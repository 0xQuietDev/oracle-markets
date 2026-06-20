// Demo-console channels (spec 2026-06-13-demo-console) — additive coverage:
// activity ingest broadcasts + buffers, payment ingest, director, the snapshot
// carries the new buffers, and decodeReceipt() decodes a viem receipt purely.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { createServer, type Server } from "node:http";
import {
  encodeEventTopics,
  encodeAbiParameters,
  type Abi,
  type TransactionReceipt,
} from "viem";
import { ORACLE_CORE_ABI } from "@oracle/shared/abi";
import type { Deployment } from "@oracle/shared/config";
import type { WsMessage } from "../src/ws.js";
import { OracleDb } from "../src/db.js";
import { createApp } from "../src/api.js";
import { attachWs } from "../src/ws.js";
import { createConsoleState, decodeReceipt, directorStatus } from "../src/console.js";

const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const PAY_TO = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f";

const DEP = {
  chainId: 31337,
  rpcUrl: "http://localhost:8545",
  deployBlock: 0,
  contracts: {
    oracleCore: "0x1111111111111111111111111111111111111111",
    usdc: USDC,
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validationRegistry: "0x5555555555555555555555555555555555555555",
  },
  usdcDomain: { name: "USD Coin", version: "2" },
  params: {},
  agents: {},
} as unknown as Deployment;

/** Boot api + ws sharing one console state + a mutable broadcaster ref. */
function boot() {
  const db = new OracleDb(":memory:");
  db.setMeta("lastBlock", "99");
  const cs = createConsoleState("test-run");
  const broadcaster: { current: (m: WsMessage) => void } = { current: () => {} };
  const app = createApp({
    db,
    dep: DEP,
    gate: { payTo: PAY_TO as `0x${string}`, asset: USDC as `0x${string}`, network: "anvil-local", facilitatorUrl: "http://localhost:0", usdcDomain: DEP.usdcDomain },
    console: cs,
    broadcaster,
  });
  const server = createServer(app);
  const ws = attachWs(server, db, {
    activity: () => cs.activity.list(),
    payments: () => cs.payments.list(),
    txs: () => cs.txs.list(),
    director: () => directorStatus(cs, Number(db.getMeta("lastBlock") ?? 0)),
  });
  broadcaster.current = ws.broadcast;
  return { db, cs, server, ws };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)),
  );
}

function nextMessage(url: string, predicate: (m: WsMessage) => boolean): Promise<WsMessage> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url.replace("http", "ws"));
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error("ws timeout"));
    }, 4000);
    sock.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as WsMessage;
      if (predicate(msg)) {
        clearTimeout(timer);
        sock.close();
        resolve(msg);
      }
    });
    sock.on("error", reject);
  });
}

describe("demo-console channels", () => {
  let env: ReturnType<typeof boot>;
  let url: string;

  beforeAll(async () => {
    env = boot();
    url = await listen(env.server);
  });
  afterAll(() => {
    env.server.close();
    env.db.close();
  });

  it("POST /v1/activity broadcasts over WS and buffers for the snapshot", async () => {
    const recv = nextMessage(url, (m) => m.type === "activity");
    // small delay so the socket is open before we POST
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`${url}/v1/activity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "ORACLE Worker", role: "worker", kind: "confidence", text: "0.82 conf", confidence: 0.82, source: "gemini" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const msg = (await recv) as Extract<WsMessage, { type: "activity" }>;
    expect(msg.item).toMatchObject({ agent: "ORACLE Worker", kind: "confidence", text: "0.82 conf", source: "gemini" });
    expect(typeof msg.item.ts).toBe("number");
    // buffered
    expect(env.cs.activity.list().at(-1)?.text).toBe("0.82 conf");
  });

  it("POST /v1/activity rejects a body missing required fields", async () => {
    const res = await fetch(`${url}/v1/activity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "worker" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /v1/payment buffers + broadcasts an external seller payment", async () => {
    const recv = nextMessage(url, (m) => m.type === "payment");
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`${url}/v1/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "0xpayer", to: "0xvendor", amountUnits: "20000", purpose: "vendor", taskId: 1 }),
    });
    expect(res.status).toBe(200);
    const msg = (await recv) as Extract<WsMessage, { type: "payment" }>;
    expect(msg.payment).toMatchObject({ from: "0xpayer", to: "0xvendor", amountUnits: "20000", purpose: "vendor", taskId: 1 });
    expect(env.cs.payments.list().at(-1)?.purpose).toBe("vendor");
  });

  it("POST /v1/director updates state + broadcasts director status", async () => {
    const recv = nextMessage(url, (m) => m.type === "director");
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`${url}/v1/director`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "replay", runId: "abc" }),
    });
    expect(res.status).toBe(200);
    const msg = (await recv) as Extract<WsMessage, { type: "director" }>;
    expect(msg.status).toMatchObject({ mode: "replay", runId: "abc", block: 99 });
    expect(env.cs.director.mode).toBe("replay");
  });

  it("connect snapshot carries activity / payments / txs / director buffers", async () => {
    const snap = (await nextMessage(url, (m) => m.type === "snapshot")) as Extract<WsMessage, { type: "snapshot" }>;
    expect(Array.isArray(snap.activity)).toBe(true);
    expect(Array.isArray(snap.payments)).toBe(true);
    expect(Array.isArray(snap.txs)).toBe(true);
    // reflects the earlier ingests
    expect(snap.activity.some((a) => a.text === "0.82 conf")).toBe(true);
    expect(snap.payments.some((p) => p.purpose === "vendor")).toBe(true);
    expect(snap.director).toMatchObject({ mode: "replay", block: 99 });
  });

  it("GET /v1/runs returns a runs array", async () => {
    const res = await fetch(`${url}/v1/runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.runs)).toBe(true);
  });
});

describe("decodeReceipt (mini-explorer)", () => {
  it("decodes OracleCore events with stringified args", () => {
    const abi = ORACLE_CORE_ABI as unknown as Abi;
    // build a synthetic TaskCreated log
    const topics = encodeEventTopics({
      abi,
      eventName: "TaskCreated",
      args: { taskId: 7n, client: PAY_TO as `0x${string}` },
    });
    const data = encodeAbiParameters(
      [
        { name: "workerAgentId", type: "uint64" },
        { name: "validatorAgentId", type: "uint64" },
        { name: "reward", type: "uint128" },
        { name: "deadline", type: "uint64" },
        { name: "specURI", type: "string" },
      ],
      [3n, 4n, 100000000n, 9999n, "ipfs://spec"],
    );
    const receipt = {
      transactionHash: "0x" + "ab".repeat(32),
      blockNumber: 12n,
      from: "0x000000000000000000000000000000000000dead",
      to: "0x1111111111111111111111111111111111111111",
      status: "success",
      gasUsed: 54321n,
      logs: [{ address: "0x1111111111111111111111111111111111111111", topics, data }],
    } as unknown as TransactionReceipt;

    const view = decodeReceipt(receipt, [abi]);
    expect(view).toMatchObject({
      txHash: "0x" + "ab".repeat(32),
      blockNumber: 12,
      status: "success",
      gasUsed: "54321",
    });
    const ev = view.events.find((e) => e.name === "TaskCreated");
    expect(ev).toBeDefined();
    expect(ev!.args.taskId).toBe("7");
    expect(ev!.args.reward).toBe("100000000");
    expect(ev!.args.specURI).toBe("ipfs://spec");
  });
});
