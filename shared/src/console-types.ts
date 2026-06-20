// Demo-console protocol — FROZEN binding interface (spec 2026-06-13-demo-console).
// oracle-server EMITS these; the web console CONSUMES them. The base task/bet/
// settled messages are unchanged from plan §2.5; this file adds the console
// channels (activity, payment, tx, director) and the extended snapshot.

export type ActivityKind =
  | "confidence"
  | "solution"
  | "accept"
  | "deliver"
  | "bet"
  | "abstain"
  | "verdict"
  | "claim"
  | "info";

/** One line of agent "thinking" surfaced to the dashboard feed + node drawers. */
export type ActivityItem = {
  ts: number; // unix ms
  taskId: number; // 0 = not task-scoped
  agent: string; // display name, e.g. "ORACLE Worker"
  role: string; // worker | bettorRep | bettorSkeptic | bettorMirror | validator | vendor | client
  kind: ActivityKind;
  text: string; // the reasoning / message
  side?: "YES" | "NO";
  amount?: string; // USDC units (6dp), decimal string
  score?: number; // validator score 0..100
  confidence?: number; // worker confidence 0..1
  source?: "gemini" | "rule"; // honesty tag — was this a real LLM decision?
  code?: string; // for kind="solution": the source the worker wrote
};

/** A real x402 settlement, animated as a pulse along a flow edge. */
export type PaymentEvent = {
  ts: number;
  taskId?: number;
  from: string; // payer address
  to: string; // payee address
  amountUnits: string; // USDC units (6dp), decimal string
  purpose: "vendor" | "validator-intake" | "odds" | "trust";
  txHash?: string;
};

export type TxKind = "create" | "accept" | "bet" | "deliver" | "settle" | "feedback" | "claim";

/** A real on-chain transaction, clickable → decoded receipt via GET /v1/tx/:hash. */
export type TxEvent = {
  ts: number;
  taskId: number;
  kind: TxKind;
  txHash: string;
  label?: string;
};

export type DirectorStatus = {
  mode: "live" | "replay";
  runId?: string;
  block?: number;
  serverOk?: boolean;
  geminiOk?: boolean | "limited";
};

/** Decoded receipt returned by GET /v1/tx/:hash (the bundled mini-explorer). */
export type TxReceiptView = {
  txHash: string;
  blockNumber: number;
  from: string;
  to: string | null;
  status: "success" | "reverted";
  gasUsed: string;
  events: { name: string; args: Record<string, string> }[];
};

// Base channels are re-declared structurally so the web package can import this
// single file without depending on server internals. `task`/`bet` payloads are
// the server's row shapes (camelCase, USDC units as decimal strings).
export type ConsoleWsMessage =
  | { type: "snapshot"; tasks: unknown[]; activity: ActivityItem[]; payments: PaymentEvent[]; txs: TxEvent[]; director: DirectorStatus }
  | { type: "task"; task: unknown }
  | { type: "bet"; taskId: number; bet: unknown; pBps: number }
  | { type: "settled"; taskId: number; outcome: "Yes" | "No"; viaRule: number; validatorScore: number }
  | { type: "activity"; item: ActivityItem }
  | { type: "payment"; payment: PaymentEvent }
  | { type: "tx"; tx: TxEvent }
  | { type: "director"; status: DirectorStatus };

// Ingestion endpoints the agents POST to (server broadcasts + buffers):
//   POST /v1/activity   body: ActivityItem (server stamps ts if absent)
//   POST /v1/payment    body: PaymentEvent
// Read/replay:
//   GET  /v1/tx/:hash   -> TxReceiptView
//   GET  /v1/runs       -> { runs: string[] }
//   GET  /v1/replay/:id (SSE/WS replay of runs/<id>.jsonl at original cadence)
export const CONSOLE_INGEST = {
  activity: "/v1/activity",
  payment: "/v1/payment",
  tx: "/v1/tx",
  runs: "/v1/runs",
  replay: "/v1/replay",
} as const;
