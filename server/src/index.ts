// oracle-server boot: db -> indexer -> http + ws on PORTS.server (8402).
// Env: ORACLE_DEPLOYMENT (path), ORACLE_REVENUE_WALLET, X402_FACILITATOR, ORACLE_DB.
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http as viemHttp, stringToHex, zeroHash } from "viem";
import { loadDeployment, PORTS } from "@oracle/shared/config";
import { REPUTATION_REGISTRY_ABI } from "@oracle/shared/abi";
import { OracleDb } from "./db.js";
import { createApp } from "./api.js";
import { attachWs, type WsMessage } from "./ws.js";
import { startIndexer } from "./indexer.js";
import { gateFromEnv } from "./x402.js";
import { createConsoleState, createRecorder, directorStatus } from "./console.js";
import type { Rep8004 } from "./trust.js";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAG1 = stringToHex("oracle.outcome", { size: 32 });

async function main(): Promise<void> {
  const dep = loadDeployment();
  const dbPath = process.env.ORACLE_DB ?? join(SERVER_ROOT, "data", "oracle.db");
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new OracleDb(dbPath);
  const fingerprint = `${dep.chainId}:${dep.contracts.oracleCore.toLowerCase()}`;
  if (db.resetIfDeploymentChanged(fingerprint)) {
    console.log(`[oracle-server] deployment changed -> wiped stale index (now ${fingerprint})`);
  }

  const client = createPublicClient({ transport: viemHttp(dep.rpcUrl) });
  const gate = gateFromEnv(dep);

  // rep8004 pass-through (DESIGN §6.6) — tolerate revert/unreachable registry
  const readSummary = async (agentId: number): Promise<Rep8004> => {
    try {
      const [count, sum] = await client.readContract({
        address: dep.contracts.reputationRegistry,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: "getSummary",
        args: [BigInt(agentId), [dep.contracts.oracleCore], TAG1, zeroHash],
      });
      return { count: Number(count), sum: sum.toString() };
    } catch {
      return null;
    }
  };

  // ---- demo-console state + run recorder (spec 2026-06-13-demo-console) ----
  const runsDir = join(SERVER_ROOT, "runs");
  // runId: explicit env, else derived from the indexer's last block + a stamp.
  const runId =
    process.env.RUN_ID ??
    `run-${db.getMeta("lastBlock") ?? "0"}-${Math.floor(Date.now() / 1000)}`;
  const cs = createConsoleState(runId);
  const record = createRecorder(runsDir, runId);
  const blockNow = (): number => Number(db.getMeta("lastBlock") ?? 0);

  // The broadcaster ref is set AFTER attachWs; createApp captures it so console
  // routes broadcast through the live WS server. Every outbound message is teed
  // to runs/<runId>.jsonl with a ms offset before it goes out over the socket.
  const broadcaster: { current: (msg: WsMessage) => void } = { current: () => {} };

  const app = createApp({
    db,
    dep,
    gate,
    readSummary,
    client,
    console: cs,
    runsDir,
    broadcaster,
  });
  const server = createServer(app);
  const ws = attachWs(server, db, {
    activity: () => cs.activity.list(),
    payments: () => cs.payments.list(),
    txs: () => cs.txs.list(),
    director: () => directorStatus(cs, blockNow()),
  });
  broadcaster.current = (msg: WsMessage) => {
    record(msg);
    ws.broadcast(msg);
  };

  await startIndexer({
    db,
    dep,
    client,
    broadcast: broadcaster.current,
    onTx: (tx) => cs.txs.push(tx),
  });

  server.listen(PORTS.server, () => {
    console.log(`[oracle-server] chainId=${dep.chainId} core=${dep.contracts.oracleCore}`);
    console.log(`[oracle-server] http+ws listening on :${PORTS.server}`);
  });
}

main().catch((err) => {
  console.error("[oracle-server] fatal:", err);
  process.exit(1);
});
