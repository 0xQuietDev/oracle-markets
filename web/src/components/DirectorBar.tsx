// Top app bar: ORACLE wordmark + "Control Room", the run-mode badge
// (● LIVE / ▶ REPLAY <runId> / ◐ MOCK) and health pills (server, gemini, anvil
// block). Replay selection now lives in ReplayControl; this bar is status only.

import { Chip } from "@heroui/react";
import type { DirectorStatus } from "../types.js";

function GeminiChip({ g }: { g: DirectorStatus["geminiOk"] }) {
  if (g === true)
    return (
      <Chip size="sm" variant="soft" color="success">
        <Chip.Label>gemini ok</Chip.Label>
      </Chip>
    );
  if (g === "limited")
    return (
      <Chip size="sm" variant="soft" color="warning">
        <Chip.Label>gemini limited</Chip.Label>
      </Chip>
    );
  if (g === false)
    return (
      <Chip size="sm" variant="soft" color="danger">
        <Chip.Label>gemini down</Chip.Label>
      </Chip>
    );
  return (
    <Chip size="sm" variant="soft" color="default">
      <Chip.Label>gemini —</Chip.Label>
    </Chip>
  );
}

export function DirectorBar({
  director,
  connected,
  isMock,
}: {
  director: DirectorStatus;
  connected: boolean;
  isMock: boolean;
}) {
  const replaying = director.mode === "replay";

  return (
    <header className="flex items-center gap-4 border-b border-default/60 bg-surface/80 px-5 py-3 backdrop-blur">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold tracking-[0.18em] text-foreground">ORACLE</span>
        <span className="text-xs font-medium uppercase tracking-widest text-muted">
          Control Room
        </span>
      </div>

      <div className="ml-2">
        {isMock ? (
          <Chip variant="soft" color="warning">
            <Chip.Label>◐ MOCK</Chip.Label>
          </Chip>
        ) : replaying ? (
          <Chip variant="soft" color="accent">
            <Chip.Label>▶ REPLAY {director.runId ?? ""}</Chip.Label>
          </Chip>
        ) : (
          <Chip variant="primary" color="success">
            <span className="inline-block size-2 animate-pulse rounded-full bg-current" />
            <Chip.Label>LIVE</Chip.Label>
          </Chip>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 tnum">
        <Chip
          size="sm"
          variant="soft"
          color={connected && director.serverOk ? "success" : "danger"}
        >
          <Chip.Label>{connected ? "server ok" : "server down"}</Chip.Label>
        </Chip>
        <GeminiChip g={director.geminiOk} />
        <Chip size="sm" variant="soft" color="default">
          <Chip.Label>anvil #{director.block ?? "—"}</Chip.Label>
        </Chip>
      </div>
    </header>
  );
}
