import { useEffect, useState } from "react";

/**
 * 3-second full-card overlay played when a `settled` message lands live:
 * green "YES — worker paid" or red "NO — self-stake flows to the skeptics",
 * with the validator score and resolution rule. Pure CSS keyframes; the
 * component unmounts itself after 3s and the card's settled badge remains.
 */
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

  return (
    <div className={"settle-banner " + (yes ? "settle-yes" : "settle-no")}>
      <div className="settle-mark">{yes ? "✓" : "✗"}</div>
      <div className="settle-title">
        {yes ? "YES — worker paid" : "NO — self-stake flows to the skeptics"}
      </div>
      <div className="settle-sub">
        {validatorScore != null && <span>validator score {validatorScore}/100</span>}
        {viaRule != null && <span> · via R{viaRule}</span>}
      </div>
    </div>
  );
}
