// Hidden truth cases for task-a-slugify (the validator's secret — never in specURI).
// 10 cases; a correct solver passes 10/10.

export type SlugCase = { input: string; expected: string };

export const CASES: SlugCase[] = [
  { input: "Hello World", expected: "hello-world" }, // basic lowercase + space
  { input: "Crème Brûlée!", expected: "creme-brulee" }, // NFKD diacritics + punctuation
  { input: "  --A  B--  ", expected: "a-b" }, // collapse runs + trim "-"
  { input: "UPPER_case MIX", expected: "upper-case-mix" }, // underscore is non-alnum
  { input: "Top 10 APIs in 2026", expected: "top-10-apis-in-2026" }, // numerics kept
  { input: "!!!***!!!", expected: "" }, // all non-alnum -> ""
  { input: "", expected: "" }, // empty -> ""
  { input: "São Paulo — Ångström Über Café", expected: "sao-paulo-angstrom-uber-cafe" }, // mixed unicode + em-dash
  {
    input: "the quick brown fox jumps over the lazy dog and keeps going strong",
    expected: "the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps-going-strong",
  }, // long-string pass-through
  { input: "ñoño's Piñata #1", expected: "nono-s-pinata-1" }, // apostrophe/hash runs -> "-"
];
