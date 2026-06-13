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
import { attachWs } from "./ws.js";
import { startIndexer } from "./indexer.js";
import { gateFromEnv } from "./x402.js";
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

  const app = createApp({ db, dep, gate, readSummary });
  const server = createServer(app);
  const ws = attachWs(server, db);
  await startIndexer({ db, dep, client, broadcast: ws.broadcast });

  server.listen(PORTS.server, () => {
    console.log(`[oracle-server] chainId=${dep.chainId} core=${dep.contracts.oracleCore}`);
    console.log(`[oracle-server] http+ws listening on :${PORTS.server}`);
  });
}

main().catch((err) => {
  console.error("[oracle-server] fatal:", err);
  process.exit(1);
});
