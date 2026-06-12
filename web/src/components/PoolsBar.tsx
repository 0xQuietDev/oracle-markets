import { usd } from "../format";

/**
 * YES vs NO stacked horizontal bar with USDC labels. Widths animate via CSS
 * transition so every bet visibly shifts the balance of capital.
 */
export function PoolsBar({ yesPool, noPool }: { yesPool: string; noPool: string }) {
  const yes = Number(yesPool) / 1e6;
  const no = Number(noPool) / 1e6;
  const total = yes + no;
  const yesPct = total > 0 ? (yes / total) * 100 : 50;

  return (
    <div className="pools">
      <div className="pools-bar">
        <div className="pools-yes" style={{ width: `${yesPct}%` }} />
        <div className="pools-no" style={{ width: `${100 - yesPct}%` }} />
      </div>
      <div className="pools-labels">
        <span className="side-yes">YES {usd(yesPool)}</span>
        <span className="side-no">NO {usd(noPool)}</span>
      </div>
    </div>
  );
}
