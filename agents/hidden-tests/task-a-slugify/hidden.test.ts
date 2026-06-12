// Validator-only hidden suite for task-a-slugify.
// At validation time the deliverable is copied next to this file as
// `solution.ts`; this suite is excluded from the normal agents test run.
import { describe, expect, it } from "vitest";
import { CASES } from "./cases";
// @ts-expect-error — solution.ts exists only in the validator's working dir
import { slugify } from "./solution";

describe("hidden: task-a-slugify", () => {
  for (const [i, c] of CASES.entries()) {
    it(`case ${i + 1}: ${JSON.stringify(c.input)} -> ${JSON.stringify(c.expected)}`, () => {
      expect(slugify(c.input)).toBe(c.expected);
    });
  }
});
