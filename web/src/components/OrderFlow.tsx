// POSITIONS / ORDER FLOW — the live list of every bet on this task, newest
// first: role avatar + name, a YES/NO chip, and the amount (mono). The human's
// own bets are highlighted. Derived from the task's bets[] (the on-chain bet
// rows); the human is matched by control.humanAddress / humanAgentId.

import { ScrollShadow } from "@heroui/react";
import { agentMeta } from "./AgentAvatar.js";
import { clockTime, usd } from "../format.js";
import type { ControlLoad } from "../useControl.js";
import type { BetRow } from "../types.js";
import { RoleBadge, SideChip } from "./ui.js";

export function OrderFlow({ bets, control }: { bets: BetRow[]; control: ControlLoad }) {
  const human = control.status === "ok" ? control.info : undefined;
  const ordered = bets.slice().reverse(); // newest first

  const isHuman = (b: BetRow) =>
    (human?.humanAgentId != null && b.agentId === human.humanAgentId) ||
    (!!human?.humanAddress && b.bettor?.toLowerCase() === human.humanAddress.toLowerCase());

  return (
    <section className="glass flex min-h-0 flex-1 flex-col rounded-xl">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
        <h3 className="font-display text-sm font-semibold text-foreground">Order flow</h3>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted tnum">
          {bets.length} {bets.length === 1 ? "bet" : "bets"}
        </span>
      </div>
      <ScrollShadow className="min-h-0 flex-1 px-2 py-2">
        {ordered.length === 0 ? (
          <div className="flex h-28 items-center justify-center px-6 text-center text-xs text-muted">
            No bets yet — be the first to take a side.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {ordered.map((b) => {
              const mine = isHuman(b);
              const name = mine ? "You" : agentMeta(b.agentId).name;
              return (
                <li
                  key={b.id}
                  className={[
                    "flex items-center gap-2.5 rounded-lg px-2 py-2",
                    mine ? "bg-[var(--accent-soft)] ring-1 ring-[color-mix(in_oklch,var(--accent)_45%,transparent)]" : "",
                  ].join(" ")}
                >
                  <RoleBadge role={mine ? "client" : roleForAgent(b.agentId)} size="sm" />
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
