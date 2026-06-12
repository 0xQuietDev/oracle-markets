// bettor-mirror daemon (DESIGN §8.3): waits min(60 s, half the remaining
// betting window), then follows the money — bet 10e6 on the larger-pool side
// iff |p − 0.5| > 0.10. Exists to make the ticker visibly move twice.
import { runBettor } from "./lib/bettor-runtime.js";
import { mirrorDecision, mirrorWaitMs } from "./lib/strategies.js";

runBettor({
  role: "bettorMirror",
  delayMsFor: (task, firstSeenMs) => mirrorWaitMs(task.betCutoff, firstSeenMs),
  decide: (_ctx, _task, _allTasks, odds) => mirrorDecision(odds.pBps),
}).catch((err) => {
  console.error("[bettorMirror] fatal:", err);
  process.exit(1);
});
