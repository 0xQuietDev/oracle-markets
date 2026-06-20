// bettor-rep daemon (DESIGN §8.3): trusts the track record. Pays x402 for both
// /odds and the Trust Tuple (/trust) before deciding — a paying customer of the
// very feed ORACLE sells. Real mode: a Gemini agent reasons over that data;
// offline: the deterministic repDecision rule. It buys the trust feed either way.
import { runBettor } from "./lib/bettor-runtime.js";
import { repDecision, type Decision, type WorkerTuple } from "./lib/strategies.js";
import { reportBet } from "./lib/report.js";
import { llmEnabled } from "./mastra/model.js";
import { llmBetDecision, toDecision } from "./mastra/agents.js";

const USDC = 1_000_000;

runBettor({
  role: "bettorRep",
  decide: async (ctx, task, _all, odds) => {
    const res = await ctx.paidFetch(`${ctx.serverUrl}/v1/agents/${task.workerAgentId}/trust`);
    if (!res.ok) throw new Error(`paid GET /trust(${task.workerAgentId}) -> ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    const tuple: WorkerTuple = {
      n: Number(j.n ?? 0),
      winRate: Number(j.winRate ?? 0),
      ssr: Number(j.ssr ?? 0),
    };
    console.log(`[bettorRep] trust tuple for agent ${task.workerAgentId}:`, tuple);

    if (llmEnabled()) {
      try {
        const d = await llmBetDecision({
          role: "bettorRep",
          rewardUsdc: Number(task.reward) / USDC,
          selfStakeUsdc: Number(task.selfStake) / USDC,
          selfStakeRatio: task.reward > 0n ? Number(task.selfStake) / Number(task.reward) : 0,
          impliedProbabilityPct: odds.pBps / 100,
          trust: tuple.n > 0 ? tuple : null,
        });
        console.log(`[bettorRep] 🧠 ${d.action} ${d.side ?? ""} ${d.amountUsdc}u — ${d.reasoning}`);
        const decision = toDecision(d);
        reportBet("bettorRep", task.taskId, decision, d.reasoning, "gemini");
        return decision;
      } catch (err) {
        console.error(`[bettorRep] LLM decision failed (${(err as Error).message}); using rule`);
      }
    }
    const ruleDecision: Decision = repDecision(tuple, { reward: task.reward, selfStake: task.selfStake });
    reportBet(
      "bettorRep",
      task.taskId,
      ruleDecision,
      `Deterministic repDecision over trust tuple (n=${tuple.n}, winRate=${tuple.winRate}, ssr=${tuple.ssr})`,
      "rule",
    );
    return ruleDecision;
  },
}).catch((err) => {
  console.error("[bettorRep] fatal:", err);
  process.exit(1);
});
