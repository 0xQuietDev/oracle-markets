// One market in the Markets grid (Polymarket-style). Shows the market question,
// an inline YES-odds sparkline, big YES ¢ / NO ¢, volume, a status pill, and —
// on settled — a YES/NO outcome badge. The whole card is a button that opens
// that market's detail view.

import { specName, usd } from "../format.js";
import {
  displayState,
  isSettled,
  phaseMeta,
  priceSeries,
  prices,
  volumeUnits,
} from "../market.js";
import type { TaskEntry } from "../types.js";
import { PriceChart } from "./PriceChart.js";

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-foreground/85"
      style={{ borderColor: `color-mix(in oklch, ${color} 45%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function MarketCard({
  entry,
  now,
  onOpen,
}: {
  entry: TaskEntry;
  now: number;
  onOpen: (id: number) => void;
}) {
  const t = entry.task;
  const state = displayState(entry, now);
  const settled = isSettled(entry, now);
  const meta = phaseMeta(state);
  const { yesCents, noCents } = prices(entry);
  const yesLeading = yesCents >= noCents;
  const series = priceSeries(entry);

  return (
    <button
      type="button"
      onClick={() => onOpen(t.taskId)}
      className="card flex flex-col gap-3 p-4 text-left"
      aria-label={`Open market #${t.taskId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-display text-[15px] font-semibold leading-snug text-foreground">
            Will the worker deliver {specName(t.specUri)}()?
          </h3>
          <span className="font-mono text-[11px] text-muted">Task #{t.taskId}</span>
        </div>
        {settled && t.outcome ? (
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-xs font-bold"
            style={{
              color: t.outcome === "Yes" ? "var(--yes)" : "var(--no)",
              background: `color-mix(in oklch, ${t.outcome === "Yes" ? "var(--yes)" : "var(--no)"} 14%, transparent)`,
            }}
          >
            {t.outcome === "Yes" ? "✓ YES" : "✗ NO"}
          </span>
        ) : (
          <StatusPill label={meta.label} color={meta.color} />
        )}
      </div>

      {/* sparkline */}
      <PriceChart data={series} height={44} axes={false} yesLeading={yesLeading} />

      {/* prices */}
      <div className="flex items-end gap-4">
        <div className="flex flex-col leading-none">
          <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-[var(--yes)]">
            YES
          </span>
          <span className="font-display tnum text-2xl font-bold text-foreground">
            {yesCents}
            <span className="text-base text-muted">¢</span>
          </span>
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-[var(--no)]">
            NO
          </span>
          <span className="font-display tnum text-2xl font-bold text-foreground/70">
            {noCents}
            <span className="text-base text-muted">¢</span>
          </span>
        </div>
        <span className="ml-auto flex flex-col items-end leading-none">
          <span className="text-[10px] uppercase tracking-wide text-muted">volume</span>
          <span className="font-mono tnum text-sm font-medium text-foreground/90">
            {usd(volumeUnits(entry))}
          </span>
        </span>
      </div>
    </button>
  );
}
