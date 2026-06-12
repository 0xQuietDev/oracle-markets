// Pure bettor strategy logic — exact DESIGN §8.3 rules. TDD'd; daemons stay thin.

export type Decision =
  | { action: "bet"; side: 0 | 1; amount: bigint } // side: 0 = Yes, 1 = No
  | { action: "abstain" };

export const SIDE_YES = 0 as const;
export const SIDE_NO = 1 as const;

/** Subset of the x402 Trust Tuple (DESIGN §6.6) the rep bettor consumes. */
export type WorkerTuple = { n: number; winRate: number; ssr: number };

/** On-chain stake facts of the live task. */
export type TaskStakeInfo = { reward: bigint; selfStake: bigint };

const USDC = 1_000_000n;

/** selfStake/reward in basis points, bigint-exact. */
export function selfStakeRatioBps(task: TaskStakeInfo): bigint {
  if (task.reward === 0n) return 0n;
  return (task.selfStake * 10_000n) / task.reward;
}

/**
 * bettor-rep (DESIGN §8.3):
 *  - n >= 1 && winRate >= 0.6  -> YES min(20e6, 40e6 * winRate)
 *  - n >= 1 && winRate <  0.4  -> NO 15e6
 *  - n >= 1, 0.4 <= winRate < 0.6 -> abstain
 *  - cold start (n == 0): abstain unless ssr >= 0.25 then YES 10e6.
 *    With no history the only observable costly signal is the live task's
 *    self-stake ratio, so cold-start ssr := selfStake/reward of this task.
 */
export function repDecision(tuple: WorkerTuple, task: TaskStakeInfo): Decision {
  if (tuple.n >= 1) {
    if (tuple.winRate >= 0.6) {
      const scaled = (40n * USDC * BigInt(Math.round(tuple.winRate * 10_000))) / 10_000n;
      const cap = 20n * USDC;
      return { action: "bet", side: SIDE_YES, amount: scaled < cap ? scaled : cap };
    }
    if (tuple.winRate < 0.4) {
      return { action: "bet", side: SIDE_NO, amount: 15n * USDC };
    }
    return { action: "abstain" };
  }
  if (selfStakeRatioBps(task) >= 2_500n) {
    return { action: "bet", side: SIDE_YES, amount: 10n * USDC };
  }
  return { action: "abstain" };
}

/**
 * bettor-skeptic (DESIGN §8.3): NO 20e6 whenever selfStake/reward < 0.15
 * or the worker has no settled history (n == 0). Otherwise abstain.
 */
export function skepticDecision(task: TaskStakeInfo, n: number): Decision {
  if (n === 0 || selfStakeRatioBps(task) < 1_500n) {
    return { action: "bet", side: SIDE_NO, amount: 20n * USDC };
  }
  return { action: "abstain" };
}

/**
 * bettor-mirror (DESIGN §8.3): bet 10e6 on the larger-pool side iff
 * |p - 0.5| > 0.10 (strict). p given in basis points.
 */
export function mirrorDecision(pBps: number): Decision {
  if (Math.abs(pBps - 5_000) > 1_000) {
    return { action: "bet", side: pBps > 5_000 ? SIDE_YES : SIDE_NO, amount: 10n * USDC };
  }
  return { action: "abstain" };
}

/**
 * Mirror waits min(60 s, half the remaining betting window) before acting
 * (plan §10 — keeps the 15 s e2e window workable).
 */
export function mirrorWaitMs(betCutoffSec: number, nowMs: number): number {
  const remainingMs = Math.max(0, betCutoffSec * 1000 - nowMs);
  return Math.min(60_000, Math.floor(remainingMs / 2));
}
