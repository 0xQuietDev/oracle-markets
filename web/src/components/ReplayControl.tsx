// Secondary control row: pick a recorded run (GET /v1/runs) and replay it
// (the parent reconnects the WS with ?replay=<id>; the server also re-emits via
// GET /v1/replay/:id at original cadence), plus a Live toggle to drop back to
// the live feed. Recorded runs are real prior runs, never fabricated.

import { Button, Label, ListBox, Select, Switch } from "@heroui/react";
import { useEffect, useState } from "react";
import { REST_BASE } from "../ws.js";

export function ReplayControl({
  replaying,
  onReplay,
  onLive,
}: {
  replaying: boolean;
  onReplay: (runId: string) => void;
  onLive: () => void;
}) {
  const [runs, setRuns] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${REST_BASE}/v1/runs`)
      .then(async (r) => (r.ok ? ((await r.json()) as { runs?: string[] }) : { runs: [] }))
      .then((b) => {
        if (cancelled) return;
        const list = b.runs ?? [];
        setRuns(list);
        if (list.length) setPicked(list[0]);
      })
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const hasRuns = (runs?.length ?? 0) > 0;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        className="min-w-[220px] flex-1"
        placeholder={hasRuns ? "Recorded run" : "No recorded runs"}
        value={picked}
        isDisabled={!hasRuns}
        onChange={(v) => setPicked((v as string | null) ?? null)}
      >
        <Label className="text-xs text-muted">Replay</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {(runs ?? []).map((id) => (
              <ListBox.Item key={id} id={id} textValue={id}>
                ▶ {id}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Button
        variant="secondary"
        isDisabled={!picked}
        onPress={() => picked && onReplay(picked)}
      >
        Replay
      </Button>

      <Switch
        isSelected={!replaying}
        onChange={(sel) => sel && onLive()}
        className="ml-auto"
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          Live
        </Switch.Content>
      </Switch>
    </div>
  );
}
