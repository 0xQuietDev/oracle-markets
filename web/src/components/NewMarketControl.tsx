// "+ New market" affordance for the Markets view. A primary button reveals a
// small panel: a HeroUI Select of task templates + a Create button that POSTs
// /v1/control/task { template }. Toast on success/failure. Disabled (with the
// reason) when the control plane is unavailable. Consumes the shared useControl
// load so it agrees with the trade ticket about backend availability.

import { Button, Label, ListBox, Select, Spinner, toast } from "@heroui/react";
import { useState } from "react";
import type { ControlLoad } from "../useControl.js";
import { REST_BASE } from "../ws.js";

export function NewMarketControl({ control }: { control: ControlLoad }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const available = control.status === "ok" && control.info.available;
  const templates = control.status === "ok" ? control.info.templates : [];
  const reason =
    control.status === "ok"
      ? control.info.reason ?? "control plane is offline"
      : control.status === "error"
        ? control.message
        : undefined;

  if (picked == null && templates.length) setPicked(templates[0].template);

  const createTask = async () => {
    if (!picked) return;
    setCreating(true);
    try {
      const r = await fetch(`${REST_BASE}/v1/control/task`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: picked }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        taskId?: number;
        error?: string;
        message?: string;
        reason?: string;
      };
      if (!r.ok || !body.ok) {
        toast.danger("Could not open market", {
          description: body.message ?? body.reason ?? body.error ?? `server returned ${r.status}`,
        });
        return;
      }
      toast.success(`Market #${body.taskId} opened`, {
        description: "Posted on-chain — the fleet will start pricing it.",
      });
      setOpen(false);
    } catch (e) {
      toast.danger("Could not open market", {
        description: e instanceof Error ? e.message : "network error",
      });
    } finally {
      setCreating(false);
    }
  };

  if (!open) {
    return (
      <Button onPress={() => setOpen(true)} isDisabled={control.status === "loading"}>
        {control.status === "loading" ? <Spinner size="sm" color="current" /> : "+"} New market
      </Button>
    );
  }

  return (
    <div className="glass flex w-full flex-col gap-3 rounded-xl p-4 sm:min-w-[420px]">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-semibold text-foreground">Open a market</span>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-foreground">
          ✕
        </button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          className="flex-1"
          placeholder={available ? "Choose a template" : "Control plane unavailable"}
          value={picked}
          isDisabled={!available || creating}
          onChange={(v) => setPicked((v as string | null) ?? null)}
        >
          <Label className="text-xs text-muted">Task template</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {templates.map((t) => (
                <ListBox.Item key={t.template} id={t.template} textValue={t.title ?? t.template}>
                  <div className="flex flex-col">
                    <span className="font-medium">{t.title ?? t.template}</span>
                    {t.fn && <span className="font-mono text-xs text-muted">{t.fn}</span>}
                  </div>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Button className="shrink-0" isDisabled={!available || !picked || creating} onPress={createTask}>
          {creating && <Spinner size="sm" color="current" />}
          {creating ? "Opening…" : "Create"}
        </Button>
      </div>
      {!available && control.status !== "loading" && reason && (
        <p className="text-xs text-warning">⚠ {reason}</p>
      )}
    </div>
  );
}
