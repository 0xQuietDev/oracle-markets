// WS-D types — mirrors of the server DB row shapes (plan §4.2, camelCase)
// and the frozen WebSocket protocol (plan §2.5). Defined locally: web has no
// dependency on server/ or chain code.

export type TaskState =
  | "Created"
  | "Open"
  | "Executing" // UI-only label: Open && now > betCutoff (computed locally)
  | "Delivered"
  | "Settled"
  | "Cancelled";

export type OutcomeStr = "Unresolved" | "Yes" | "No";
export type SideStr = "Yes" | "No";

/** camelCase mirror of the `tasks` table (plan §4 Task B3). */
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

/** camelCase mirror of the `bets` table (plan §4 Task B3). */
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

// ---- frozen WebSocket protocol, plan §2.5 (server → web) ----

export interface SnapshotMsg {
  type: "snapshot";
  tasks: TaskRow[];
}
export interface TaskMsg {
  type: "task";
  task: TaskRow;
}
export interface BetMsg {
  type: "bet";
  taskId: number;
  bet: BetRow;
  pBps: number;
}
export interface SettledMsg {
  type: "settled";
  taskId: number;
  outcome: "Yes" | "No";
  viaRule: number;
  validatorScore: number;
}

export type ServerMessage = SnapshotMsg | TaskMsg | BetMsg | SettledMsg;

/** Local-only action so the UI can show connection status. */
export interface ConnectionAction {
  type: "connection";
  connected: boolean;
}

export type StoreAction = ServerMessage | ConnectionAction;

export interface OddsPoint {
  /** unix seconds */
  t: number;
  pBps: number;
}

export interface TaskEntry {
  task: TaskRow;
  bets: BetRow[];
  odds: OddsPoint[];
  /** true only when settlement arrived live over the socket (drives the 3s banner) */
  justSettled: boolean;
}

export interface StoreState {
  connected: boolean;
  tasks: Record<number, TaskEntry>;
  /** taskIds, newest first */
  order: number[];
}
