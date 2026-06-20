// Kalshi-style market board for the selected task: big YES/NO cents with a
// ▲/▼ delta, recharts price-history line, volume + reward, pool split, betting
// countdown and the ⚖️ ERC-8004 resolution source. Settled tasks show the
// outcome prominently with the validator score. Built on a HeroUI Card; a
// multi-task selector uses HeroUI Tabs.

import { Card, Chip, Tabs } from "@heroui/react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
  const map: Record<string, { color: "accent" | "success" | "warning" | "default"; label: string }> = {
    Created: { color: "default", label: "created" },
    Open: { color: "accent", label: "betting open" },
    Executing: { color: "warning", label: "executing" },
    Delivered: { color: "accent", label: "delivered" },
    Settled: { color: "success", label: "settled" },
    Cancelled: { color: "default", label: "cancelled" },
  };
  const m = map[state] ?? map.Created;
  return (
    <Chip size="sm" variant="soft" color={m.color}>
      <Chip.Label>{m.label}</Chip.Label>
    </Chip>
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
      <Card className="w-full">
        <Card.Content className="flex h-48 items-center justify-center text-center text-muted">
          Waiting for the first market to open…
        </Card.Content>
      </Card>
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
  const bullish = pBps >= 5000;

  const countLabel =
    state === "Open" && t.betCutoff != null
      ? `betting closes ${countdown(t.betCutoff - now)}`
      : state === "Settled"
        ? `settled ${t.outcome?.toUpperCase()}`
        : state.toLowerCase();

  const sortedIds = order.slice().sort((a, b) => a - b);

  return (
    <Card className="w-full">
      <Card.Header className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Card.Title className="font-mono text-base">{specName(t.specUri)}</Card.Title>
            <Card.Description>Will the worker deliver? · Task #{t.taskId}</Card.Description>
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
      </Card.Header>

      <Card.Content className="flex flex-col gap-4">
        {settled ? (
          <div
            className={`oracle-settle-flash flex items-center justify-between rounded-xl px-4 py-3 ${
              t.outcome === "Yes"
                ? "bg-[color-mix(in_oklch,var(--yes)_18%,transparent)] ring-1 ring-[var(--yes)]"
                : "bg-[color-mix(in_oklch,var(--no)_18%,transparent)] ring-1 ring-[var(--no)]"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className="text-2xl font-bold"
                style={{ color: t.outcome === "Yes" ? "var(--yes)" : "var(--no)" }}
              >
                {t.outcome === "Yes" ? "✓ YES" : "✗ NO"}
              </span>
              <span className="text-sm text-muted">
                {t.outcome === "Yes" ? "worker delivered" : "worker failed"}
              </span>
            </div>
            {t.validatorScore != null && (
              <Chip variant="soft" color={t.outcome === "Yes" ? "success" : "danger"}>
                <Chip.Label>validator {t.validatorScore}/100</Chip.Label>
              </Chip>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
          {/* prices */}
          <div className="flex items-center gap-3">
            <div className="flex flex-1 flex-col items-center rounded-xl bg-[color-mix(in_oklch,var(--yes)_12%,var(--surface-secondary))] px-3 py-3 ring-1 ring-[color-mix(in_oklch,var(--yes)_40%,transparent)]">
              <span className="text-xs font-semibold tracking-wide text-[var(--yes)]">YES</span>
              <span className="tnum text-3xl font-bold text-foreground">{yesCents}¢</span>
            </div>
            <div className="flex flex-1 flex-col items-center rounded-xl bg-[color-mix(in_oklch,var(--no)_12%,var(--surface-secondary))] px-3 py-3 ring-1 ring-[color-mix(in_oklch,var(--no)_40%,transparent)]">
              <span className="text-xs font-semibold tracking-wide text-[var(--no)]">NO</span>
              <span className="tnum text-3xl font-bold text-foreground">{noCents}¢</span>
            </div>
            <div
              className="tnum flex flex-col items-center text-sm font-semibold"
              style={{ color: deltaCents >= 0 ? "var(--yes)" : "var(--no)" }}
            >
              <span className="text-lg">{deltaCents >= 0 ? "▲" : "▼"}</span>
              <span>{Math.abs(deltaCents)}¢</span>
            </div>
          </div>

          {/* chart */}
          <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
                <XAxis dataKey="i" hide />
                <YAxis domain={[0, 100]} width={28} tick={{ fill: "#5b6486", fontSize: 10 }} />
                <ReferenceLine y={50} stroke="#273052" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.18 0.02 265)",
                    border: "1px solid #273052",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  labelStyle={{ display: "none" }}
                  formatter={(v: number) => [`${v.toFixed(1)}¢`, "YES"]}
                />
                <Line
                  type="monotone"
                  dataKey="yes"
                  stroke={bullish ? "var(--yes)" : "var(--no)"}
                  strokeWidth={3}
                  dot={false}
                  isAnimationActive
                  animationDuration={400}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <PoolsBar yesPool={t.yesPool} noPool={t.noPool} />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm tnum text-muted">
          <span>
            volume <strong className="text-foreground">{usd(volumeUnits(entry))}</strong>
          </span>
          <span>
            reward <strong className="text-foreground">{usd(t.reward)}</strong>
          </span>
          <span className="font-medium text-foreground">{countLabel}</span>
          <span className="ml-auto" title="resolved on-chain via ERC-8004 validation">
            <Chip size="sm" variant="soft" color="accent">
              <Chip.Label>⚖️ ERC-8004</Chip.Label>
            </Chip>
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}
