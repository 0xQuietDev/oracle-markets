// Kalshi-style market board for the current / selected task: YES/NO in cents,
// delta, recharts price-history line, volume, pool split bar, betting
// countdown, and the ⚖️ ERC-8004 resolution source. A→B task selector when
// more than one task exists.

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
  // sum of all bet stakes (the traded volume), USDC units
  let total = 0n;
  for (const b of entry.bets) total += BigInt(b.amount || "0");
  return total.toString();
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
      <section className="market-board market-empty">
        <div className="board-wait">waiting for the first market to open…</div>
      </section>
    );
  }

  const t = entry.task;
  const state = displayState(entry, now);
  const pBps = entry.odds.length > 0 ? entry.odds[entry.odds.length - 1].pBps : currentPBps(t);
  const prevBps = entry.odds.length > 1 ? entry.odds[entry.odds.length - 2].pBps : pBps;
  const yesCents = centsFromBps(pBps);
  const noCents = 100 - yesCents;
  const deltaCents = centsFromBps(pBps) - centsFromBps(prevBps);

  // pad a single point so the line renders flat pre-bets
  const series = entry.odds.length === 1 ? [entry.odds[0], entry.odds[0]] : entry.odds;
  const data = series.map((o, i) => ({ i, yes: o.pBps / 100 }));
  const bullish = pBps >= 5000;

  const countLabel =
    state === "Open" && t.betCutoff != null
      ? `betting closes ${countdown(t.betCutoff - now)}`
      : state === "Settled"
        ? `settled ${t.outcome?.toUpperCase()}`
        : state.toLowerCase();

  return (
    <section className="market-board">
      <header className="board-head">
        <div className="board-title">
          <span className="board-spec">{specName(t.specUri)}</span>
          <span className="board-q">Will the worker deliver? · Task #{t.taskId}</span>
        </div>
        {order.length > 1 && (
          <div className="task-switch" role="tablist" aria-label="task selector">
            {order
              .slice()
              .sort((a, b) => a - b)
              .map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={id === selectedId}
                  className={"switch-pill" + (id === selectedId ? " switch-on" : "")}
                  onClick={() => onSelect(id)}
                >
                  {taskLabel(id)}
                </button>
              ))}
          </div>
        )}
      </header>

      <div className="board-body">
        <div className="board-prices">
          <div className="price-cell price-yes">
            <div className="price-side">YES</div>
            <div className="price-cents">{yesCents}¢</div>
          </div>
          <div className="price-cell price-no">
            <div className="price-side">NO</div>
            <div className="price-cents">{noCents}¢</div>
          </div>
          <div className={"price-delta " + (deltaCents >= 0 ? "delta-up" : "delta-down")}>
            {deltaCents >= 0 ? "▲" : "▼"} {Math.abs(deltaCents)}¢
          </div>
        </div>

        <div className="board-chart">
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={data} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
              <XAxis dataKey="i" hide />
              <YAxis domain={[0, 100]} width={28} tick={{ fill: "#5b6486", fontSize: 10 }} />
              <ReferenceLine y={50} stroke="#273052" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: "#0d1326", border: "1px solid #273052", fontSize: 11 }}
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

      <div className="board-foot">
        <PoolsBar yesPool={t.yesPool} noPool={t.noPool} />
        <div className="board-stats">
          <span>
            volume <strong>{usd(volumeUnits(entry))}</strong>
          </span>
          <span>
            reward <strong>{usd(t.reward)}</strong>
          </span>
          <span className="board-count">{countLabel}</span>
          <span className="board-source" title="resolved on-chain via ERC-8004 validation">
            ⚖️ ERC-8004
          </span>
        </div>
      </div>
    </section>
  );
}
