// HTTP API — routes per DESIGN §8.2 table. Free routes market the paid ones;
// /odds and /trust are x402-gated via shared x402-lite middleware.
import express, { type Express } from "express";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, type Abi, type Hex, type PublicClient } from "viem";
import { x402Middleware } from "@oracle/shared/x402-lite";
import { decodePaymentHeader } from "@oracle/shared/x402-types";
import { PORTS, PRICES, type Deployment } from "@oracle/shared/config";
import {
  ORACLE_CORE_ABI,
  VALIDATION_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
} from "@oracle/shared/abi";
import type {
  ActivityItem,
  PaymentEvent,
  DirectorStatus,
} from "@oracle/shared/console-types";
import type { OracleDb } from "./db.js";
import { buildTrustTuple, type ReadSummary } from "./trust.js";
import type { X402Gate } from "./x402.js";
import {
  decodeReceipt,
  directorStatus,
  listRuns,
  readRun,
  type ConsoleState,
} from "./console.js";
import type { Control } from "./control.js";
import type { WsMessage } from "./ws.js";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RECEIPT_ABIS: Abi[] = [
  ORACLE_CORE_ABI as unknown as Abi,
  VALIDATION_REGISTRY_ABI as unknown as Abi,
  REPUTATION_REGISTRY_ABI as unknown as Abi,
];

export type ApiOptions = {
  db: OracleDb;
  dep: Deployment;
  gate: X402Gate;
  readSummary?: ReadSummary;
  artifactsDir?: string;
  staticDir?: string;
  baseUrl?: string; // public origin for artifact URIs
  // ---- demo-console wiring ----
  console?: ConsoleState; // ring buffers + director state (shared with index.ts)
  runsDir?: string; // where runs/<id>.jsonl live
  client?: PublicClient; // viem client for GET /v1/tx/:hash receipts
  control?: Control; // control plane: create tasks on-chain from the UI
  // broadcast is provided via a mutable ref set in index.ts AFTER attachWs;
  // createApp captures the ref so routes broadcast through the live WS server.
  broadcaster?: { current: (msg: WsMessage) => void };
};

