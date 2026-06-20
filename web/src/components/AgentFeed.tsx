// Right-rail chronological agent-reasoning stream. Each item: role avatar, agent
// name, the Gemini reasoning text, side/amount/score chips and a 🧠/⚙️ honesty
// tag. Auto-scrolls to the newest line; solution lines are clickable → code
// modal. Built on a HeroUI Card shell + ScrollShadow for the overflow.

import { Card, Chip, ScrollShadow } from "@heroui/react";
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
    <Card className="flex h-full min-h-0 flex-col">
      <Card.Header className="border-b border-default/50 pb-3">
        <Card.Title className="flex items-center gap-2 text-base">
          <span aria-hidden>💬</span> Agent reasoning
        </Card.Title>
      </Card.Header>
      <Card.Content className="min-h-0 flex-1 p-0">
        <ScrollShadow className="h-full max-h-[640px] px-3 py-2">
          {items.length === 0 && (
            <div className="flex h-32 items-center justify-center text-sm text-muted">
              Waiting for first task…
            </div>
          )}
          <ul className="flex flex-col gap-2">
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
                      "flex gap-3 rounded-xl p-2.5 transition",
                      clickable
                        ? "cursor-pointer bg-surface-secondary ring-1 ring-default/50 hover:ring-accent/60"
                        : "hover:bg-surface-secondary/60",
                    ].join(" ")}
                  >
                    <RoleBadge role={it.role} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-foreground">{it.agent}</span>
                        {it.side && <SideChip side={it.side} />}
                        {it.amount && (
                          <span className="tnum text-xs font-medium text-muted">{usd(it.amount)}</span>
                        )}
                        {it.score != null && (
                          <Chip size="sm" variant="soft" color="accent">
                            <Chip.Label>score {it.score}</Chip.Label>
                          </Chip>
                        )}
                        <SourceTag source={it.source} />
                        <span className="tnum ml-auto text-[10px] text-muted">
                          {clockTime(it.ts)}
                        </span>
                      </div>
                      <p className="text-sm leading-snug text-foreground/90">{it.text}</p>
                      {clickable && (
                        <span className="text-xs font-medium text-accent">
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
      </Card.Content>
    </Card>
  );
}
