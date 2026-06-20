// Fixed flow-canvas topology + the mapping from protocol events to animated
// edge pulses. Shared by the store (which records the latest pulse) and the
// FlowCanvas component (which renders nodes/edges and plays the pulse).

import type { ActivityItem, FlowPulse, PaymentEvent, TxEvent } from "./types";

/** Stable node ids for the fixed actor layout. */
export const NODE = {
  client: "client",
  oracle: "oracle",
  worker: "worker",
  rep: "rep",
  skeptic: "skeptic",
  mirror: "mirror",
  validator: "validator",
  vendor: "vendor",
  erc8004: "erc8004",
  x402: "x402",
} as const;

export type NodeId = (typeof NODE)[keyof typeof NODE];

export interface ActorMeta {
  id: NodeId;
  label: string;
  emoji: string;
  role: string; // matches ActivityItem.role / avatar roles
  /** fixed position on the canvas */
  x: number;
  y: number;
  group: "actor" | "infra";
}

// Fixed layout: client → oracle in the centre, bettors above, worker/vendor
// right, validator below, infra (erc8004, x402) on the far edges.
export const ACTORS: ActorMeta[] = [
  { id: NODE.client, label: "Client", emoji: "🧑", role: "client", x: 40, y: 200, group: "actor" },
  { id: NODE.oracle, label: "ORACLE", emoji: "🔮", role: "oracle", x: 360, y: 200, group: "actor" },
  { id: NODE.worker, label: "Worker", emoji: "🤖", role: "worker", x: 680, y: 60, group: "actor" },
  { id: NODE.rep, label: "RepBot", emoji: "🧠", role: "bettorRep", x: 360, y: 20, group: "actor" },
  { id: NODE.skeptic, label: "Skeptic", emoji: "🦨", role: "bettorSkeptic", x: 180, y: 20, group: "actor" },
  { id: NODE.mirror, label: "Mirror", emoji: "🪞", role: "bettorMirror", x: 540, y: 20, group: "actor" },
  { id: NODE.validator, label: "Validator", emoji: "⚖️", role: "validator", x: 360, y: 380, group: "actor" },
  { id: NODE.vendor, label: "Vendor", emoji: "🏪", role: "vendor", x: 680, y: 200, group: "actor" },
  { id: NODE.erc8004, label: "ERC-8004", emoji: "⛓️", role: "infra", x: 680, y: 380, group: "infra" },
  { id: NODE.x402, label: "x402", emoji: "💸", role: "infra", x: 40, y: 380, group: "infra" },
];

export interface FlowEdgeDef {
  id: string;
  source: NodeId;
  target: NodeId;
}

// Fixed edges (the pipes pulses travel along). Pulse mapping below references
// these ids so the two stay in sync.
export const EDGES: FlowEdgeDef[] = [
  { id: "client-oracle", source: NODE.client, target: NODE.oracle },
  { id: "oracle-worker", source: NODE.oracle, target: NODE.worker },
  { id: "skeptic-oracle", source: NODE.skeptic, target: NODE.oracle },
  { id: "rep-oracle", source: NODE.rep, target: NODE.oracle },
  { id: "mirror-oracle", source: NODE.mirror, target: NODE.oracle },
  { id: "oracle-validator", source: NODE.oracle, target: NODE.validator },
  { id: "worker-vendor", source: NODE.worker, target: NODE.vendor },
  { id: "oracle-erc8004", source: NODE.oracle, target: NODE.erc8004 },
  { id: "validator-erc8004", source: NODE.validator, target: NODE.erc8004 },
  { id: "x402-oracle", source: NODE.x402, target: NODE.oracle },
];

const edgeSet = new Set(EDGES.map((e) => e.id));
/** pick an edge id, falling back to client-oracle if a mapping is unknown. */
function edge(id: string): string {
  return edgeSet.has(id) ? id : "client-oracle";
}

function usdcShort(units?: string): string {
  if (!units) return "";
  const n = Number(units) / 1e6;
  if (!Number.isFinite(n)) return "";
  return `$${n % 1 === 0 ? n : n.toFixed(2)}`;
}

