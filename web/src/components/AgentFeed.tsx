// Right-column chronological activity stream: avatar by role, the Gemini text,
// side/amount, and an honesty tag (🧠 Gemini / ⚙️ rule) from item.source.
// Auto-scrolls to the newest line. Solution lines are clickable → code modal;
// any tx reference would be surfaced elsewhere (TxDrawer via chips).

import { useEffect, useRef } from "react";
import { clockTime, usd } from "../format.js";
import type { ActivityItem } from "../types.js";
import { RoleAvatar } from "./AgentAvatar.js";

function sourceTag(source?: "gemini" | "rule") {
  if (source === "gemini") return <span className="src-tag src-gemini">🧠 Gemini</span>;
  if (source === "rule") return <span className="src-tag src-rule">⚙️ rule</span>;
  return null;
}

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
    <aside className="agent-feed">
      <div className="feed-head">Agent reasoning</div>
      <div className="feed-scroll">
        {items.length === 0 && <div className="feed-empty">no activity yet…</div>}
        {items.map((it, i) => {
          const clickable = it.kind === "solution" && it.code;
          return (
            <div
              key={`${it.ts}-${i}`}
              className={"feed-row" + (clickable ? " feed-row-code" : "")}
              onClick={clickable ? () => onOpenCode(it) : undefined}
              title={clickable ? "view the code the worker wrote" : undefined}
            >
              <RoleAvatar role={it.role} />
              <div className="feed-body">
                <div className="feed-line1">
                  <span className="feed-agent">{it.agent}</span>
                  {it.side && (
                    <span className={it.side === "YES" ? "chip chip-yes" : "chip chip-no"}>
                      {it.side}
                    </span>
                  )}
                  {it.amount && <span className="feed-amount">{usd(it.amount)}</span>}
                  {it.score != null && <span className="feed-score">score {it.score}</span>}
                  {sourceTag(it.source)}
                  <span className="feed-time">{clockTime(it.ts)}</span>
                </div>
                <div className="feed-text">{it.text}</div>
                {clickable && <div className="feed-codehint">⌨ view solution code →</div>}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </aside>
  );
}
