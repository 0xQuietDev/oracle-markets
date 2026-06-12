import { useEffect, useState } from "react";
import { usd } from "../format";

/**
 * "Worker staked $X on itself" — DESIGN §13 step 2. Glows for ~5s whenever the
 * stake value (re)appears, then settles into a quiet badge.
 */
export function StakeBadge({ selfStake }: { selfStake: string }) {
  const [fresh, setFresh] = useState(true);

  useEffect(() => {
    setFresh(true);
    const t = setTimeout(() => setFresh(false), 5000);
    return () => clearTimeout(t);
  }, [selfStake]);

  return (
    <div className={"stake-badge" + (fresh ? " stake-fresh" : "")}>
      <span className="stake-icon">🤖</span>
      Worker staked <strong>{usd(selfStake)}</strong> on itself
    </div>
  );
}
