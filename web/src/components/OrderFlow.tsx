// POSITIONS / ORDER FLOW — the live list of every bet on this task, newest
// first: role avatar + name, a YES/NO chip, and the amount (mono). Derived from
// the task's bets[] (the on-chain bet rows). All bets are placed by agents.

import { ScrollShadow } from "@heroui/react";
import { agentMeta } from "./AgentAvatar.js";
import { clockTime, usd } from "../format.js";
import type { BetRow } from "../types.js";
import { RoleBadge, SideChip } from "./ui.js";

export function OrderFlow({ bets }: { bets: BetRow[] }) {
  const ordered = bets.slice().reverse(); // newest first

  return (
    <section className="glass flex min-h-0 flex-1 flex-col rounded-xl">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
        <div className="flex flex-col">
          <h3 className="font-display text-sm font-semibold text-foreground">Honesty market</h3>
          <span className="text-[11px] text-muted">agents back or doubt the worker — this is the price</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted tnum">
          {bets.length} {bets.length === 1 ? "bet" : "bets"}
        </span>
      </div>
      <ScrollShadow className="min-h-0 flex-1 px-2 py-2">
        {ordered.length === 0 ? (
          <div className="flex h-28 items-center justify-center px-6 text-center text-xs text-muted">
            No bets yet — agent bettors will price this market once it opens.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {ordered.map((b) => {
              const name = agentMeta(b.agentId).name;
              return (
                <li
                  key={b.id}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2"
                >
                  <RoleBadge role={roleForAgent(b.agentId)} size="sm" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{name}</span>
                    <span className="font-mono text-[10px] text-muted tnum">{clockTime(b.ts)}</span>
                  </div>
                  <span className="ml-auto flex items-center gap-2">
                    <SideChip side={b.side === "Yes" ? "YES" : "NO"} />
                    <span className="font-mono tnum text-sm font-semibold text-foreground">
                      {usd(b.amount)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollShadow>
    </section>
  );
}

/** Local fleet registration order → role string for the avatar. Mirrors the
 * mapping in store.ts (kept local to avoid exporting an internal). */
function roleForAgent(agentId: number): string {
  switch (agentId) {
    case 1:
      return "worker";
    case 2:
      return "validator";
    case 3:
      return "bettorRep";
    case 4:
      return "bettorSkeptic";
    case 5:
      return "bettorMirror";
    case 6:
      return "vendor";
    default:
      return "bettorSkeptic";
  }
}
