import { countdown, specName, usd } from "../format";
import { currentPBps } from "../store";
import type { TaskEntry, TaskState } from "../types";
import { AgentAvatar, agentMeta } from "./AgentAvatar";
import { OddsTicker } from "./OddsTicker";
import { PoolsBar } from "./PoolsBar";
import { SettleBanner } from "./SettleBanner";
import { StakeBadge } from "./StakeBadge";

/** "Executing" is a UI label: Open on-chain, but past betCutoff (DESIGN §7.3). */
function displayState(entry: TaskEntry, now: number): TaskState {
  const t = entry.task;
  if (t.state === "Open" && t.betCutoff != null && now > t.betCutoff) return "Executing";
  return t.state;
}

function timeline(entry: TaskEntry, now: number, state: TaskState): string {
  const t = entry.task;
  switch (state) {
    case "Created":
      return "waiting for worker to stake…";
    case "Open":
      return `betting closes in ${countdown((t.betCutoff ?? now) - now)}`;
    case "Executing":
      return `deadline in ${countdown(t.deadline - now)}`;
    case "Delivered":
      return "delivered — validator is scoring…";
    case "Settled":
      return t.outcome === "Yes" ? "settled YES" : "settled NO";
    case "Cancelled":
      return "cancelled — refunds open";
  }
}

export function TaskCard({ entry, now }: { entry: TaskEntry; now: number }) {
  const t = entry.task;
  const state = displayState(entry, now);
  const accepted = t.acceptedAt != null;
  const pBps = entry.odds.length > 0 ? entry.odds[entry.odds.length - 1].pBps : currentPBps(t);
  const recentBets = [...entry.bets].reverse();

  return (
    <article className={`task-card state-${state.toLowerCase()}`}>
      {entry.justSettled && t.outcome !== null && t.outcome !== "Unresolved" && (
        <SettleBanner outcome={t.outcome} validatorScore={t.validatorScore} viaRule={t.viaRule} />
      )}

      <header className="card-head">
        <div>
          <div className="card-title">
            Task #{t.taskId} <span className="card-spec">{specName(t.specUri)}</span>
          </div>
          <div className="card-meta">
            reward <strong>{usd(t.reward)}</strong> · {timeline(entry, now, state)}
          </div>
        </div>
        <span className={`badge badge-${state.toLowerCase()}`}>
          {state === "Settled" && t.outcome ? `Settled · ${t.outcome.toUpperCase()}` : state}
        </span>
      </header>

      {t.selfStake != null && <StakeBadge selfStake={t.selfStake} />}

      {accepted ? (
        <>
          <OddsTicker odds={entry.odds} pBps={pBps} />
          <PoolsBar yesPool={t.yesPool} noPool={t.noPool} />
        </>
      ) : (
        <div className="card-idle">market opens when the worker self-stakes</div>
      )}

      {recentBets.length > 0 && (
        <ul className="bettors">
          {recentBets.map((b) => (
            <li key={b.id} className="bettor-row">
              <AgentAvatar agentId={b.agentId} />
              <span className="bettor-name">{agentMeta(b.agentId).name}</span>
              <span className={b.side === "Yes" ? "chip chip-yes" : "chip chip-no"}>
                {b.side.toUpperCase()}
              </span>
              <span className="bettor-amount">{usd(b.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
