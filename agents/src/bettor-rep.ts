// bettor-rep daemon (DESIGN §8.3): trusts the track record. Pays x402 for both
// /odds and the Trust Tuple (/trust) before deciding — a paying customer of
// the very feed ORACLE sells.
import { runBettor } from "./lib/bettor-runtime.js";
import { repDecision, type WorkerTuple } from "./lib/strategies.js";

runBettor({
  role: "bettorRep",
  decide: async (ctx, task) => {
    const res = await ctx.paidFetch(`${ctx.serverUrl}/v1/agents/${task.workerAgentId}/trust`);
    if (!res.ok) throw new Error(`paid GET /trust(${task.workerAgentId}) -> ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    const tuple: WorkerTuple = {
      n: Number(j.n ?? 0),
      winRate: Number(j.winRate ?? 0),
      ssr: Number(j.ssr ?? 0),
    };
    console.log(`[bettorRep] trust tuple for agent ${task.workerAgentId}:`, tuple);
    return repDecision(tuple, { reward: task.reward, selfStake: task.selfStake });
  },
}).catch((err) => {
  console.error("[bettorRep] fatal:", err);
  process.exit(1);
});
