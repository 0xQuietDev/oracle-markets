// Persistent, thin, sticky top nav. ORACLE wordmark (left) · nav items
// Markets / Activity / How it works (center) · network status + human wallet
// chip (right). Status mirrors the old DirectorBar: anvil block + ● LIVE /
// ▶ REPLAY / ◐ DEMO, plus a server-down indicator. View switching is pure
// client-side state in App (no router).

import { Button } from "@heroui/react";
import { shortHash } from "../format.js";
import type { DirectorStatus } from "../types.js";

export type View = "landing" | "markets" | "activity" | "how";

const FUJI_ADDR =
  "https://testnet.snowtrace.io/address/0xa8Cc58b1E28ee7b5B8fc870402DC1515f4fe7BAD";

const NAV: { id: View; label: string }[] = [
  { id: "markets", label: "Markets" },
  { id: "activity", label: "Activity" },
  { id: "how", label: "How it works" },
];

export function TopNav({
  view,
  onView,
  director,
  connected,
  isMock,
  humanAddress,
}: {
  view: View;
  onView: (v: View) => void;
  director: DirectorStatus;
  connected: boolean;
  isMock: boolean;
  humanAddress?: string;
}) {
  const replaying = director.mode === "replay";

  // Minimal landing chrome: wordmark + "Launch app" primary + "View on Fuji".
  if (view === "landing") {
    return (
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-[var(--hairline)] bg-[oklch(0.155_0.008_265/0.82)] px-5 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => onView("landing")}
          className="font-display text-base font-bold tracking-[0.22em] text-foreground"
        >
          ORACLE
        </button>
        <div className="ml-auto flex items-center gap-3">
          <a
            href={FUJI_ADDR}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            View on Fuji ↗
          </a>
          <Button size="sm" onPress={() => onView("markets")}>
            Launch app
          </Button>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-6 border-b border-[var(--hairline)] bg-[oklch(0.155_0.008_265/0.82)] px-5 backdrop-blur-xl">
      {/* wordmark */}
      <button
        type="button"
        onClick={() => onView("landing")}
        className="font-display text-base font-bold tracking-[0.22em] text-foreground"
        title="Back to landing"
      >
        ORACLE
      </button>

      {/* nav */}
      <nav className="flex items-center gap-1" aria-label="Primary">
        {NAV.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onView(n.id)}
              aria-current={active ? "page" : undefined}
              className={[
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "accent-text bg-[var(--accent-soft)]"
                  : "text-muted hover:text-foreground",
              ].join(" ")}
            >
              {n.label}
            </button>
          );
        })}
      </nav>

      {/* right: status + wallet */}
      <div className="ml-auto flex items-center gap-2.5">
        {!connected && !isMock && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--no)_45%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--no)]">
            <span className="size-1.5 rounded-full" style={{ background: "var(--no)" }} />
            server down
          </span>
        )}

        <span className="font-mono text-xs text-muted tnum">
          {director.network ?? "chain"} #{director.block ?? "—"}
        </span>

        {isMock ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-2.5 py-1 text-xs font-semibold text-[oklch(0.8_0.15_85)]">
            ◐ DEMO
          </span>
        ) : replaying ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-2.5 py-1 font-mono text-xs font-semibold text-foreground">
            ▶ REPLAY {director.runId ?? ""}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--yes)_40%,transparent)] px-2.5 py-1 text-xs font-semibold text-foreground">
            <span
              className="live-dot inline-block size-1.5 rounded-full"
              style={{ background: "var(--yes)" }}
            />
            LIVE
          </span>
        )}

        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-2)] px-2.5 py-1 text-xs font-medium text-foreground/85">
          <span aria-hidden>🧑</span>
          <span className="font-mono tnum">
            {humanAddress ? shortHash(humanAddress) : "You"}
          </span>
        </span>
      </div>
    </header>
  );
}