export function createApp(opts: ApiOptions): Express {
  const { db, dep, gate } = opts;
  const artifactsDir = opts.artifactsDir ?? join(SERVER_ROOT, "artifacts");
  const staticDir = opts.staticDir ?? join(SERVER_ROOT, "static");
  const baseUrl = opts.baseUrl ?? `http://localhost:${PORTS.server}`;
  const runsDir = opts.runsDir ?? join(SERVER_ROOT, "runs");
  const cs = opts.console;
  const broadcast = (msg: WsMessage): void => opts.broadcaster?.current(msg);
  mkdirSync(artifactsDir, { recursive: true });

  const jsonBody = express.json({ limit: "256kb" });

  const app = express();

  // ---- CORS: the dashboard runs cross-origin (vite :5173) and agents post from
  //      other processes. Permissive on testnet; x402 headers exposed. ----
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-PAYMENT");
    res.header("Access-Control-Expose-Headers", "X-PAYMENT-RESPONSE");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // ---- free routes ----
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, block: Number(db.getMeta("lastBlock") ?? 0) });
  });

  app.get("/v1/tasks", (_req, res) => {
    res.json(db.listTasks());
  });

  app.get("/v1/tasks/:id", (req, res) => {
    const task = db.getTask(Number(req.params.id));
    if (!task) {
      res.status(404).json({ error: "task_not_found" });
      return;
    }
    res.json(task);
  });

  // ---- x402-gated routes ----
  const oddsGate = x402Middleware({
    payTo: gate.payTo,
    priceUnits: PRICES.odds, // 1000 units = $0.001
    asset: gate.asset,
    network: gate.network,
    facilitatorUrl: gate.facilitatorUrl,
    description: "ORACLE live odds",
    usdcDomain: gate.usdcDomain,
  });
  app.get("/v1/markets/:taskId/odds", oddsGate, (req, res) => {
    const taskId = Number(req.params.taskId);
    const task = db.getTask(taskId);
    if (!task) {
      res.status(404).json({ error: "task_not_found" });
      return;
    }
    // Successful paid request — surface the x402 settlement (best-effort).
    emitPayment(req, "odds", PRICES.odds.toString(), taskId);
    const yes = BigInt(task.yesPool);
    const no = BigInt(task.noPool);
    const total = yes + no;
    res.json({
      taskId,
      p_bps: total > 0n ? Number((yes * 10_000n) / total) : null,
      yesPool: task.yesPool,
      noPool: task.noPool,
      betCutoff: task.betCutoff,
      series: db.listSnapshots(taskId).map((s) => ({ t: s.t, p_bps: s.pBps })),
    });
  });

  const trustGate = x402Middleware({
    payTo: gate.payTo,
    priceUnits: PRICES.trust, // 5000 units = $0.005
    asset: gate.asset,
    network: gate.network,
    facilitatorUrl: gate.facilitatorUrl,
    description: "ORACLE Trust Tuple",
    usdcDomain: gate.usdcDomain,
  });
  app.get("/v1/agents/:agentId/trust", trustGate, (req, res, next) => {
    emitPayment(req, "trust", PRICES.trust.toString());
    buildTrustTuple(db, dep, Number(req.params.agentId), opts.readSummary)
      .then((tuple) => res.json(tuple))
      .catch(next);
  });

  // ---- demo-console channels (additive; spec 2026-06-13-demo-console) ----

  /** Pull the payer address out of the validated X-PAYMENT header (best-effort). */
  function payerFrom(req: express.Request): string {
    const header = req.header("X-PAYMENT");
    if (!header) return "";
    try {
      return decodePaymentHeader(header).payload.authorization.from ?? "";
    } catch {
      return "";
    }
  }

  /** Buffer + broadcast a PaymentEvent for a settled server-side x402 charge. */
  function emitPayment(
    req: express.Request,
    purpose: "odds" | "trust",
    amountUnits: string,
    taskId?: number,
  ): void {
    const payment: PaymentEvent = {
      ts: Date.now(),
      taskId,
      from: payerFrom(req),
      to: gate.payTo,
      amountUnits,
      purpose,
    };
    cs?.payments.push(payment);
    broadcast({ type: "payment", payment });
  }

  // POST /v1/activity — agents push a line of reasoning to the feed.
  app.post("/v1/activity", jsonBody, (req, res) => {
    const body = (req.body ?? {}) as Partial<ActivityItem>;
    if (typeof body.agent !== "string" || typeof body.text !== "string") {
      res.status(400).json({ error: "bad_activity" });
      return;
    }
    const item: ActivityItem = {
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
      taskId: typeof body.taskId === "number" ? body.taskId : 0,
      agent: body.agent,
      role: typeof body.role === "string" ? body.role : "",
      kind: (body.kind as ActivityItem["kind"]) ?? "info",
      text: body.text,
      side: body.side,
      amount: body.amount,
      score: body.score,
      confidence: body.confidence,
      source: body.source,
      code: body.code,
    };
    cs?.activity.push(item);
    broadcast({ type: "activity", item });
    res.json({ ok: true });
  });

  // POST /v1/payment — external x402 sellers (vendor, validator-intake) report.
  app.post("/v1/payment", jsonBody, (req, res) => {
    const body = (req.body ?? {}) as Partial<PaymentEvent>;
    if (typeof body.amountUnits !== "string" || typeof body.purpose !== "string") {
      res.status(400).json({ error: "bad_payment" });
      return;
    }
    const payment: PaymentEvent = {
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
      taskId: body.taskId,
      from: typeof body.from === "string" ? body.from : "",
      to: typeof body.to === "string" ? body.to : "",
      amountUnits: body.amountUnits,
      purpose: body.purpose as PaymentEvent["purpose"],
      txHash: body.txHash,
    };
    cs?.payments.push(payment);
    broadcast({ type: "payment", payment });
    res.json({ ok: true });
  });

  // GET /v1/tx/:hash — bundled mini-explorer: decoded receipt via viem.
  app.get("/v1/tx/:hash", (req, res, next) => {
    const client = opts.client;
    if (!client) {
      res.status(503).json({ error: "no_chain_client" });
      return;
    }
    client
      .getTransactionReceipt({ hash: req.params.hash as Hex })
      .then((receipt) => res.json(decodeReceipt(receipt, RECEIPT_ABIS)))
      .catch((err) => {
        if (String(err?.name ?? "").includes("NotFound")) {
          res.status(404).json({ error: "tx_not_found" });
          return;
        }
        next(err);
      });
  });

  // GET /v1/runs — list recorded captures.
  app.get("/v1/runs", (_req, res) => {
    res.json({ runs: listRuns(runsDir) });
  });

  // POST /v1/director — set director mode/runId, broadcast new status.
  app.post("/v1/director", jsonBody, (req, res) => {
    const body = (req.body ?? {}) as Partial<DirectorStatus>;
    if (cs) {
      if (body.mode === "live" || body.mode === "replay") cs.director.mode = body.mode;
      if (typeof body.runId === "string") cs.director.runId = body.runId;
      if (typeof body.geminiOk === "boolean" || body.geminiOk === "limited") {
        cs.director.geminiOk = body.geminiOk;
      }
    }
    const block = Number(db.getMeta("lastBlock") ?? 0);
    const status = cs
      ? directorStatus(cs, block)
      : ({ mode: (body.mode as DirectorStatus["mode"]) ?? "live", block } as DirectorStatus);
    broadcast({ type: "director", status });
    res.json({ ok: true, status });
  });

  // GET /v1/replay/:id — re-broadcast a recorded run honoring recorded offsets.
  app.get("/v1/replay/:id", (req, res, next) => {
    let lines;
    try {
      lines = readRun(runsDir, req.params.id);
    } catch {
      res.status(404).json({ error: "run_not_found" });
      return;
    }
    try {
      for (const line of lines) {
        setTimeout(() => broadcast(line.msg as WsMessage), Math.max(0, line.t));
      }
      res.json({ ok: true, count: lines.length });
    } catch (err) {
      next(err);
    }
  });

  // ---- control plane: drive the demo from the UI ----
  // GET /v1/control — capabilities + available task templates.
  app.get("/v1/control", (_req, res) => {
    res.json({
      available: opts.control?.available ?? false,
      reason: opts.control?.reason,
      templates: opts.control?.templates() ?? [],
    });
  });

  // POST /v1/control/task { template } — create a task on-chain (client role).
  app.post("/v1/control/task", jsonBody, (req, res, next) => {
    if (!opts.control?.available) {
      res.status(503).json({ error: "control_unavailable", reason: opts.control?.reason });
      return;
    }
    const template = (req.body ?? {}).template as string | undefined;
    if (typeof template !== "string") {
      res.status(400).json({ error: "template_required" });
      return;
    }
    opts.control
      .createTask(template)
      .then((r) => res.json({ ok: true, ...r }))
      .catch((err) => {
        console.error("[control] createTask failed:", (err as Error).message);
        res.status(500).json({ error: "create_failed", message: (err as Error).message });
      });
  });

  // ---- static: specs, agent registrations, artifacts ----
  app.use("/specs", express.static(join(staticDir, "specs")));
  app.use("/.well-known/agents", express.static(join(staticDir, "well-known", "agents")));
  app.use(
    "/artifacts",
    express.static(artifactsDir, {
      setHeaders: (res, path) => {
        if (path.endsWith(".ts")) res.setHeader("content-type", "text/plain; charset=utf-8");
      },
    }),
  );

  // POST /artifacts: raw body <= 1 MB, content-addressed by keccak256
  app.post("/artifacts", express.raw({ type: () => true, limit: "1mb" }), (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "empty_body" });
      return;
    }
    const hash = keccak256(new Uint8Array(body));
    writeFileSync(join(artifactsDir, `${hash}.ts`), body);
    res.json({ uri: `${baseUrl}/artifacts/${hash}.ts`, hash });
  });

  return app;
}
