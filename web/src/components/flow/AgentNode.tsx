// Custom React Flow node for a flow-canvas actor. Styled with Tailwind + brand
// tokens (React Flow nodes are custom HTML, so we keep them compact rather than
// wrapping a full HeroUI Card). Lights up with a glow when its phase is active;
// clickable to open the per-agent drawer.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  emoji: string;
  role: string;
  lit: boolean;
  group: "actor" | "infra";
  onOpen: (role: string, label: string) => void;
}

export function AgentNode({ data }: NodeProps) {
  const d = data as AgentNodeData;
  const infra = d.group === "infra";

  return (
    <button
      type="button"
      onClick={() => d.onOpen(d.role, d.label)}
      title={`Open ${d.label} history`}
      className={[
        "flex w-[120px] cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left transition",
        "ring-1 backdrop-blur",
        infra
          ? "border-dashed bg-surface/70 ring-default/50 text-muted"
          : "bg-surface ring-default/70 text-foreground hover:ring-accent/60",
        d.lit ? "oracle-node-lit" : "",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-default" />
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-default" />
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-default" />
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-default" />
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-base ${
          infra ? "bg-surface-secondary" : "bg-surface-secondary"
        }`}
        aria-hidden
      >
        {d.emoji}
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold">{d.label}</span>
        <span className="truncate text-[10px] uppercase tracking-wide text-muted">
          {infra ? "infra" : d.role}
        </span>
      </div>
    </button>
  );
}
