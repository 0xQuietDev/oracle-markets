// Kalshi-style market board for the selected task: big YES/NO cents with a
// ▲/▼ delta, recharts price-history line, volume + reward, pool split, betting
// countdown and the ⚖️ ERC-8004 resolution source. Settled tasks show the
// outcome prominently with the validator score. Built on a HeroUI Card; a
// multi-task selector uses HeroUI Tabs.

import { Tabs } from "@heroui/react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { centsFromBps, countdown, specName, usd } from "../format.js";
import { currentPBps } from "../store.js";
import type { TaskEntry, TaskState } from "../types.js";
import { PoolsBar } from "./PoolsBar.js";

function displayState(entry: TaskEntry, now: number): TaskState {
  const t = entry.task;
  if (t.state === "Open" && t.betCutoff != null && now > t.betCutoff) return "Executing";
  return t.state;
}

function volumeUnits(entry: TaskEntry): string {
  let total = 0n;
  for (const b of entry.bets) total += BigInt(b.amount || "0");
  return total.toString();
}

function PhaseChip({ state }: { state: TaskState }) {
  const map: Record<string, { color: string; label: string }> = {
    Created: { color: "oklch(0.7 0.02 280)", label: "created" },
    Open: { color: "var(--g1)", label: "betting open" },
    Executing: { color: "oklch(0.82 0.16 85)", label: "executing" },
    Delivered: { color: "var(--g3)", label: "delivered" },
    Settled: { color: "var(--yes)", label: "settled" },
    Cancelled: { color: "oklch(0.7 0.02 280)", label: "cancelled" },
  };
  const m = map[state] ?? map.Created;
  return (
    <span
      className="glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground/85"
      style={{ borderColor: `color-mix(in oklch, ${m.color} 45%, transparent)` }}
    >
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: m.color, boxShadow: `0 0 7px ${m.color}` }}
      />
      {m.label}
    </span>
  );
}

