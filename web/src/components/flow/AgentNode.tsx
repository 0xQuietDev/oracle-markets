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
        "group flex w-[150px] cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-200",
        "glass hover:glass-2",
        infra ? "opacity-80 hover:opacity-100" : "",
        d.lit ? "oracle-node-lit" : "",
      ].join(" ")}
      style={{ borderStyle: infra ? "dashed" : "solid" }}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-white/30" />
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-white/30" />
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-white/30" />
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-white/30" />
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-base"
        style={{
          background: d.lit
            ? "linear-gradient(135deg, color-mix(in oklab, var(--g1) 32%, transparent), color-mix(in oklab, var(--g3) 32%, transparent))"
            : "oklch(1 0 0 / 0.06)",
          boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.08)",
        }}
        aria-hidden
      >
        {d.emoji}
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold text-foreground">{d.label}</span>
        <span className="truncate font-mono text-[10px] uppercase tracking-wider text-muted">
          {infra ? "infra" : d.role}
        </span>
      </div>
    </button>
  );
}
