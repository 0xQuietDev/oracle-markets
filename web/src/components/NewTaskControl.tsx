// THE key interactivity: create a task on-chain from the console.
//   GET  /v1/control            -> { available, reason?, templates:[{template,fn,title}] }
//   POST /v1/control/task {template} -> { ok, taskId, txHash, deadline } | { error }
// A HeroUI Select of templates + a primary "Create Task" Button. On success a
// Toast announces "Task #N created"; on failure a danger Toast explains why.
// When control is unavailable the Select + Button are disabled with the reason.

import { Button, Card, Label, ListBox, Select, Spinner, toast } from "@heroui/react";
import { useEffect, useState } from "react";
import { REST_BASE } from "../ws.js";

type Template = { template: string; fn?: string; title?: string };
type ControlInfo = { available: boolean; reason?: string; templates: Template[] };

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; info: ControlInfo };

export function NewTaskControl() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${REST_BASE}/v1/control`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`server returned ${r.status}`);
        return (await r.json()) as ControlInfo;
      })
      .then((info) => {
        if (cancelled) return;
        setLoad({ status: "ok", info });
        if (info.templates?.length) setPicked(info.templates[0].template);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoad({ status: "error", message: e instanceof Error ? e.message : "fetch failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const available = load.status === "ok" && load.info.available;
  const templates = load.status === "ok" ? load.info.templates : [];
  const reason =
    load.status === "ok"
      ? load.info.reason ?? "control plane is offline"
      : load.status === "error"
        ? load.message
        : undefined;

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
        toast.danger("Could not create task", {
          description: body.message ?? body.reason ?? body.error ?? `server returned ${r.status}`,
        });
        return;
      }
      toast.success(`Task #${body.taskId} created`, {
        description: "Posted on-chain — watch it open on the board.",
      });
    } catch (e) {
      toast.danger("Could not create task", {
        description: e instanceof Error ? e.message : "network error",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card className="w-full" variant="secondary">
      <Card.Header>
        <Card.Title className="flex items-center gap-2 text-base">
          <span aria-hidden>🚀</span> New task
        </Card.Title>
        <Card.Description>
          Post a task on-chain as the client and watch the agents trade its outcome.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {load.status === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" /> checking control plane…
          </div>
        ) : (
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

            <Button
              className="shrink-0"
              isDisabled={!available || !picked || creating}
              onPress={createTask}
            >
              {creating && <Spinner size="sm" color="current" />}
              {creating ? "Creating…" : "Create Task"}
            </Button>
          </div>
        )}

        {!available && load.status !== "loading" && reason && (
          <p className="mt-2 text-xs text-warning">⚠ {reason}</p>
        )}
      </Card.Content>
    </Card>
  );
}
