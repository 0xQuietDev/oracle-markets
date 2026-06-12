import { useEffect, useReducer, useState } from "react";
import { TaskCard } from "./components/TaskCard";
import { startMockFeed } from "./mockFeed";
import { initialState, reducer } from "./store";
import { connectWs, DEFAULT_WS_URL } from "./ws";

const IS_MOCK =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("mock") === "1";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // 1s tick: drives countdowns and the local Open→Executing flip
  useEffect(() => {
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  // data source: real WS feed, or the scripted mock when ?mock=1
  useEffect(() => {
    return IS_MOCK ? startMockFeed(dispatch) : connectWs(DEFAULT_WS_URL, dispatch);
  }, []);

  const hasTasks = state.order.length > 0;

  return (
    <div className="stage">
      <header className="masthead">
        <h1>
          ORACLE <span className="tagline">— outcome markets for agent trust</span>
        </h1>
        <div className={"conn " + (state.connected ? "conn-live" : "conn-down")}>
          {IS_MOCK ? "mock feed" : state.connected ? "live" : "reconnecting…"}
        </div>
      </header>

      {hasTasks ? (
        <main className="grid">
          {state.order.map((id) => (
            <TaskCard key={id} entry={state.tasks[id]} now={now} />
          ))}
        </main>
      ) : (
        <div className="empty">
          <div className="empty-pulse" />
          {state.connected || IS_MOCK ? "waiting for first task…" : "connecting to oracle-server…"}
        </div>
      )}
    </div>
  );
}
