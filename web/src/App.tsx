import { useEffect, useMemo, useReducer, useState } from "react";
import { AgentDrawer } from "./components/AgentDrawer.js";
import { AgentFeed } from "./components/AgentFeed.js";
import { DirectorBar } from "./components/DirectorBar.js";
import { FlowCanvas } from "./components/FlowCanvas.js";
import { MarketBoard } from "./components/MarketBoard.js";
import { SettleBanner } from "./components/SettleBanner.js";
import { TxDrawer } from "./components/TxDrawer.js";
import { TxRail } from "./components/TxRail.js";
import { WorkerCodeModal } from "./components/WorkerCodeModal.js";
import { specName } from "./format.js";
import { startMockFeed } from "./mockFeed.js";
import { initialState, reducer } from "./store.js";
import type { ActivityItem, TaskState } from "./types.js";
import { connectWs, DEFAULT_WS_URL, wsUrlFor } from "./ws.js";

const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const IS_MOCK = params?.get("mock") === "1";

function displayState(state: TaskState, betCutoff: number | null, now: number): TaskState {
  if (state === "Open" && betCutoff != null && now > betCutoff) return "Executing";
  return state;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replayId, setReplayId] = useState<string | null>(params?.get("replay") ?? null);

  // drawers / modals
  const [txHash, setTxHash] = useState<string | null>(null);
  const [agentNode, setAgentNode] = useState<{ role: string; label: string } | null>(null);
  const [codeItem, setCodeItem] = useState<ActivityItem | null>(null);

  // 1s tick drives countdowns and the Open→Executing flip
  useEffect(() => {
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  // data source: scripted mock (?mock=1), or the WS feed (optionally a replay)
  useEffect(() => {
    if (IS_MOCK) return startMockFeed(dispatch);
    return connectWs(wsUrlFor(DEFAULT_WS_URL, replayId), dispatch);
  }, [replayId]);

  // default selection: newest task; keep it stable once chosen
  useEffect(() => {
    if (selectedId == null && state.order.length > 0) setSelectedId(state.order[0]);
    else if (selectedId != null && !state.tasks[selectedId] && state.order.length > 0)
      setSelectedId(state.order[0]);
  }, [state.order, selectedId, state.tasks]);

  const selected = selectedId != null ? state.tasks[selectedId] ?? null : null;
  const phase: TaskState | undefined = selected
    ? displayState(selected.task.state, selected.task.betCutoff, now)
    : undefined;

  const taskLabel = (id: number) => {
    const t = state.tasks[id]?.task;
    return t ? `#${id} ${specName(t.specUri)}` : `#${id}`;
  };

  // verdict that pairs with a clicked solution (same task), for the code modal
  const verdictFor = useMemo(() => {
    if (!codeItem) return null;
    return (
      [...state.activity]
        .reverse()
        .find((a) => a.kind === "verdict" && a.taskId === codeItem.taskId) ?? null
    );
  }, [codeItem, state.activity]);

  const onReplay = (runId: string) => {
    setReplayId(runId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("replay", runId);
      window.history.replaceState(null, "", url.toString());
    }
  };

  return (
    <div className="console">
      <DirectorBar
        director={state.director}
        connected={state.connected}
        isMock={!!IS_MOCK}
        onReplay={onReplay}
      />

      <div className="console-grid">
        <div className="console-main">
          {selected?.justSettled &&
            selected.task.outcome &&
            selected.task.outcome !== "Unresolved" && (
              <SettleBanner
                outcome={selected.task.outcome}
                validatorScore={selected.task.validatorScore}
                viaRule={selected.task.viaRule}
              />
            )}

          <MarketBoard
            entry={selected}
            now={now}
            order={state.order}
            selectedId={selectedId}
            onSelect={setSelectedId}
            taskLabel={taskLabel}
          />

          <TxRail txs={state.txs} onOpenTx={setTxHash} />

          <FlowCanvas
            phase={phase}
            lastPulse={state.lastPulse}
            onOpenAgent={(role, label) => setAgentNode({ role, label })}
          />
        </div>

        <AgentFeed items={state.activity} onOpenCode={setCodeItem} />
      </div>

      {txHash && <TxDrawer txHash={txHash} onClose={() => setTxHash(null)} />}

      {agentNode && (
        <AgentDrawer
          role={agentNode.role}
          label={agentNode.label}
          activity={state.activity}
          onClose={() => setAgentNode(null)}
          onOpenCode={(it) => {
            setAgentNode(null);
            setCodeItem(it);
          }}
        />
      )}

      {codeItem && (
        <WorkerCodeModal
          solution={codeItem}
          verdict={verdictFor}
          onClose={() => setCodeItem(null)}
        />
      )}
    </div>
  );
}
