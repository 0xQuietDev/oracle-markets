// App shell + client-side view routing (no react-router; a `view` state plus a
// selected market id). Persistent TopNav over one of: Markets grid, a Market
// detail (the heart), Activity feed, or How it works. The data layer (reducer +
// ws/mock feed) is unchanged; views read from the same store state.

import { Toast } from "@heroui/react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { ActivityView } from "./components/ActivityView.js";
import { AgentDrawer } from "./components/AgentDrawer.js";
import { HowItWorks } from "./components/HowItWorks.js";
import { Landing } from "./components/Landing.js";
import { MarketDetail } from "./components/MarketDetail.js";
import { MarketsView } from "./components/MarketsView.js";
import { TopNav, type View } from "./components/TopNav.js";
import { TxDrawer } from "./components/TxDrawer.js";
import { WorkerCodeModal } from "./components/WorkerCodeModal.js";
import { startMockFeed } from "./mockFeed.js";
import { initialState, reducer } from "./store.js";
import type { ActivityItem } from "./types.js";
import { useControl } from "./useControl.js";
import { connectWs, DEFAULT_WS_URL, wsUrlFor } from "./ws.js";

const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const IS_MOCK = params?.get("mock") === "1";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const replayId = params?.get("replay") ?? null;

  // routing state — landing is the default front door
  const [view, setView] = useState<View>("landing");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // drawers / modals
  const [txHash, setTxHash] = useState<string | null>(null);
  const [agentNode, setAgentNode] = useState<{ role: string; label: string } | null>(null);
  const [codeItem, setCodeItem] = useState<ActivityItem | null>(null);

  const control = useControl(IS_MOCK);
  const humanAddress = control.status === "ok" ? control.info.humanAddress : undefined;

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

  // if the selected market disappears, fall back to Markets
  useEffect(() => {
    if (selectedId != null && !state.tasks[selectedId]) {
      setSelectedId(null);
      setView("markets");
    }
  }, [state.tasks, selectedId]);

  const selected = selectedId != null ? state.tasks[selectedId] ?? null : null;

  const verdictFor = useMemo(() => {
    if (!codeItem) return null;
    return (
      [...state.activity]
        .reverse()
        .find((a) => a.kind === "verdict" && a.taskId === codeItem.taskId) ?? null
    );
  }, [codeItem, state.activity]);

  const openMarket = (id: number) => {
    setSelectedId(id);
    setView("markets");
  };

  const onView = (v: View) => {
    if (v !== "markets") setSelectedId(null);
    setView(v);
  };

  return (
    <div className="flex h-full flex-col text-foreground">
      <Toast.Provider />
      <TopNav
        view={view}
        onView={onView}
        director={state.director}
        connected={state.connected}
        isMock={!!IS_MOCK}
        humanAddress={humanAddress}
      />

      <main className="min-h-0 flex-1 overflow-auto">
        {view === "landing" ? (
          <Landing onLaunch={() => onView("markets")} />
        ) : view === "markets" && selected ? (
          <MarketDetail
            entry={selected}
            state={state}
            now={now}
            onBack={() => setSelectedId(null)}
            onOpenTx={setTxHash}
            onOpenAgent={(role, label) => setAgentNode({ role, label })}
            onOpenCode={setCodeItem}
          />
        ) : view === "markets" ? (
          <MarketsView state={state} now={now} control={control} onOpen={openMarket} />
        ) : view === "activity" ? (
          <ActivityView state={state} onOpenCode={setCodeItem} onOpenMarket={openMarket} />
        ) : (
          <HowItWorks />
        )}
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
