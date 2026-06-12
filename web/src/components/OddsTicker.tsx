import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { pctFromBps } from "../format";
import type { OddsPoint } from "../types";

/**
 * The on-stage centerpiece: a big current-probability numeral plus a recharts
 * line of p over time. The numeral is keyed by value so each bet re-triggers
 * the flip animation; the line animates (400ms) on every new point.
 */
export function OddsTicker({ odds, pBps }: { odds: OddsPoint[]; pBps: number }) {
  // a single point draws nothing — pad it so a flat line shows pre-bets
  const series = odds.length === 1 ? [odds[0], odds[0]] : odds;
  const data = series.map((o, i) => ({ i, p: o.pBps / 100 }));
  const bullish = pBps >= 5000;
  const color = bullish ? "var(--yes)" : "var(--no)";

  return (
    <div className="odds-ticker">
      <div className="odds-numeral" key={pBps} style={{ color }}>
        <span className="odds-value">{pctFromBps(pBps)}</span>
        <span className="odds-unit">%</span>
        <div className="odds-caption">P(success)</div>
      </div>
      <div className="odds-chart">
        <ResponsiveContainer width="100%" height={110}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <XAxis dataKey="i" hide />
            <YAxis domain={[0, 100]} hide />
            <ReferenceLine y={50} stroke="#273052" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="p"
              stroke={color}
              strokeWidth={3}
              dot={false}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
