// Custom React Flow node for a flow-canvas actor. Lights up when its phase is
// active; clickable to open the per-agent drawer. Data is supplied by
// FlowCanvas via the node's `data` field.

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
  return (
    <div
      className={
        "flow-node" +
        (d.lit ? " flow-node-lit" : "") +
        (d.group === "infra" ? " flow-node-infra" : "")
      }
      onClick={() => d.onOpen(d.role, d.label)}
      title={`open ${d.label} history`}
    >
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <Handle type="target" position={Position.Top} className="flow-handle" />
      <Handle type="source" position={Position.Right} className="flow-handle" />
      <Handle type="source" position={Position.Bottom} className="flow-handle" />
      <span className="flow-node-emoji">{d.emoji}</span>
      <span className="flow-node-label">{d.label}</span>
    </div>
  );
}
