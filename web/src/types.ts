// Web store types. Row shapes (TaskRow/BetRow) mirror the server DB rows
// (camelCase, USDC units as decimal strings) — web has no dependency on
// server/ or chain code. The WebSocket protocol itself is the FROZEN
// interface imported from "@oracle/shared/console-types"; the base task/bet
// payloads there are typed `unknown`, so we narrow them to these rows.

import type {
  ActivityItem,
  ConsoleWsMessage,
  DirectorStatus,
  PaymentEvent,
  TxEvent,
} from "@oracle/shared/console-types";

export type {
  ActivityItem,
  ActivityKind,
  ConsoleWsMessage,
  DirectorStatus,
  PaymentEvent,
  TxEvent,
  TxKind,
  TxReceiptView,
} from "@oracle/shared/console-types";

export type TaskState =
  | "Created"
  | "Open"
  | "Executing" // UI-only label: Open && now > betCutoff (computed locally)
  | "Delivered"
  | "Settled"
  | "Cancelled";

export type OutcomeStr = "Unresolved" | "Yes" | "No";
export type SideStr = "Yes" | "No";

/** camelCase mirror of the `tasks` table. */
export interface TaskRow {
  taskId: number;
  client: string;
  workerAgentId: number;
  validatorAgentId: number;
  /** USDC units, 6 decimals, decimal string — divide by 1e6 for display only */
  reward: string;
  createdAt: number;
  deadline: number;
  specUri: string;
  state: TaskState;
  workerWallet: string | null;
  selfStake: string | null;
  acceptedAt: number | null;
  betCutoff: number | null;
  deliveredAt: number | null;
  deliverableHash: string | null;
  evidenceUri: string | null;
  outcome: OutcomeStr | null;
  viaRule: number | null;
  validatorScore: number | null;
  yesPool: string;
  noPool: string;
  pCutoffBps: number | null;
}

/** camelCase mirror of the `bets` table. */
export interface BetRow {
  id: number;
  taskId: number;
  agentId: number;
  bettor: string;
  side: SideStr;
  amount: string;
  yesPoolAfter: string;
  noPoolAfter: string;
  blockNumber: number;
  txHash: string;
  /** unix seconds */
  ts: number;
}

/** Local-only action so the UI can show connection status. */
export interface ConnectionAction {
  type: "connection";
  connected: boolean;
}

// The store consumes every frozen console message plus the local connection
// action. The base channels carry `unknown` payloads in the protocol; the
// reducer narrows them via the typed action helpers below.
export type StoreAction = ConsoleWsMessage | ConnectionAction;

export interface OddsPoint {
  /** unix seconds */
  t: number;
  pBps: number;
}

export interface TaskEntry {
  task: TaskRow;
  bets: BetRow[];
  odds: OddsPoint[];
  /** true only when settlement arrived live over the socket (drives the banner) */
  justSettled: boolean;
}

export interface StoreState {
  connected: boolean;
  tasks: Record<number, TaskEntry>;
  /** taskIds, newest first */
  order: number[];
  /** global chronological feeds, capped */
  activity: ActivityItem[];
  payments: PaymentEvent[];
  txs: TxEvent[];
  director: DirectorStatus;
  /** monotonic counter bumped on each payment/tx/bet — drives flow pulses */
  pulseSeq: number;
  /** the most recent flow pulse to animate, if any */
  lastPulse: FlowPulse | null;
}

/** A flow-canvas animation cue derived from a payment / tx / bet. */
export interface FlowPulse {
  seq: number;
  /** logical edge id (source->target actor node ids) */
  edgeId: string;
  label: string;
  tone: "money" | "score" | "feedback" | "data";
  taskId?: number;
}
