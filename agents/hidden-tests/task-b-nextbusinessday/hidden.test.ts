// Validator-only hidden suite for task-b-nextbusinessday.
// At validation time the deliverable is copied next to this file as
// `solution.ts`; this suite is excluded from the normal agents test run.
import { describe, expect, it } from "vitest";
import { CASES } from "./cases";
// @ts-expect-error — solution.ts exists only in the validator's working dir
import { nextBusinessDay } from "./solution";

describe("hidden: task-b-nextbusinessday", () => {
  for (const [i, c] of CASES.entries()) {
    const hops = c.hops ?? 1;
    it(`case ${i + 1}: ${c.input} x${hops} -> ${c.expected}`, () => {
      let d = c.input;
      for (let k = 0; k < hops; k++) d = nextBusinessDay(d, "IN");
      expect(d).toBe(c.expected);
    });
  }
});
