// n8n-style animated agent flow. Fixed node layout (no drag/edit per spec).
// Nodes light by the current task phase; the latest store pulse animates a
// labelled dot along the matching edge. Clicking a node opens the agent
// drawer.

import { ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACTORS, EDGES, litNodesForPhase } from "../flow.js";
import type { FlowPulse, TaskState } from "../types.js";
import { AgentNode, type AgentNodeData } from "./flow/AgentNode.js";
import { PulseEdge, type PulseEdgeData } from "./flow/PulseEdge.js";

const nodeTypes = { agent: AgentNode };
const edgeTypes = { pulse: PulseEdge };

const PULSE_MS = 1300; // a touch longer than the 1.1s motion so the label lingers

export function FlowCanvas({
  phase,
  lastPulse,
  onOpenAgent,
}: {
  phase: TaskState | undefined;
  lastPulse: FlowPulse | null;
  onOpenAgent: (role: string, label: string) => void;
}) {
  // which edge is pulsing, with the pulse payload to render
  const [active, setActive] = useState<FlowPulse | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeq = useRef<number>(-1);

  // when a new pulse seq arrives, light its edge then clear after the motion
  useEffect(() => {
    if (!lastPulse || lastPulse.seq === lastSeq.current) return;
    lastSeq.current = lastPulse.seq;
    setActive(lastPulse);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setActive(null), PULSE_MS);
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [lastPulse]);

  const lit = useMemo(() => litNodesForPhase(phase), [phase]);

  const nodes: Node<AgentNodeData>[] = useMemo(
    () =>
      ACTORS.map((a) => ({
        id: a.id,
        type: "agent",
        position: { x: a.x, y: a.y },
        draggable: false,
        connectable: false,
        selectable: false,
        data: {
          label: a.label,
          emoji: a.emoji,
          role: a.role,
          group: a.group,
          lit: lit.has(a.id),
          onOpen: onOpenAgent,
        },
      })),
    [lit, onOpenAgent],
  );

  const edges: Edge<PulseEdgeData>[] = useMemo(
    () =>
      EDGES.map((e) => {
        const isActive = active?.edgeId === e.id;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "pulse",
          data: {
            pulseSeq: isActive ? active!.seq : null,
            label: isActive ? active!.label : "",
            tone: isActive ? active!.tone : "data",
          },
        };
      }),
    [active],
  );

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-xl border border-default/60 bg-surface/40">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
      />
    </div>
  );
}
