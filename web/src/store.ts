// Pure state transitions for the dashboard — single useReducer store keyed by
// taskId. No Date.now(), no I/O: every input comes from the action, so the
// reducer is fully unit-testable (vitest, no jsdom).

import type {
  OddsPoint,
  StoreAction,
  StoreState,
  TaskEntry,
  TaskRow,
} from "./types";

export const initialState: StoreState = {
  connected: false,
  tasks: {},
  order: [],
};

/** Implied probability in bps from the pool strings (USDC units). */
export function currentPBps(task: Pick<TaskRow, "yesPool" | "noPool">): number {
  const yes = BigInt(task.yesPool || "0");
  const no = BigInt(task.noPool || "0");
  const total = yes + no;
  if (total === 0n) return 5000; // empty market -> even odds
  return Number((yes * 10000n) / total);
}

/** One seeded odds point for a task whose pools are already non-empty (acceptance snapshot). */
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

export function reducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case "connection":
      return { ...state, connected: action.connected };

    case "snapshot": {
      const tasks: Record<number, TaskEntry> = {};
      for (const task of action.tasks) {
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
      };
    }

    case "task": {
      const { task } = action;
      const existing = state.tasks[task.taskId];
      const entry: TaskEntry = existing
        ? {
            ...existing,
            task,
            // first time the pools become non-empty (acceptance) → seed the series
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
      const { bet, pBps } = action;
      const entry: TaskEntry = {
        ...existing,
        task: {
          ...existing.task,
          yesPool: bet.yesPoolAfter,
          noPool: bet.noPoolAfter,
        },
        bets: [...existing.bets, bet],
        odds: [...existing.odds, { t: bet.ts, pBps }],
      };
      return { ...state, tasks: { ...state.tasks, [action.taskId]: entry } };
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

    default:
      return state;
  }
}
