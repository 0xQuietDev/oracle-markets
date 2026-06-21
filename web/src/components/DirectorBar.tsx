// Top app bar: ORACLE wordmark + "Control Room", the run-mode badge
// (● LIVE / ▶ REPLAY <runId> / ◐ MOCK) and health pills (server, gemini, anvil
// block). Replay selection now lives in ReplayControl; this bar is status only.

import type { DirectorStatus } from "../types.js";

const DOT: Record<string, string> = {
  ok: "var(--yes)",
  warn: "oklch(0.82 0.16 85)",
  down: "var(--no)",
  idle: "oklch(0.6 0.02 280)",
};

/** Small glass status chip with a soft status dot. */
function HealthPill({
  status,
  children,
}: {
  status: "ok" | "warn" | "down" | "idle";
  children: React.ReactNode;
}) {
  const color = DOT[status];
  return (
    <span className="glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground/80">
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 7px ${color}` }}
      />
      {children}
    </span>
  );
}

function GeminiChip({ g }: { g: DirectorStatus["geminiOk"] }) {
  if (g === true) return <HealthPill status="ok">gemini ok</HealthPill>;
  if (g === "limited") return <HealthPill status="warn">gemini limited</HealthPill>;
  if (g === false) return <HealthPill status="down">gemini down</HealthPill>;
  return <HealthPill status="idle">gemini —</HealthPill>;
}

export function DirectorBar({
  director,
  connected,
  isMock,
}: {
  director: DirectorStatus;
  connected: boolean;
  isMock: boolean;
}) {
  const replaying = director.mode === "replay";

  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-[var(--glass-border)] bg-[oklch(0.15_0.025_282/0.6)] px-6 py-3.5 backdrop-blur-xl">
      <div className="flex flex-col leading-none">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.4em] text-muted">
          Control Room
        </span>
        <span className="font-display text-xl font-bold tracking-[0.22em] text-foreground">
          ORACLE
        </span>
      </div>

      <div className="ml-3">
        {isMock ? (
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-[oklch(0.82_0.16_85)]">
            ◐ MOCK
          </span>
        ) : replaying ? (
          <span className="grad-rim inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1 font-mono text-xs font-semibold text-foreground">
            ▶ REPLAY {director.runId ?? ""}
          </span>
        ) : (
          <span className="grad-rim inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold text-foreground">
            <span
              className="inline-block size-1.5 animate-pulse rounded-full"
              style={{ background: "var(--yes)", boxShadow: "0 0 8px var(--yes)" }}
            />
            LIVE
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 tnum">
        <HealthPill status={connected && director.serverOk ? "ok" : "down"}>
          {connected ? "server ok" : "server down"}
        </HealthPill>
        <GeminiChip g={director.geminiOk} />
        <HealthPill status="idle">
          <span className="font-mono">anvil #{director.block ?? "—"}</span>
        </HealthPill>
      </div>
    </header>
  );
}
