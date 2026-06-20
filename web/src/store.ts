// Pure state transitions for the console — single useReducer store keyed by
// taskId plus global chronological feeds (activity/payments/txs). No Date.now(),
// no I/O: every input comes from the action, so the reducer is fully
// unit-testable (vitest, no jsdom). Consumes the FROZEN protocol from
// "@oracle/shared/console-types"; the base task/bet payloads are typed
// `unknown` there and narrowed here to the local row shapes.

import { betPulse, paymentPulse, txPulse, verdictPulse } from "./flow.js";
import type {
  ActivityItem,
  BetRow,
  DirectorStatus,
  OddsPoint,
  PaymentEvent,
  StoreAction,
  StoreState,
  TaskEntry,
  TaskRow,
  TxEvent,
} from "./types.js";

const CAP = 200; // feed arrays are capped to keep the console snappy

export const initialDirector: DirectorStatus = {
  mode: "live",
  serverOk: false,
};

export const initialState: StoreState = {
  connected: false,
  tasks: {},
  order: [],
  activity: [],
  payments: [],
  txs: [],
  director: initialDirector,
  pulseSeq: 0,
  lastPulse: null,
};

/** Implied probability in bps from the pool strings (USDC units). */
export function currentPBps(task: Pick<TaskRow, "yesPool" | "noPool">): number {
  const yes = BigInt(task.yesPool || "0");
  const no = BigInt(task.noPool || "0");
  const total = yes + no;
  if (total === 0n) return 5000; // empty market -> even odds
  return Number((yes * 10000n) / total);
}

/** One seeded odds point for a task whose pools are already non-empty. */
function seedOdds(task: TaskRow): OddsPoint[] {
  const total = BigInt(task.yesPool || "0") + BigInt(task.noPool || "0");
  if (total === 0n) return [];
  return [{ t: task.acceptedAt ?? task.createdAt, pBps: currentPBps(task) }];
}

/** taskIds newest first: createdAt desc, taskId desc as tie-break. */
function sortNewestFirst(tasks: Record<number, TaskEntry>, ids: number[]): number[] {
  return [...ids].sort(
    (a, b) => tasks[b].task.createdAt - tasks[a].task.createdAt || b - a,
  );
}

/** Keep the newest CAP items (input is chronological, oldest-first). */
function cap<T>(arr: T[]): T[] {
  return arr.length > CAP ? arr.slice(arr.length - CAP) : arr;
}

// The protocol types these as `unknown` so web stays decoupled from server
// internals. These narrowing helpers keep the casts in one place.
const asTask = (t: unknown) => t as TaskRow;
const asBet = (b: unknown) => b as BetRow;

export function reducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case "connection":
      return {
        ...state,
        connected: action.connected,
        director: { ...state.director, serverOk: action.connected },
      };

    case "snapshot": {
      const tasks: Record<number, TaskEntry> = {};
      for (const raw of action.tasks) {
        const task = asTask(raw);
        const existing = state.tasks[task.taskId];
        tasks[task.taskId] = {
          task,
          bets: existing?.bets ?? [],
          odds: existing && existing.odds.length > 0 ? existing.odds : seedOdds(task),
          justSettled: false,
        };
      }
      return {
        ...state,
        tasks,
        order: sortNewestFirst(tasks, Object.keys(tasks).map(Number)),
        activity: cap([...(action.activity ?? [])]),
        payments: cap([...(action.payments ?? [])]),
        txs: cap([...(action.txs ?? [])]),
        director: action.director ?? state.director,
      };
    }

    case "task": {
      const task = asTask(action.task);
      const existing = state.tasks[task.taskId];
      const entry: TaskEntry = existing
        ? {
            ...existing,
            task,
            // first time the pools become non-empty (acceptance) → seed series
            odds: existing.odds.length > 0 ? existing.odds : seedOdds(task),
          }
        : { task, bets: [], odds: seedOdds(task), justSettled: false };
      const tasks = { ...state.tasks, [task.taskId]: entry };
      return {
        ...state,
        tasks,
        order: sortNewestFirst(tasks, Object.keys(tasks).map(Number)),
      };
    }

    case "bet": {
      const existing = state.tasks[action.taskId];
      if (!existing) return state; // snapshot will catch us up
      const bet = asBet(action.bet);
      const entry: TaskEntry = {
        ...existing,
        task: {
          ...existing.task,
          yesPool: bet.yesPoolAfter,
          noPool: bet.noPoolAfter,
        },
        bets: [...existing.bets, bet],
        odds: cap([...existing.odds, { t: bet.ts, pBps: action.pBps }]),
      };
      const seq = state.pulseSeq + 1;
      const pulse = betPulse(seq, roleForAgent(bet.agentId), bet.side.toUpperCase(), bet.amount, action.taskId);
      return {
        ...state,
        tasks: { ...state.tasks, [action.taskId]: entry },
        pulseSeq: seq,
        lastPulse: pulse,
      };
    }

    case "settled": {
      const existing = state.tasks[action.taskId];
      if (!existing) return state;
      const entry: TaskEntry = {
        ...existing,
        task: {
          ...existing.task,
          state: "Settled",
          outcome: action.outcome,
          viaRule: action.viaRule,
          validatorScore: action.validatorScore,
        },
        justSettled: true,
      };
      return { ...state, tasks: { ...state.tasks, [action.taskId]: entry } };
    }

    case "activity": {
      const item: ActivityItem = action.item;
      const activity = cap([...state.activity, item]);
      // a verdict line emits a "score N" pulse to the chain
      if (item.kind === "verdict") {
        const seq = state.pulseSeq + 1;
        return { ...state, activity, pulseSeq: seq, lastPulse: verdictPulse(seq, item) };
      }
      return { ...state, activity };
    }

    case "payment": {
      const payment: PaymentEvent = action.payment;
      const seq = state.pulseSeq + 1;
      return {
        ...state,
        payments: cap([...state.payments, payment]),
        pulseSeq: seq,
        lastPulse: paymentPulse(seq, payment),
      };
    }

    case "tx": {
      const tx: TxEvent = action.tx;
      const seq = state.pulseSeq + 1;
      return {
        ...state,
        txs: cap([...state.txs, tx]),
        pulseSeq: seq,
        lastPulse: txPulse(seq, tx),
      };
    }

    case "director":
      return { ...state, director: { ...state.director, ...action.status } };

    default:
      return state;
  }
}

// Local fleet registration order (mock + demo). Used to route bet pulses to
// the right bettor node when only an agentId is on the bet row.
function roleForAgent(agentId: number): string {
  switch (agentId) {
    case 1:
      return "worker";
    case 2:
      return "validator";
    case 3:
      return "bettorRep";
    case 4:
      return "bettorSkeptic";
    case 5:
      return "bettorMirror";
    case 6:
      return "vendor";
    default:
      return "bettorSkeptic";
  }
}
