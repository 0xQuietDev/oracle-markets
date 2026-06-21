// ACTIVITY — the global chronological agent-reasoning feed across all tasks,
// full-width. Reuses AgentFeed (🧠 Gemini / ⚙️ rule tags, clickable solutions).
// Each line links to its market via the taskId chip.

import { specName } from "../format.js";
import type { ActivityItem, StoreState } from "../types.js";
import { AgentFeed } from "./AgentFeed.js";

export function ActivityView({
  state,
  onOpenCode,
  onOpenMarket,
}: {
  state: StoreState;
  onOpenCode: (item: ActivityItem) => void;
  onOpenMarket: (id: number) => void;
}) {
  // task chips for quick navigation into a market from the global stream
  const taskIds = state.order;

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-5 py-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">Activity</h1>
        <p className="text-sm text-muted">
          Live agent reasoning across every market — bets, verdicts, and settlements.
        </p>
      </div>

      {taskIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Jump to market:</span>
          {taskIds.map((id) => {
            const t = state.tasks[id]?.task;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onOpenMarket(id)}
                className="rounded-full border border-[var(--glass-border)] px-2.5 py-1 text-xs font-medium text-foreground/85 transition-colors hover:border-[color-mix(in_oklch,var(--accent)_50%,transparent)] hover:text-foreground"
              >
                #{id} {t ? specName(t.specUri) : ""}
              </button>
            );
          })}
        </div>
      )}

      <div className="h-[calc(100vh-13rem)] min-h-[400px]">
        <AgentFeed items={state.activity} onOpenCode={onOpenCode} />
      </div>
    </div>
  );
}
