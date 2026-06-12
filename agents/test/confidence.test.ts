import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIDENCE,
  clampConfidence,
  estimateConfidence,
  stakeFor,
  templateFromSpecURI,
} from "../src/lib/confidence.js";

describe("estimateConfidence", () => {
  it("task-a-slugify -> 0.45", () => {
    expect(estimateConfidence({ template: "task-a-slugify" })).toBe(0.45);
  });
  it("task-b-nextbusinessday -> 0.12", () => {
    expect(estimateConfidence({ template: "task-b-nextbusinessday" })).toBe(0.12);
  });
  it("unknown template -> default 0.25", () => {
    expect(estimateConfidence({ template: "task-z-mystery" })).toBe(DEFAULT_CONFIDENCE);
    expect(estimateConfidence({})).toBe(DEFAULT_CONFIDENCE);
  });
});

describe("clampConfidence", () => {
  it("clamps to [0.10, 0.50]", () => {
    expect(clampConfidence(0.05)).toBe(0.1);
    expect(clampConfidence(0.12)).toBe(0.12);
    expect(clampConfidence(0.45)).toBe(0.45);
    expect(clampConfidence(0.9)).toBe(0.5);
  });
});

describe("stakeFor (bigint bps math)", () => {
  const R = 100_000_000n; // 100 USDC
  it("reward 100e6 @ conf 0.45 -> 45e6", () => {
    expect(stakeFor(R, 0.45)).toBe(45_000_000n);
  });
  it("reward 100e6 @ conf 0.12 -> 12e6", () => {
    expect(stakeFor(R, 0.12)).toBe(12_000_000n);
  });
  it("clamps low: conf 0.05 -> 10e6 (10%)", () => {
    expect(stakeFor(R, 0.05)).toBe(10_000_000n);
  });
  it("clamps high: conf 0.99 -> 50e6 (50%)", () => {
    expect(stakeFor(R, 0.99)).toBe(50_000_000n);
  });
  it("floors integer division (odd reward)", () => {
    // 33 * 0.45 = 14.85 -> 14_850_000 exactly in bps math
    expect(stakeFor(33_000_000n, 0.45)).toBe(14_850_000n);
    // 1 unit reward at 25% -> floor(1*2500/10000) = 0
    expect(stakeFor(1n, 0.25)).toBe(0n);
  });
});

describe("templateFromSpecURI", () => {
  it("extracts template from spec URL", () => {
    expect(templateFromSpecURI("http://localhost:8402/specs/task-a-slugify.json")).toBe("task-a-slugify");
    expect(templateFromSpecURI("https://x/y/task-b-nextbusinessday.json?v=2")).toBe("task-b-nextbusinessday");
  });
});
