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
    <div className="flex flex-col gap-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[oklch(0.99_0_0/0.03)]">
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{
            width: `${yesPct}%`,
            background: "linear-gradient(90deg, color-mix(in oklch, var(--yes) 70%, transparent), var(--yes))",
            boxShadow: "0 0 12px -2px var(--yes)",
          }}
        />
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{
            width: `${100 - yesPct}%`,
            background: "linear-gradient(90deg, var(--no), color-mix(in oklch, var(--no) 70%, transparent))",
            boxShadow: "0 0 12px -2px var(--no)",
          }}
        />
      </div>
      <div className="flex items-center justify-between font-mono text-xs tnum">
        <span className="font-medium text-[var(--yes)]">YES {usd(yesPool)}</span>
        <span className="font-medium text-[var(--no)]">NO {usd(noPool)}</span>
      </div>
    </div>
  );
}
