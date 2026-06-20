import { Card, Toast } from "@heroui/react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { AgentDrawer } from "./components/AgentDrawer.js";
import { AgentFeed } from "./components/AgentFeed.js";
import { DirectorBar } from "./components/DirectorBar.js";
import { FlowCanvas } from "./components/FlowCanvas.js";
import { MarketBoard } from "./components/MarketBoard.js";
import { NewTaskControl } from "./components/NewTaskControl.js";
import { ReplayControl } from "./components/ReplayControl.js";
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

  const verdictFor = useMemo(() => {
    if (!codeItem) return null;
    return (
      [...state.activity]
        .reverse()
        .find((a) => a.kind === "verdict" && a.taskId === codeItem.taskId) ?? null
    );
  }, [codeItem, state.activity]);

  const setReplayUrl = (runId: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (runId) url.searchParams.set("replay", runId);
    else url.searchParams.delete("replay");
    window.history.replaceState(null, "", url.toString());
  };

  const onReplay = (runId: string) => {
    setReplayId(runId);
    setReplayUrl(runId);
  };
  const onLive = () => {
    setReplayId(null);
    setReplayUrl(null);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Toast.Provider />
      <DirectorBar director={state.director} connected={state.connected} isMock={!!IS_MOCK} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* left / center column */}
        <div className="flex min-w-0 flex-col gap-4">
          {!IS_MOCK && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <NewTaskControl />
              <Card variant="secondary">
                <Card.Header>
                  <Card.Title className="flex items-center gap-2 text-base">
                    <span aria-hidden>🎬</span> Run mode
                  </Card.Title>
                  <Card.Description>
                    Switch to a recorded run, or stay on the live on-chain feed.
                  </Card.Description>
                </Card.Header>
                <Card.Content>
                  <ReplayControl
                    replaying={state.director.mode === "replay"}
                    onReplay={onReplay}
                    onLive={onLive}
                  />
                </Card.Content>
              </Card>
            </div>
          )}

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

        {/* right rail */}
        <div className="min-h-0 xl:sticky xl:top-0">
          <AgentFeed items={state.activity} onOpenCode={setCodeItem} />
        </div>
      </main>

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
