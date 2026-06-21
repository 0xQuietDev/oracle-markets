// Reusable YES-odds price chart (recharts area), terminal-styled. `tall` gives
// the dominant detail-view chart; otherwise a compact card sparkline. The line
// color follows the outcome lean (green when YES>=50, red otherwise) so the
// chart reads at a glance with the disciplined palette.

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function PriceChart({
  data,
  height = 150,
  axes = true,
  yesLeading = true,
}: {
  data: { i: number; yes: number }[];
  height?: number;
  axes?: boolean;
  yesLeading?: boolean;
}) {
  const stroke = yesLeading ? "var(--yes)" : "var(--no)";
  const gradId = `oracle-fill-${yesLeading ? "yes" : "no"}`;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: axes ? 8 : 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          {axes ? (
            <YAxis
              domain={[0, 100]}
              width={30}
              tick={{ fill: "oklch(0.6 0.01 265)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}¢`}
            />
          ) : (
            <YAxis domain={[0, 100]} hide />
          )}
          {axes && (
            <ReferenceLine y={50} stroke="oklch(0.99 0 0 / 0.06)" strokeDasharray="4 4" />
          )}
          {axes && (
            <Tooltip
              contentStyle={{
                background: "oklch(0.18 0.008 265 / 0.96)",
                border: "1px solid var(--glass-border)",
                borderRadius: 10,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                backdropFilter: "blur(8px)",
              }}
              labelStyle={{ display: "none" }}
              formatter={(v: number) => [`${v.toFixed(1)}¢`, "YES"]}
            />
          )}
          <Area
            type="monotone"
            dataKey="yes"
            stroke={stroke}
            strokeWidth={axes ? 2 : 1.5}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={axes}
            animationDuration={400}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
