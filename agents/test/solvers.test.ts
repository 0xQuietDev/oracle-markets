// Proves the exact hidden-suite pass counts (plan §5/C2) by importing the
// hidden cases.ts data directly (NOT hidden.test.ts — those run only inside
// the validator's working dir where solution.ts exists).
import { describe, expect, it } from "vitest";
import { CASES as SLUG_CASES } from "../hidden-tests/task-a-slugify/cases.js";
import { CASES as NBD_CASES } from "../hidden-tests/task-b-nextbusinessday/cases.js";
import { nextBusinessDay } from "../src/lib/solvers/next-business-day.js";
import { slugify } from "../src/lib/solvers/slugify.js";

describe("slugify (correct solver)", () => {
  it("basic behavior", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Crème Brûlée!")).toBe("creme-brulee");
    expect(slugify("  --A  B--  ")).toBe("a-b");
    expect(slugify("")).toBe("");
  });

  it("hidden suite has exactly 10 cases", () => {
    expect(SLUG_CASES.length).toBe(10);
  });

  it("passes 10/10 hidden cases", () => {
    const passed = SLUG_CASES.filter((c) => slugify(c.input) === c.expected).length;
    expect(passed).toBe(10);
  });
});

describe("nextBusinessDay (deliberately naive solver)", () => {
  it("skips weekends", () => {
    expect(nextBusinessDay("2026-06-12", "IN")).toBe("2026-06-15"); // Fri -> Mon
  });

  it("skips public national holidays", () => {
    expect(nextBusinessDay("2026-01-23", "IN")).toBe("2026-01-27"); // weekend + Republic Day
    expect(nextBusinessDay("2026-12-24", "IN")).toBe("2026-12-28"); // Christmas Fri + weekend
  });

  it("does NOT know the hidden regional holidays (that is the point)", () => {
    expect(nextBusinessDay("2026-01-14", "IN")).toBe("2026-01-15"); // truth: 2026-01-16 (Pongal)
    expect(nextBusinessDay("2026-08-25", "IN")).toBe("2026-08-26"); // truth: 2026-08-27 (Onam)
  });

  it("hidden suite has exactly 10 cases", () => {
    expect(NBD_CASES.length).toBe(10);
  });

  it("passes EXACTLY 5/10 hidden cases (score 50 < threshold 80 => NO)", () => {
    const passed = NBD_CASES.filter((c) => {
      let d = c.input;
      for (let k = 0; k < (c.hops ?? 1); k++) d = nextBusinessDay(d, "IN");
      return d === c.expected;
    }).length;
    expect(passed).toBe(5);
  });
});
