// Task B solver — DELIBERATELY NAIVE (plan §5/C1, DESIGN §8.4).
//
// It implements exactly the PUBLIC spec: skip Sat/Sun + only the four national
// holidays listed in task-b-nextbusinessday.json. The validator's hidden truth
// calendar additionally contains Pongal (2026-01-15) and Onam (2026-08-26),
// which this solver does not know about — by design it scores exactly 5/10 on
// the hidden suite (50 < threshold 80 => outcome NO). Do NOT "fix" this file.
//
// IMPORTANT: fully standalone (no imports) — uploaded verbatim as the
// deliverable; the hidden suite imports `./solution` expecting the named
// export `nextBusinessDay`.

const NATIONAL_HOLIDAYS_IN: ReadonlySet<string> = new Set([
  "2026-01-26", // Republic Day
  "2026-08-15", // Independence Day
  "2026-10-02", // Gandhi Jayanti
  "2026-12-25", // Christmas
]);

const DAY_MS = 86_400_000;

/** Returns the next strictly-later business day (ISO yyyy-mm-dd), region IN. */
export function nextBusinessDay(dateISO: string, region: "IN" = "IN"): string {
  void region; // only "IN" supported in v1
  const [y, m, d] = dateISO.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d);
  for (;;) {
    t += DAY_MS;
    const dt = new Date(t);
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue; // Sun / Sat
    const iso = dt.toISOString().slice(0, 10);
    if (NATIONAL_HOLIDAYS_IN.has(iso)) continue;
    return iso;
  }
}
