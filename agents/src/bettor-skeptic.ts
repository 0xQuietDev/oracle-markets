// bettor-skeptic daemon (DESIGN §8.3): the designated villain. Bets NO 20e6
// whenever the worker's skin-in-the-game is thin (selfStake/reward < 0.15) or
// the worker has no settled history (n == 0, derived from the free task list).
import { runBettor, settledCountFor } from "./lib/bettor-runtime.js";
import { skepticDecision } from "./lib/strategies.js";

runBettor({
  role: "bettorSkeptic",
  decide: (_ctx, task, allTasks) => {
    const n = settledCountFor(allTasks, task.workerAgentId);
    return skepticDecision({ reward: task.reward, selfStake: task.selfStake }, n);
  },
}).catch((err) => {
  console.error("[bettorSkeptic] fatal:", err);
  process.exit(1);
});
