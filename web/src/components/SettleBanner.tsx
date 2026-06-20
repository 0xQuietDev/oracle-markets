// Transient 3s flash played when a `settled` message lands live. Green
// "YES — worker paid" or red "NO — self-stake flows to the skeptics", with the
// validator score + resolution rule. Pure Tailwind + tokens; unmounts after 3s.

import { useEffect, useState } from "react";

export function SettleBanner({
  outcome,
  validatorScore,
  viaRule,
}: {
  outcome: "Yes" | "No";
  validatorScore: number | null;
  viaRule: number | null;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;
  const yes = outcome === "Yes";
  const tone = yes ? "var(--yes)" : "var(--no)";

  return (
    <div
      className="oracle-settle-flash flex items-center gap-4 rounded-xl px-5 py-4"
      style={{
        background: `color-mix(in oklch, ${tone} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px ${tone}`,
      }}
    >
      <span className="text-3xl font-bold" style={{ color: tone }}>
        {yes ? "✓" : "✗"}
      </span>
      <div className="flex flex-col">
        <span className="text-base font-semibold text-foreground">
          {yes ? "YES — worker paid" : "NO — self-stake flows to the skeptics"}
        </span>
        <span className="tnum text-sm text-muted">
          {validatorScore != null && <>validator score {validatorScore}/100</>}
          {viaRule != null && <> · via R{viaRule}</>}
        </span>
      </div>
    </div>
  );
}
