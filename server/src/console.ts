// Demo-console state + helpers (spec 2026-06-13-demo-console).
// Holds the in-memory ring buffers (cap 200) for the activity / payment / tx
// channels, the DirectorState, a pure decodeReceipt() the mini-explorer uses,
// and a run recorder that tees every broadcast to runs/<runId>.jsonl. All
// shapes are the FROZEN console-types (server EMITS, web CONSUMES).
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLogs, type Abi, type TransactionReceipt } from "viem";
import type {
  ActivityItem,
  PaymentEvent,
  TxEvent,
  DirectorStatus,
  TxReceiptView,
} from "@oracle/shared/console-types";

export const RING_CAP = 200;

/** Fixed-capacity ring buffer (oldest evicted on overflow). */
export class Ring<T> {
  private items: T[] = [];
  constructor(private readonly cap = RING_CAP) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.cap) this.items.shift();
  }
  list(): T[] {
    return this.items.slice();
  }
  get length(): number {
    return this.items.length;
  }
}

export type DirectorState = {
  mode: "live" | "replay";
  runId?: string;
  geminiOk?: boolean | "limited";
};

export type ConsoleState = {
  activity: Ring<ActivityItem>;
  payments: Ring<PaymentEvent>;
  txs: Ring<TxEvent>;
  director: DirectorState;
};

export function createConsoleState(runId: string): ConsoleState {
  return {
    activity: new Ring<ActivityItem>(),
    payments: new Ring<PaymentEvent>(),
    txs: new Ring<TxEvent>(),
    director: { mode: "live", runId, geminiOk: true },
  };
}

/** Map a chainId to a short human network label. */
export function networkName(chainId: number): string {
  if (chainId === 43113) return "Fuji";
  if (chainId === 43114) return "Avalanche";
  if (chainId === 31337) return "anvil";
  return `chain ${chainId}`;
}

/** Director status surfaced over WS — merges live state with chain block + network. */
export function directorStatus(state: ConsoleState, block?: number, chainId?: number): DirectorStatus {
  return {
    mode: state.director.mode,
    runId: state.director.runId,
    block,
    serverOk: true,
    geminiOk: state.director.geminiOk,
    chainId,
    network: chainId != null ? networkName(chainId) : undefined,
  };
}

// ---- run recorder (tee broadcasts to runs/<runId>.jsonl) ----

/** Appends one {t: msOffset, msg} line per broadcast; lazily creates runs/. */
export function createRecorder(runsDir: string, runId: string): (msg: unknown) => void {
  mkdirSync(runsDir, { recursive: true });
  const file = join(runsDir, `${runId}.jsonl`);
  const start = Date.now();
  return (msg: unknown) => {
    try {
      appendFileSync(file, JSON.stringify({ t: Date.now() - start, msg }) + "\n");
    } catch {
      // recording is best-effort; never let it break a broadcast
    }
  };
}

export function listRuns(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.slice(0, -".jsonl".length))
      .sort();
  } catch {
    return [];
  }
}

export type RecordedLine = { t: number; msg: unknown };

export function readRun(runsDir: string, runId: string): RecordedLine[] {
  // basename guard — runId is path-segment only
  const safe = runId.replace(/[^A-Za-z0-9._-]/g, "");
  const text = readFileSync(join(runsDir, `${safe}.jsonl`), "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RecordedLine);
}

// ---- mini-explorer: pure receipt decoder ----

/** JSON-safe stringify for decoded event args (bigint -> decimal string). */
function stringifyArg(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => (typeof x === "bigint" ? x.toString() : x)));
  return String(v);
}

/**
 * Pure decoder: a viem TransactionReceipt + the candidate ABIs -> TxReceiptView.
 * Logs that don't match any provided ABI event are skipped (strict:false).
 */
export function decodeReceipt(receipt: TransactionReceipt, abis: Abi[]): TxReceiptView {
  const events: { name: string; args: Record<string, string> }[] = [];
  for (const abi of abis) {
    const parsed = parseEventLogs({ abi, logs: receipt.logs, strict: false });
    for (const ev of parsed) {
      const rawArgs = (ev as { args?: Record<string, unknown> }).args ?? {};
      const args: Record<string, string> = {};
      for (const [k, val] of Object.entries(rawArgs)) {
        if (/^\d+$/.test(k)) continue; // skip positional duplicates
        args[k] = stringifyArg(val);
      }
      events.push({ name: (ev as { eventName: string }).eventName, args });
    }
  }
  return {
    txHash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    from: receipt.from,
    to: receipt.to,
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    events,
  };
}
