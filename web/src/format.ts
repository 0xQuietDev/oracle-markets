// Display helpers. Money arrives as decimal strings of USDC *units*
// (6 decimals) — divide by 1e6 here for display ONLY, never re-scale
// anywhere else (DESIGN §7.4 S5).

export function usd(units: string | null | undefined): string {
  if (!units) return "$0";
  const n = Number(units) / 1e6;
  if (!Number.isFinite(n)) return "$0";
  return (
    "$" +
    n.toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    })
  );
}

export function pctFromBps(pBps: number): string {
  return (pBps / 100).toFixed(1);
}

/** mm:ss countdown; clamps at 0:00. */
export function countdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "task-a-slugify" from ".../specs/task-a-slugify.json" */
export function specName(specUri: string): string {
  const last = specUri.split("/").pop() ?? specUri;
  return last.replace(/\.json$/i, "");
}

/** 0x1234…cdef — short hash/address for chips. */
export function shortHash(h: string | null | undefined): string {
  if (!h) return "—";
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

/** ¢ price (0..100) from probability bps. */
export function centsFromBps(pBps: number): number {
  return Math.round(pBps / 100);
}

/** wall-clock HH:MM:SS from a unix-ms (or unix-s) timestamp. */
export function clockTime(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour12: false });
}
