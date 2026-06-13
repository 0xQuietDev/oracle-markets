// bettor-mirror daemon (DESIGN §8.3): waits min(60 s, half the remaining
// betting window), then follows the money. Real mode: a Gemini "momentum" agent
// reads the current implied probability and follows the leading side; offline:
// the deterministic mirrorDecision (bet 10e6 on the larger pool iff |p−0.5|>0.10).
import { runBettor } from "./lib/bettor-runtime.js";
import { mirrorDecision, mirrorWaitMs } from "./lib/strategies.js";
import { llmEnabled } from "./mastra/model.js";
import { llmBetDecision, toDecision } from "./mastra/agents.js";

const USDC = 1_000_000;

runBettor({
  role: "bettorMirror",
  delayMsFor: (task, firstSeenMs) => mirrorWaitMs(task.betCutoff, firstSeenMs),
  decide: async (_ctx, task, _allTasks, odds) => {
    if (llmEnabled()) {
      try {
        const d = await llmBetDecision({
          role: "bettorMirror",
          rewardUsdc: Number(task.reward) / USDC,
          selfStakeUsdc: Number(task.selfStake) / USDC,
          selfStakeRatio: task.reward > 0n ? Number(task.selfStake) / Number(task.reward) : 0,
          impliedProbabilityPct: odds.pBps / 100,
          trust: null,
        });
        console.log(`[bettorMirror] 🪞 ${d.action} ${d.side ?? ""} ${d.amountUsdc}u — ${d.reasoning}`);
        return toDecision(d);
      } catch (err) {
        console.error(`[bettorMirror] LLM decision failed (${(err as Error).message}); using rule`);
      }
    }
    return mirrorDecision(odds.pBps);
  },
}).catch((err) => {
  console.error("[bettorMirror] fatal:", err);
  process.exit(1);
});