export function MarketBoard({
  entry,
  now,
  order,
  selectedId,
  onSelect,
  taskLabel,
}: {
  entry: TaskEntry | null;
  now: number;
  order: number[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  taskLabel: (id: number) => string;
}) {
  if (!entry) {
    return (
      <section className="glass grad-rim flex h-56 w-full flex-col items-center justify-center gap-2 rounded-2xl text-center">
        <span className="font-display text-lg font-semibold text-foreground/80">
          No market open yet
        </span>
        <span className="text-sm text-muted">
          Post a task below — the fleet will start pricing it live.
        </span>
      </section>
    );
  }

  const t = entry.task;
  const state = displayState(entry, now);
  const settled = state === "Settled" && t.outcome && t.outcome !== "Unresolved";
  const pBps = entry.odds.length > 0 ? entry.odds[entry.odds.length - 1].pBps : currentPBps(t);
  const prevBps = entry.odds.length > 1 ? entry.odds[entry.odds.length - 2].pBps : pBps;
  const yesCents = centsFromBps(pBps);
  const noCents = 100 - yesCents;
  const deltaCents = centsFromBps(pBps) - centsFromBps(prevBps);

  const series = entry.odds.length === 1 ? [entry.odds[0], entry.odds[0]] : entry.odds;
  const data = series.map((o, i) => ({ i, yes: o.pBps / 100 }));

  const countLabel =
    state === "Open" && t.betCutoff != null
      ? `betting closes ${countdown(t.betCutoff - now)}`
      : state === "Settled"
        ? `settled ${t.outcome?.toUpperCase()}`
        : state.toLowerCase();

  const sortedIds = order.slice().sort((a, b) => a - b);
  const yesLeading = yesCents >= noCents;
  const leadCents = yesLeading ? yesCents : noCents;
  const trailCents = yesLeading ? noCents : yesCents;
  const leadLabel = yesLeading ? "YES" : "NO";
  const trailLabel = yesLeading ? "NO" : "YES";
  const leadColor = yesLeading ? "var(--yes)" : "var(--no)";

  return (
    <section className="glass grad-rim brand-glow flex w-full flex-col gap-5 rounded-2xl p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
              Will the worker deliver?
            </h2>
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="font-mono text-foreground/70">{specName(t.specUri)}</span>
              <span className="opacity-40">·</span>
              <span className="font-mono">Task #{t.taskId}</span>
            </p>
          </div>
          <PhaseChip state={state} />
        </div>

        {sortedIds.length > 1 && (
          <Tabs
            selectedKey={selectedId != null ? String(selectedId) : undefined}
            onSelectionChange={(k) => onSelect(Number(k))}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="task selector">
                {sortedIds.map((id) => (
                  <Tabs.Tab key={id} id={String(id)}>
                    {taskLabel(id)}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        )}
      </div>

      <div className="flex flex-col gap-5">
        {settled ? (
          <div
            className="oracle-settle-flash flex items-center justify-between rounded-xl px-5 py-4"
            style={{
              background: `color-mix(in oklch, ${t.outcome === "Yes" ? "var(--yes)" : "var(--no)"} 16%, transparent)`,
              boxShadow: `inset 0 0 0 1px ${t.outcome === "Yes" ? "var(--yes)" : "var(--no)"}`,
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="font-display text-2xl font-bold"
                style={{ color: t.outcome === "Yes" ? "var(--yes)" : "var(--no)" }}
              >
                {t.outcome === "Yes" ? "✓ YES" : "✗ NO"}
              </span>
              <span className="text-sm text-muted">
                {t.outcome === "Yes" ? "worker delivered" : "worker failed"}
              </span>
            </div>
            {t.validatorScore != null && (
              <span
                className="font-mono text-sm font-semibold"
                style={{ color: t.outcome === "Yes" ? "var(--yes)" : "var(--no)" }}
              >
                validator {t.validatorScore}/100
              </span>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(240px,300px)_1fr]">
          {/* prices — THE SIGNATURE */}
          <div className="flex flex-col justify-center gap-3">
            <div className="flex items-end gap-4">
              <div className="flex flex-col leading-none">
                <span
                  className="font-mono text-xs font-semibold tracking-[0.2em]"
                  style={{ color: leadColor }}
                >
                  {leadLabel}
                </span>
                <span className="font-display grad-text grad-shimmer brand-glow tnum text-[5.5rem] font-bold leading-[0.95] tracking-tight">
                  {leadCents}
                  <span className="text-4xl">¢</span>
                </span>
              </div>
              <div
                className="tnum mb-3 flex items-center gap-1 text-sm font-semibold"
                style={{ color: deltaCents >= 0 ? "var(--yes)" : "var(--no)" }}
              >
                <span className="text-base">{deltaCents >= 0 ? "▲" : "▼"}</span>
                <span className="font-mono">{Math.abs(deltaCents)}¢</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">{trailLabel}</span>
              <span className="font-mono tnum font-medium text-foreground/60">{trailCents}¢</span>
            </div>
          </div>

          {/* chart */}
          <div className="h-[150px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="oracle-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--g1)" />
                    <stop offset="50%" stopColor="var(--g2)" />
                    <stop offset="100%" stopColor="var(--g3)" />
                  </linearGradient>
                  <linearGradient id="oracle-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--g2)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--g2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="i" hide />
                <YAxis
                  domain={[0, 100]}
                  width={28}
                  tick={{ fill: "oklch(0.6 0.02 280)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine y={50} stroke="oklch(0.99 0 0 / 0.07)" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.18 0.03 280 / 0.95)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: 10,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    backdropFilter: "blur(8px)",
                  }}
                  labelStyle={{ display: "none" }}
                  formatter={(v: number) => [`${v.toFixed(1)}¢`, "YES"]}
                />
                <Area
                  type="monotone"
                  dataKey="yes"
                  stroke="url(#oracle-line)"
                  strokeWidth={2.5}
                  fill="url(#oracle-fill)"
                  dot={false}
                  isAnimationActive
                  animationDuration={400}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <PoolsBar yesPool={t.yesPool} noPool={t.noPool} />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--glass-border)] pt-4 text-sm text-muted">
          <span className="flex items-baseline gap-1.5">
            <span className="text-xs uppercase tracking-wide">volume</span>
            <strong className="font-mono tnum text-foreground">{usd(volumeUnits(entry))}</strong>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-xs uppercase tracking-wide">reward</span>
            <strong className="font-mono tnum text-foreground">{usd(t.reward)}</strong>
          </span>
          <span className="font-mono tnum font-medium text-foreground/90">{countLabel}</span>
          <span
            className="glass ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground/85"
            title="resolved on-chain via ERC-8004 validation"
          >
            ⚖️ ERC-8004
          </span>
        </div>
      </div>
    </section>
  );
}
