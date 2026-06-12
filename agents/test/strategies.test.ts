import { describe, expect, it } from "vitest";
import {
  mirrorDecision,
  mirrorWaitMs,
  repDecision,
  selfStakeRatioBps,
  skepticDecision,
} from "../src/lib/strategies.js";

const USDC = 1_000_000n;
const task = (rewardUsdc: bigint, stakeUsdc: bigint) => ({
  reward: rewardUsdc * USDC,
  selfStake: stakeUsdc * USDC,
});

describe("selfStakeRatioBps", () => {
  it("computes bps exactly, 0 on zero reward", () => {
    expect(selfStakeRatioBps(task(100n, 15n))).toBe(1500n);
    expect(selfStakeRatioBps(task(100n, 45n))).toBe(4500n);
    expect(selfStakeRatioBps({ reward: 0n, selfStake: 5n })).toBe(0n);
  });
});

describe("repDecision", () => {
  it("n>=1, winRate >= 0.6 -> YES min(20e6, 40e6*winRate)", () => {
    expect(repDecision({ n: 3, winRate: 1.0, ssr: 0.3 }, task(100n, 20n))).toEqual({
      action: "bet",
      side: 0,
      amount: 20n * USDC, // min(20e6, 40e6)
    });
    expect(repDecision({ n: 1, winRate: 0.6, ssr: 0.1 }, task(100n, 20n))).toEqual({
      action: "bet",
      side: 0,
      amount: 20n * USDC, // min(20e6, 24e6)
    });
  });

  it("n>=1, winRate < 0.4 -> NO 15e6", () => {
    expect(repDecision({ n: 2, winRate: 0.3, ssr: 0.4 }, task(100n, 45n))).toEqual({
      action: "bet",
      side: 1,
      amount: 15n * USDC,
    });
    expect(repDecision({ n: 5, winRate: 0.0, ssr: 0.4 }, task(100n, 45n))).toEqual({
      action: "bet",
      side: 1,
      amount: 15n * USDC,
    });
  });

  it("n>=1, mid-band winRate [0.4, 0.6) -> abstain", () => {
    expect(repDecision({ n: 2, winRate: 0.5, ssr: 0.3 }, task(100n, 45n))).toEqual({ action: "abstain" });
    expect(repDecision({ n: 2, winRate: 0.4, ssr: 0.3 }, task(100n, 45n))).toEqual({ action: "abstain" });
    expect(repDecision({ n: 2, winRate: 0.59, ssr: 0.3 }, task(100n, 45n))).toEqual({ action: "abstain" });
  });

  it("cold start (n=0): YES 10e6 iff live self-stake ratio >= 0.25", () => {
    // Task A demo shape: 45% self-stake -> respects the costly signal
    expect(repDecision({ n: 0, winRate: 0, ssr: 0 }, task(100n, 45n))).toEqual({
      action: "bet",
      side: 0,
      amount: 10n * USDC,
    });
    // exactly 25% counts
    expect(repDecision({ n: 0, winRate: 0, ssr: 0 }, task(100n, 25n))).toEqual({
      action: "bet",
      side: 0,
      amount: 10n * USDC,
    });
    // 12% (Task B shape) -> abstain
    expect(repDecision({ n: 0, winRate: 0, ssr: 0 }, task(100n, 12n))).toEqual({ action: "abstain" });
  });
});

describe("skepticDecision", () => {
  it("NO 20e6 when selfStake/reward < 0.15", () => {
    expect(skepticDecision(task(100n, 12n), 5)).toEqual({ action: "bet", side: 1, amount: 20n * USDC });
  });
  it("NO 20e6 when n == 0 even with big stake", () => {
    expect(skepticDecision(task(100n, 45n), 0)).toEqual({ action: "bet", side: 1, amount: 20n * USDC });
  });
  it("abstains at ratio exactly 0.15 with history", () => {
    expect(skepticDecision(task(100n, 15n), 1)).toEqual({ action: "abstain" });
  });
  it("abstains on well-staked experienced worker", () => {
    expect(skepticDecision(task(100n, 45n), 3)).toEqual({ action: "abstain" });
  });
});

describe("mirrorDecision", () => {
  it("follows the larger pool when |p-0.5| > 0.10", () => {
    expect(mirrorDecision(6500)).toEqual({ action: "bet", side: 0, amount: 10n * USDC });
    expect(mirrorDecision(3000)).toEqual({ action: "bet", side: 1, amount: 10n * USDC });
  });
  it("abstains inside the band, boundary is strict", () => {
    expect(mirrorDecision(5000)).toEqual({ action: "abstain" });
    expect(mirrorDecision(5500)).toEqual({ action: "abstain" });
    expect(mirrorDecision(6000)).toEqual({ action: "abstain" }); // |p-0.5| == 0.10 exactly
    expect(mirrorDecision(4000)).toEqual({ action: "abstain" });
    expect(mirrorDecision(6001)).toEqual({ action: "bet", side: 0, amount: 10n * USDC });
    expect(mirrorDecision(3999)).toEqual({ action: "bet", side: 1, amount: 10n * USDC });
  });
});

describe("mirrorWaitMs", () => {
  it("waits min(60s, half remaining window)", () => {
    const now = 1_000_000_000_000; // ms
    // 300 s remaining -> capped at 60 s
    expect(mirrorWaitMs(now / 1000 + 300, now)).toBe(60_000);
    // 15 s remaining (e2e profile) -> 7.5 s
    expect(mirrorWaitMs(now / 1000 + 15, now)).toBe(7_500);
    // cutoff already passed -> 0
    expect(mirrorWaitMs(now / 1000 - 10, now)).toBe(0);
  });
});
