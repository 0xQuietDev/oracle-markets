import { usd } from "../format.js";

/**
 * YES vs NO capital split — a custom token-driven bar (green/red) so every bet
 * visibly shifts the balance. Widths animate via a CSS transition.
 */
export function PoolsBar({ yesPool, noPool }: { yesPool: string; noPool: string }) {
  const yes = Number(yesPool) / 1e6;
  const no = Number(noPool) / 1e6;
  const total = yes + no;
  const yesPct = total > 0 ? (yes / total) * 100 : 50;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-secondary ring-1 ring-default/50">
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{ width: `${yesPct}%`, background: "var(--yes)" }}
        />
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{ width: `${100 - yesPct}%`, background: "var(--no)" }}
        />
      </div>
      <div className="flex items-center justify-between text-xs tnum">
        <span className="font-medium text-[var(--yes)]">YES {usd(yesPool)}</span>
        <span className="font-medium text-[var(--no)]">NO {usd(noPool)}</span>
      </div>
    </div>
  );
}
