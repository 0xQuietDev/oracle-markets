// Opened by clicking a flow-canvas node: that agent's activity history (filtered
// by role) plus, for the worker, the code it wrote. Tx references render as
// chips that open the mini-explorer.

import { clockTime, usd } from "../format.js";
import { roleMeta } from "./AgentAvatar.js";
import type { ActivityItem } from "../types.js";

const ROLE_ALIASES: Record<string, string[]> = {
  worker: ["worker"],
  bettorRep: ["bettorRep", "rep"],
  rep: ["bettorRep", "rep"],
  bettorSkeptic: ["bettorSkeptic", "skeptic"],
  skeptic: ["bettorSkeptic", "skeptic"],
  bettorMirror: ["bettorMirror", "mirror"],
  mirror: ["bettorMirror", "mirror"],
  validator: ["validator"],
  vendor: ["vendor"],
  client: ["client"],
  oracle: ["oracle", "info"],
  infra: [],
};

export function AgentDrawer({
  role,
  label,
  activity,
  onClose,
  onOpenCode,
}: {
  role: string;
  label: string;
  activity: ActivityItem[];
  onClose: () => void;
  onOpenCode: (item: ActivityItem) => void;
}) {
  const aliases = ROLE_ALIASES[role] ?? [role];
  const items = activity.filter((a) => aliases.includes(a.role)).slice().reverse();
  const meta = roleMeta(role);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer agent-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <div className="drawer-kicker">agent history</div>
            <div className="drawer-title">
              <span className="flow-node-emoji">{meta.emoji}</span> {label}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </header>

        {items.length === 0 && <div className="drawer-info">no activity for {label} yet…</div>}

        <div className="agent-history">
          {items.map((it, i) => {
            const clickable = it.kind === "solution" && it.code;
            return (
              <div
                key={`${it.ts}-${i}`}
                className={"history-row" + (clickable ? " history-code" : "")}
                onClick={clickable ? () => onOpenCode(it) : undefined}
              >
                <div className="history-line1">
                  <span className="history-kind">{it.kind}</span>
                  {it.side && (
                    <span className={it.side === "YES" ? "chip chip-yes" : "chip chip-no"}>
                      {it.side}
                    </span>
                  )}
                  {it.amount && <span className="feed-amount">{usd(it.amount)}</span>}
                  {it.score != null && <span className="feed-score">score {it.score}</span>}
                  <span className="feed-time">{clockTime(it.ts)}</span>
                </div>
                <div className="feed-text">{it.text}</div>
                {clickable && <div className="feed-codehint">⌨ view solution code →</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
