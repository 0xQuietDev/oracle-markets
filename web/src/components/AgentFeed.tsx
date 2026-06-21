// Right-rail chronological agent-reasoning stream. Each item: role avatar, agent
// name, the Gemini reasoning text, side/amount/score chips and a 🧠/⚙️ honesty
// tag. Auto-scrolls to the newest line; solution lines are clickable → code
// modal. Built on a HeroUI Card shell + ScrollShadow for the overflow.

import { ScrollShadow } from "@heroui/react";
import { useEffect, useRef } from "react";
import { clockTime, usd } from "../format.js";
import type { ActivityItem } from "../types.js";
import { RoleBadge, SideChip, SourceTag } from "./ui.js";

export function AgentFeed({
  items,
  onOpenCode,
}: {
  items: ActivityItem[];
  onOpenCode: (item: ActivityItem) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);

  return (
    <section className="glass flex h-full min-h-0 flex-col rounded-2xl">
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] px-4 py-3.5">
        <h2 className="font-display flex items-center gap-2 text-base font-semibold text-foreground">
          <span aria-hidden>💬</span> Agent reasoning
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">live feed</span>
      </div>
      <div className="min-h-0 flex-1">
        <ScrollShadow className="h-full px-3 py-3">
          {items.length === 0 && (
            <div className="flex h-40 flex-col items-center justify-center gap-1 px-6 text-center">
              <span className="text-sm font-medium text-foreground/70">No agent activity yet</span>
              <span className="text-xs text-muted">Create a task to wake the fleet.</span>
            </div>
          )}
          <ul className="flex flex-col gap-1.5">
            {items.map((it, i) => {
              const clickable = it.kind === "solution" && it.code;
              return (
                <li key={`${it.ts}-${i}`}>
                  <div
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onOpenCode(it) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => (e.key === "Enter" || e.key === " ") && onOpenCode(it)
                        : undefined
                    }
                    className={[
                      "flex gap-3 rounded-xl border border-transparent p-2.5 transition",
                      clickable
                        ? "glass-2 cursor-pointer border-[var(--glass-border)] hover:border-[color-mix(in_oklch,var(--g2)_50%,transparent)]"
                        : "hover:glass-2 hover:border-[var(--glass-border)]",
                    ].join(" ")}
                  >
                    <RoleBadge role={it.role} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-foreground">{it.agent}</span>
                        {it.side && <SideChip side={it.side} />}
                        {it.amount && (
                          <span className="font-mono tnum text-xs font-medium text-foreground/70">
                            {usd(it.amount)}
                          </span>
                        )}
                        {it.score != null && (
                          <span className="font-mono inline-flex items-center rounded-full border border-[color-mix(in_oklch,var(--g2)_40%,transparent)] bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-medium text-foreground/85">
                            score {it.score}
                          </span>
                        )}
                        <SourceTag source={it.source} />
                        <span className="font-mono tnum ml-auto text-[10px] text-muted">
                          {clockTime(it.ts)}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/90">{it.text}</p>
                      {clickable && (
                        <span className="grad-text text-xs font-semibold">
                          ⌨ view solution code →
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div ref={endRef} />
        </ScrollShadow>
      </div>
    </section>
  );
}
