// "+ New market" — a real market-creation form. Two modes:
//   • Custom: write your own task (question + function signature) + reward + deadline.
//     Settled by the validator's LLM judge.
//   • Template: pick a built-in task — settled by a deterministic hidden-test suite.
// POSTs /v1/control/task and toasts the result.

import { Button, Label, ListBox, Select, Spinner, toast } from "@heroui/react";
import { useState } from "react";
import type { ControlLoad } from "../useControl.js";
import { REST_BASE } from "../ws.js";

type Mode = "custom" | "template";

const field =
  "w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

export function NewMarketControl({ control }: { control: ControlLoad }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("custom");
  const [creating, setCreating] = useState(false);

  const [question, setQuestion] = useState("");
  const [fn, setFn] = useState("");
  const [reward, setReward] = useState("10");
  const [minutes, setMinutes] = useState("5");
  const [picked, setPicked] = useState<string | null>(null);

  const available = control.status === "ok" && control.info.available;
  const templates = control.status === "ok" ? control.info.templates : [];
  const reason =
    control.status === "ok"
      ? control.info.reason ?? "control plane is offline"
      : control.status === "error"
        ? control.message
        : undefined;
  if (picked == null && templates.length) setPicked(templates[0].template);

  const submit = async () => {
    const body: Record<string, unknown> = {
      rewardUsdc: Math.max(1, Number(reward) || 0),
      deadlineMinutes: Math.max(1, Number(minutes) || 0),
    };
    if (mode === "template") {
      if (!picked) return;
      body.template = picked;
    } else {
      if (!question.trim() || !fn.trim()) {
        toast.danger("Missing fields", { description: "Add a question and a function signature." });
        return;
      }
      body.title = question.trim();
      body.prompt = question.trim();
      body.fn = fn.trim();
    }
    setCreating(true);
    try {
      const r = await fetch(`${REST_BASE}/v1/control/task`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean; taskId?: number; error?: string; message?: string; reason?: string;
      };
      if (!r.ok || !j.ok) {
        toast.danger("Could not open market", {
          description: j.message ?? j.reason ?? j.error ?? `server returned ${r.status}`,
        });
        return;
      }
      toast.success(`Market #${j.taskId} opened`, {
        description: "Posted on-chain — a worker agent will claim and price it.",
      });
      setOpen(false);
      setQuestion("");
      setFn("");
    } catch (e) {
      toast.danger("Could not open market", { description: e instanceof Error ? e.message : "network error" });
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
    <div className="glass flex w-full flex-col gap-3 rounded-xl p-4 sm:min-w-[460px]">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-semibold text-foreground">Open a market</span>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-foreground">
          ✕
        </button>
      </div>

      <div className="flex gap-1 rounded-lg border border-[var(--hairline)] p-1 text-xs">
        {(["custom", "template"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === m ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-muted hover:text-foreground"
            }`}
          >
            {m === "custom" ? "Your own task" : "Built-in template"}
          </button>
        ))}
      </div>

      {mode === "custom" ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Task / question</span>
            <textarea
              className={field}
              rows={2}
              placeholder="e.g. Implement a function that reverses the words in a sentence."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Function signature</span>
            <input
              className={`${field} font-mono`}
              placeholder="reverseWords(s: string): string"
              value={fn}
              onChange={(e) => setFn(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <Select
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
      )}

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Reward (USDC)</span>
          <input className={`${field} font-mono tnum`} type="number" min={1} value={reward} onChange={(e) => setReward(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Deadline (min)</span>
          <input className={`${field} font-mono tnum`} type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
      </div>

      <Button isDisabled={!available || creating} onPress={submit}>
        {creating && <Spinner size="sm" color="current" />}
        {creating ? "Opening…" : "Create market"}
      </Button>

      {mode === "custom" && (
        <p className="text-[11px] text-muted">Custom markets are settled by the validator's LLM judge.</p>
      )}
      {!available && control.status !== "loading" && reason && <p className="text-xs text-warning">⚠ {reason}</p>}
    </div>
  );
}
