// Pure market-derivation helpers shared by the card grid and the detail view so
// they always agree on prices, volume, phase and the displayed state. No I/O,
// no React — just functions over a TaskEntry (+ a `now` for the Open→Executing
// flip). Money stays in USDC units (6dp) strings; divide by 1e6 for display only.

import { centsFromBps } from "./format.js";
import { currentPBps } from "./store.js";
import type { TaskEntry, TaskState } from "./types.js";

/** Open && now past betCutoff → the UI-only "Executing" label. */
export function displayState(entry: TaskEntry, now: number): TaskState {
  const t = entry.task;
  if (t.state === "Open" && t.betCutoff != null && now > t.betCutoff) return "Executing";
  return t.state;
}

/** Settled with a real outcome (not Unresolved). */
export function isSettled(entry: TaskEntry, now: number): boolean {
  return (
    displayState(entry, now) === "Settled" &&
    !!entry.task.outcome &&
    entry.task.outcome !== "Unresolved"
  );
}

/** Betting is open only while the on-chain state is Open and the cutoff hasn't passed. */
export function bettingOpen(entry: TaskEntry, now: number): boolean {
  return displayState(entry, now) === "Open";
}

/** Total wagered across all recorded bets, USDC units string. */
export function volumeUnits(entry: TaskEntry): string {
  let total = 0n;
  for (const b of entry.bets) total += BigInt(b.amount || "0");
  return total.toString();
}

export interface Prices {
  pBps: number;
  yesCents: number;
  noCents: number;
  /** YES cents delta vs the previous odds point */
  deltaCents: number;
}

/** Current YES/NO cents + delta from the odds series (falls back to pool ratio). */
export function prices(entry: TaskEntry): Prices {
  const odds = entry.odds;
  const pBps = odds.length > 0 ? odds[odds.length - 1].pBps : currentPBps(entry.task);
  const prevBps = odds.length > 1 ? odds[odds.length - 2].pBps : pBps;
  const yesCents = centsFromBps(pBps);
  return {
    pBps,
    yesCents,
    noCents: 100 - yesCents,
    deltaCents: centsFromBps(pBps) - centsFromBps(prevBps),
  };
}

/** Sparkline / chart data: [{ i, yes }] in cents; pads a single point so a line shows. */
export function priceSeries(entry: TaskEntry): { i: number; yes: number }[] {
  const series = entry.odds.length === 1 ? [entry.odds[0], entry.odds[0]] : entry.odds;
  return series.map((o, i) => ({ i, yes: o.pBps / 100 }));
}

export interface PhaseMeta {
  label: string;
  /** css color token/value for the status dot + pill border */
  color: string;
}

export function phaseMeta(state: TaskState): PhaseMeta {
  const map: Record<string, PhaseMeta> = {
    Created: { label: "awaiting worker", color: "oklch(0.8 0.15 85)" },
    Open: { label: "betting open", color: "var(--accent)" },
    Executing: { label: "executing", color: "oklch(0.8 0.15 85)" },
    Delivered: { label: "delivered", color: "oklch(0.7 0.13 230)" },
    Settled: { label: "settled", color: "var(--yes)" },
    Cancelled: { label: "cancelled", color: "oklch(0.66 0.02 260)" },
  };
  return map[state] ?? map.Created;
}
