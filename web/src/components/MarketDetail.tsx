// MARKET DETAIL — the heart. Two columns.
// LEFT (main): breadcrumb back to Markets; title; big YES/NO prices with ▲/▼;
// a dominant price-history chart; a Resolution line; and tabs for Activity
// (this task's reasoning feed), How it settles (the flow canvas), and On-chain
// (this task's tx trail → TxDrawer).
// RIGHT (sticky rail): the Trade ticket + Order flow.

import { Tabs } from "@heroui/react";
import { useState } from "react";
import { specName, usd } from "../format.js";
import {
  displayState,
  isSettled,
  phaseMeta,
  priceSeries,
  prices,
  volumeUnits,
} from "../market.js";
import type { ActivityItem, StoreState, TaskEntry } from "../types.js";
import { AgentFeed } from "./AgentFeed.js";
import { FlowCanvas } from "./FlowCanvas.js";
import { OrderFlow } from "./OrderFlow.js";
import { PriceChart } from "./PriceChart.js";
import { TxRail } from "./TxRail.js";

type Tab = "activity" | "flow" | "onchain";

export function MarketDetail({
  entry,
  state,
  now,
  onBack,
  onOpenTx,
  onOpenAgent,
  onOpenCode,
}: {
  entry: TaskEntry;
  state: StoreState;
  now: number;
  onBack: () => void;
  onOpenTx: (hash: string) => void;
  onOpenAgent: (role: string, label: string) => void;
  onOpenCode: (item: ActivityItem) => void;
}) {
  const [tab, setTab] = useState<Tab>("activity");
  const t = entry.task;
  const phase = displayState(entry, now);
  const settled = isSettled(entry, now);
  const meta = phaseMeta(phase);
  const { yesCents, noCents, deltaCents } = prices(entry);
  const yesLeading = yesCents >= noCents;
  const series = priceSeries(entry);

  const taskActivity = state.activity.filter((a) => a.taskId === t.taskId);
  const taskTxs = state.txs.filter((x) => x.taskId === t.taskId);

  return (
    <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-5 px-5 py-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      {/* LEFT */}
      <div className="flex min-w-0 flex-col gap-5">
        <button
          type="button"
          onClick={onBack}
          className="self-start text-sm text-muted transition-colors hover:text-foreground"
        >
          ← Markets
        </button>

        {/* header + prices */}
        <div className="glass flex flex-col gap-5 rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
                Will the worker deliver {specName(t.specUri)}()?
              </h1>
              <span className="font-mono text-xs text-muted tnum">Task #{t.taskId}</span>
            </div>
            {settled && t.outcome ? (
              <span
                className="rounded-md px-3 py-1 text-sm font-bold"
                style={{
                  color: t.outcome === "Yes" ? "var(--yes)" : "var(--no)",
                  background: `color-mix(in oklch, ${t.outcome === "Yes" ? "var(--yes)" : "var(--no)"} 14%, transparent)`,
                }}
              >
                {t.outcome === "Yes" ? "✓ YES" : "✗ NO"}
                {t.validatorScore != null && (
                  <span className="ml-2 font-mono text-xs font-medium opacity-80">
                    {t.validatorScore}/100
                  </span>
                )}
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-foreground/85"
                style={{ borderColor: `color-mix(in oklch, ${meta.color} 45%, transparent)` }}
              >
                <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
                {meta.label}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <div className="flex flex-col leading-none">
              <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-[var(--yes)]">
                YES
              </span>
              <span className="font-display tnum text-5xl font-bold text-foreground">
                {yesCents}
                <span className="text-2xl text-muted">¢</span>
              </span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-[var(--no)]">
                NO
              </span>
              <span className="font-display tnum text-5xl font-bold text-foreground/70">
                {noCents}
                <span className="text-2xl text-muted">¢</span>
              </span>
            </div>
            <div
              className="mb-2 flex items-center gap-1 text-sm font-semibold tnum"
              style={{ color: deltaCents >= 0 ? "var(--yes)" : "var(--no)" }}
            >
              <span>{deltaCents >= 0 ? "▲" : "▼"}</span>
              <span className="font-mono">{Math.abs(deltaCents)}¢</span>
            </div>
          </div>

          {/* dominant chart */}
          <PriceChart data={series} height={320} axes yesLeading={yesLeading} />

          {/* meta row + resolution */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--hairline)] pt-4 text-sm text-muted">
            <span className="flex items-baseline gap-1.5">
              <span className="text-xs uppercase tracking-wide">volume</span>
              <strong className="font-mono tnum text-foreground">{usd(volumeUnits(entry))}</strong>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-xs uppercase tracking-wide">reward</span>
              <strong className="font-mono tnum text-foreground">{usd(t.reward)}</strong>
            </span>
            <span className="ml-auto font-mono text-xs">
              Resolves via ERC-8004 validator · threshold 80
            </span>
          </div>
        </div>

        {/* tabs: activity / flow / on-chain */}
        <Tabs
          selectedKey={tab}
          onSelectionChange={(k) => setTab(k as Tab)}
          aria-label="Market detail sections"
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="sections">
              <Tabs.Tab id="activity">
                Activity
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="flow">
                <Tabs.Separator />
                How it settles
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="onchain">
                <Tabs.Separator />
                On-chain
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="activity" className="pt-4">
            <div className="h-[420px]">
              <AgentFeed items={taskActivity} onOpenCode={onOpenCode} />
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="flow" className="pt-4">
            <FlowCanvas phase={phase} lastPulse={state.lastPulse} onOpenAgent={onOpenAgent} />
          </Tabs.Panel>

          <Tabs.Panel id="onchain" className="pt-4">
            <div className="glass flex flex-col gap-3 rounded-2xl p-4">
              {taskTxs.length === 0 ? (
                <p className="text-sm text-muted">No on-chain transactions yet for this market.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {taskTxs
                    .slice()
                    .reverse()
                    .map((x, i) => (
                      <li key={`${x.txHash}-${i}`}>
                        <button
                          type="button"
                          onClick={() => onOpenTx(x.txHash)}
                          className="flex w-full items-center gap-3 rounded-lg border border-[var(--hairline)] px-3 py-2 text-left transition-colors hover:border-[var(--glass-border)] hover:bg-[var(--glass-bg-2)]"
                        >
                          <span className="text-sm font-medium text-foreground">
                            {x.label ?? x.kind}
                          </span>
                          <span className="ml-auto font-mono text-xs text-accent">
                            view receipt →
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>

      {/* RIGHT rail — the agent "honesty market" (no human betting) */}
      <div className="flex min-h-0 flex-col gap-4 xl:sticky xl:top-[4.5rem] xl:h-[calc(100vh-6rem)]">
        <OrderFlow bets={entry.bets} />
        <TxRail txs={taskTxs} onOpenTx={onOpenTx} />
      </div>
    </div>
  );
}
