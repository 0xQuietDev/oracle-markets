// Hidden truth cases for task-b-nextbusinessday (the validator's secret).
//
// Truth calendar = the public national holidays (2026-01-26, 2026-08-15,
// 2026-10-02, 2026-12-25) PLUS two holidays deliberately absent from the
// public spec: Pongal (Thu 2026-01-15) and Onam (Wed 2026-08-26).
//
// `hops` = number of times nextBusinessDay is applied (default 1) — multi-hop
// cases walk the calendar across the hidden holidays so the naive solver
// (public calendar only) fails exactly the 5 cases marked DIVERGES.

export type NbdCase = { input: string; hops?: number; expected: string };

export const CASES: NbdCase[] = [
  // --- naive solver passes these 5 ---
  { input: "2026-01-23", expected: "2026-01-27" }, // Fri -> weekend + Republic Day (public)
  { input: "2026-08-14", expected: "2026-08-17" }, // Fri -> Independence Day (Sat) + weekend
  { input: "2026-10-01", expected: "2026-10-05" }, // Thu -> Gandhi Jayanti (Fri) + weekend
  { input: "2026-12-24", expected: "2026-12-28" }, // Thu -> Christmas (Fri) + weekend
  { input: "2026-12-31", expected: "2027-01-01" }, // year boundary, plain Friday
  // --- naive solver fails these 5 (DIVERGES: hidden Pongal / Onam) ---
  { input: "2026-01-14", expected: "2026-01-16" }, // Wed -> skips Pongal (Thu 01-15)
  { input: "2026-01-13", hops: 2, expected: "2026-01-16" }, // Tue -> Wed -> skips Pongal
  { input: "2026-08-25", expected: "2026-08-27" }, // Tue -> skips Onam (Wed 08-26)
  { input: "2026-08-24", hops: 2, expected: "2026-08-27" }, // Mon -> Tue -> skips Onam
  { input: "2026-08-21", hops: 3, expected: "2026-08-27" }, // Fri -> Mon -> Tue -> skips Onam
];