const ROLE_NODE: Record<string, NodeId> = {
  worker: NODE.worker,
  bettorRep: NODE.rep,
  bettorSkeptic: NODE.skeptic,
  bettorMirror: NODE.mirror,
  validator: NODE.validator,
  vendor: NODE.vendor,
  client: NODE.client,
};

/** A bet pulse travels from the bettor node into ORACLE. */
export function betPulse(seq: number, role: string, side: string, amountUnits: string, taskId: number): FlowPulse {
  const from = ROLE_NODE[role] ?? NODE.skeptic;
  return {
    seq,
    edgeId: edge(`${from}-oracle`),
    label: `${side} ${usdcShort(amountUnits)}`.trim(),
    tone: "money",
    taskId,
  };
}

/** An x402 payment pulse. Routed by purpose. */
export function paymentPulse(seq: number, p: PaymentEvent): FlowPulse {
  const amount = usdcShort(p.amountUnits);
  switch (p.purpose) {
    case "vendor":
      return { seq, edgeId: edge("worker-vendor"), label: `${amount} buy`, tone: "money", taskId: p.taskId };
    case "validator-intake":
      return { seq, edgeId: edge("oracle-validator"), label: `${amount} intake`, tone: "money", taskId: p.taskId };
    case "odds":
      return { seq, edgeId: edge("x402-oracle"), label: `${amount} odds`, tone: "money", taskId: p.taskId };
    case "trust":
    default:
      return { seq, edgeId: edge("x402-oracle"), label: `${amount} trust`, tone: "money", taskId: p.taskId };
  }
}

/** An on-chain tx pulse. Routed by tx kind. */
export function txPulse(seq: number, tx: TxEvent): FlowPulse {
  const map: Record<string, { edgeId: string; label: string; tone: FlowPulse["tone"] }> = {
    create: { edgeId: "client-oracle", label: "create task", tone: "data" },
    accept: { edgeId: "oracle-worker", label: "accept + stake", tone: "money" },
    bet: { edgeId: "skeptic-oracle", label: "bet", tone: "money" },
    deliver: { edgeId: "worker-vendor", label: "deliver", tone: "data" },
    settle: { edgeId: "oracle-erc8004", label: "settle ⚖️", tone: "data" },
    feedback: { edgeId: "validator-erc8004", label: "feedback", tone: "feedback" },
    claim: { edgeId: "oracle-worker", label: "claim 💰", tone: "money" },
  };
  const m = map[tx.kind] ?? { edgeId: "client-oracle", label: tx.kind, tone: "data" as const };
  return { seq, edgeId: edge(m.edgeId), label: tx.label ?? m.label, tone: m.tone, taskId: tx.taskId };
}

/** Score 100 pulse from validator → erc8004 on a verdict activity. */
export function verdictPulse(seq: number, item: ActivityItem): FlowPulse {
  return {
    seq,
    edgeId: edge("validator-erc8004"),
    label: item.score != null ? `score ${item.score}` : "verdict",
    tone: "score",
    taskId: item.taskId,
  };
}

/**
 * Map the current task state to the set of node ids that should be "lit".
 * Drives the phase glow on the canvas.
 */
export function litNodesForPhase(state: string | undefined): Set<NodeId> {
  switch (state) {
    case "Created":
      return new Set<NodeId>([NODE.client, NODE.oracle]);
    case "Open":
      return new Set<NodeId>([NODE.oracle, NODE.rep, NODE.skeptic, NODE.mirror, NODE.worker]);
    case "Executing":
      return new Set<NodeId>([NODE.worker, NODE.vendor, NODE.oracle]);
    case "Delivered":
      return new Set<NodeId>([NODE.validator, NODE.oracle, NODE.worker]);
    case "Settled":
      return new Set<NodeId>([NODE.oracle, NODE.validator, NODE.erc8004]);
    default:
      return new Set<NodeId>([NODE.oracle]);
  }
}
