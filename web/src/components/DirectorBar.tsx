// Thin top strip: ● LIVE / ▶ REPLAY <runId> from director status, plus health
// pills (anvil block, server ok, gemini ok|limited). A small control lists
// GET /v1/runs and triggers a replay by reconnecting the WS with ?replay=<id>.

import { useState } from "react";
import { REST_BASE } from "../ws.js";
import type { DirectorStatus } from "../types.js";

function geminiPill(g: DirectorStatus["geminiOk"]) {
  if (g === true) return <span className="pill pill-ok">gemini ok</span>;
  if (g === "limited") return <span className="pill pill-warn">gemini limited</span>;
  if (g === false) return <span className="pill pill-bad">gemini down</span>;
  return <span className="pill pill-idle">gemini —</span>;
}

export function DirectorBar({
  director,
  connected,
  isMock,
  onReplay,
}: {
  director: DirectorStatus;
  connected: boolean;
  isMock: boolean;
  onReplay: (runId: string) => void;
}) {
  const [runs, setRuns] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  const loadRuns = async () => {
    setOpen((o) => !o);
    if (runs) return;
    try {
      const r = await fetch(`${REST_BASE}/v1/runs`);
      const body = (await r.json()) as { runs: string[] };
      setRuns(body.runs ?? []);
    } catch {
      setRuns([]);
    }
  };

  const replaying = director.mode === "replay";

  return (
    <div className="director-bar">
      <div className="director-left">
        <span className="brand">ORACLE</span>
        <span className="brand-sub">control room</span>
      </div>

      <div className="director-mode">
        {isMock ? (
          <span className="mode-chip mode-mock">◐ MOCK</span>
        ) : replaying ? (
          <span className="mode-chip mode-replay">▶ REPLAY {director.runId ?? ""}</span>
        ) : (
          <span className="mode-chip mode-live">● LIVE</span>
        )}
      </div>

      <div className="director-pills">
        <span className={"pill " + (connected && director.serverOk ? "pill-ok" : "pill-bad")}>
          {connected ? "server ok" : "server down"}
        </span>
        {geminiPill(director.geminiOk)}
        <span className="pill pill-info">
          anvil #{director.block != null ? director.block : "—"}
        </span>
      </div>

      {!isMock && (
        <div className="director-replay">
          <button className="replay-btn" onClick={loadRuns}>
            replays ▾
          </button>
          {open && (
            <div className="replay-menu">
              {runs == null && <div className="replay-item muted">loading…</div>}
              {runs != null && runs.length === 0 && (
                <div className="replay-item muted">no recorded runs</div>
              )}
              {runs?.map((id) => (
                <button
                  key={id}
                  className="replay-item"
                  onClick={() => {
                    setOpen(false);
                    onReplay(id);
                  }}
                >
                  ▶ {id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
