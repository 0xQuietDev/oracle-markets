// bettor-skeptic daemon (DESIGN §8.3): the designated villain. Real mode: a
// Gemini "skeptic" agent that distrusts thin self-stake / unproven workers and
// bets NO; offline: the deterministic skepticDecision rule (NO 20e6 when
// selfStake/reward < 0.15 or the worker has no settled history).
import { runBettor, settledCountFor } from "./lib/bettor-runtime.js";
import { skepticDecision } from "./lib/strategies.js";
import { llmEnabled } from "./mastra/model.js";
import { llmBetDecision, toDecision } from "./mastra/agents.js";

const USDC = 1_000_000;

runBettor({
  role: "bettorSkeptic",
  decide: async (_ctx, task, allTasks, odds) => {
    const n = settledCountFor(allTasks, task.workerAgentId);

    if (llmEnabled()) {
      try {
        const d = await llmBetDecision({
          role: "bettorSkeptic",
          rewardUsdc: Number(task.reward) / USDC,
          selfStakeUsdc: Number(task.selfStake) / USDC,
          selfStakeRatio: task.reward > 0n ? Number(task.selfStake) / Number(task.reward) : 0,
          impliedProbabilityPct: odds.pBps / 100,
          // skeptic does not buy the trust feed; it only knows settled-count + stake
          trust: n > 0 ? { n, winRate: 0.5, ssr: 0 } : null,
        });
        console.log(`[bettorSkeptic] 🦨 ${d.action} ${d.side ?? ""} ${d.amountUsdc}u — ${d.reasoning}`);
        return toDecision(d);
      } catch (err) {
        console.error(`[bettorSkeptic] LLM decision failed (${(err as Error).message}); using rule`);
      }
    }
    return skepticDecision({ reward: task.reward, selfStake: task.selfStake }, n);
  },
}).catch((err) => {
  console.error("[bettorSkeptic] fatal:", err);
  process.exit(1);
});
