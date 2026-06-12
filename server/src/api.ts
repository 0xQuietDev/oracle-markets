// HTTP API — routes per DESIGN §8.2 table. Free routes market the paid ones;
// /odds and /trust are x402-gated via shared x402-lite middleware.
import express, { type Express } from "express";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";
import { x402Middleware } from "@oracle/shared/x402-lite";
import { PORTS, PRICES, type Deployment } from "@oracle/shared/config";
import type { OracleDb } from "./db.js";
import { buildTrustTuple, type ReadSummary } from "./trust.js";
import type { X402Gate } from "./x402.js";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type ApiOptions = {
  db: OracleDb;
  dep: Deployment;
  gate: X402Gate;
  readSummary?: ReadSummary;
  artifactsDir?: string;
  staticDir?: string;
  baseUrl?: string; // public origin for artifact URIs
};

export function createApp(opts: ApiOptions): Express {
  const { db, dep, gate } = opts;
  const artifactsDir = opts.artifactsDir ?? join(SERVER_ROOT, "artifacts");
  const staticDir = opts.staticDir ?? join(SERVER_ROOT, "static");
  const baseUrl = opts.baseUrl ?? `http://localhost:${PORTS.server}`;
  mkdirSync(artifactsDir, { recursive: true });

  const app = express();

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
    buildTrustTuple(db, dep, Number(req.params.agentId), opts.readSummary)
      .then((tuple) => res.json(tuple))
      .catch(next);
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
