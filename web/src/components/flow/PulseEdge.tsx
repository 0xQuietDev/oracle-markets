// Custom React Flow edge that animates a labelled pulse travelling along the
// pipe whenever a related payment / tx / bet arrives. The dot is an SVG
// <circle> driven by <animateMotion> over the edge's bezier path; it re-mounts
// (keyed by pulse seq) so each event replays the animation. A floating label
// rides along via the EdgeLabelRenderer.

import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

export interface PulseEdgeData extends Record<string, unknown> {
  /** the seq of the active pulse on this edge, or null when idle */
  pulseSeq: number | null;
  label: string;
  tone: "money" | "score" | "feedback" | "data";
}

const TONE_COLOR: Record<string, string> = {
  money: "#22c55e",
  score: "#a78bfa",
  feedback: "#f59e0b",
  data: "#38bdf8",
};

export function PulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const d = (data ?? {}) as PulseEdgeData;
  const active = d.pulseSeq != null;
  const color = TONE_COLOR[d.tone] ?? TONE_COLOR.data;

  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: "#273052", strokeWidth: 2 }} />
      {active && (
        // keyed by seq so a fresh pulse always restarts the motion
        <g key={d.pulseSeq ?? 0}>
          <circle r={7} fill={color} className="oracle-pulse-dot" style={{ color }}>
            <animateMotion dur="1.1s" repeatCount="1" path={path} fill="freeze" />
          </circle>
        </g>
      )}
      {active && d.label && (
        <EdgeLabelRenderer>
          <div
            key={d.pulseSeq ?? 0}
            className="oracle-pulse-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: color,
              color,
            }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
