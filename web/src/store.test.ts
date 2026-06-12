import { describe, expect, it } from "vitest";
import { currentPBps, initialState, reducer } from "./store";
import type { BetRow, StoreState, TaskRow } from "./types";

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    taskId: 1,
    client: "0xc11e0000000000000000000000000000000000c1",
    workerAgentId: 1,
    validatorAgentId: 2,
    reward: "100000000",
    createdAt: 1_000,
    deadline: 2_000,
    specUri: "http://localhost:8402/specs/task-a-slugify.json",
    state: "Created",
    workerWallet: null,
    selfStake: null,
    acceptedAt: null,
    betCutoff: null,
    deliveredAt: null,
    deliverableHash: null,
    evidenceUri: null,
    outcome: null,
    viaRule: null,
    validatorScore: null,
    yesPool: "0",
    noPool: "0",
    pCutoffBps: null,
    ...overrides,
  };
}

function makeBet(overrides: Partial<BetRow> = {}): BetRow {
  return {
    id: 1,
    taskId: 1,
    agentId: 4,
    bettor: "0x5ce9000000000000000000000000000000000004",
    side: "No",
    amount: "15000000",
    yesPoolAfter: "15000000",
    noPoolAfter: "15000000",
    blockNumber: 42,
    txHash: "0xabc",
    ts: 1_100,
    ...overrides,
  };
}

describe("reducer: snapshot", () => {
  it("loads tasks keyed by taskId, ordered newest-first", () => {
    const t1 = makeTask({ taskId: 1, createdAt: 1_000 });
    const t2 = makeTask({ taskId: 2, createdAt: 1_500 });
    const s = reducer(initialState, { type: "snapshot", tasks: [t1, t2] });
    expect(Object.keys(s.tasks)).toHaveLength(2);
    expect(s.order).toEqual([2, 1]);
    expect(s.tasks[1].task).toEqual(t1);
    expect(s.tasks[1].bets).toEqual([]);
  });

  it("seeds the odds series from pools for already-accepted tasks", () => {
    const t = makeTask({
      taskId: 1,
      state: "Open",
      selfStake: "15000000",
      acceptedAt: 1_050,
      betCutoff: 1_230,
      yesPool: "15000000",
      noPool: "5000000",
    });
    const s = reducer(initialState, { type: "snapshot", tasks: [t] });
    expect(s.tasks[1].odds).toEqual([{ t: 1_050, pBps: 7500 }]);
  });

  it("preserves an existing bet/odds history across reconnect snapshots", () => {
    let s = reducer(initialState, { type: "snapshot", tasks: [makeTask()] });
    s = reducer(s, { type: "bet", taskId: 1, bet: makeBet(), pBps: 5000 });
    const s2 = reducer(s, { type: "snapshot", tasks: [makeTask({ state: "Open" })] });
    expect(s2.tasks[1].bets).toHaveLength(1);
    expect(s2.tasks[1].odds).toHaveLength(1);
    expect(s2.tasks[1].task.state).toBe("Open");
  });
});

describe("reducer: task upsert", () => {
  it("inserts a new task and keeps order newest-first", () => {
    let s = reducer(initialState, { type: "task", task: makeTask({ taskId: 1, createdAt: 1_000 }) });
    s = reducer(s, { type: "task", task: makeTask({ taskId: 2, createdAt: 1_600 }) });
    expect(s.order).toEqual([2, 1]);
    expect(s.tasks[2].task.taskId).toBe(2);
  });

  it("updates an existing task in place (Created -> Open) and seeds odds at acceptance", () => {
    let s = reducer(initialState, { type: "task", task: makeTask() });
    const open = makeTask({
      state: "Open",
      selfStake: "15000000",
      workerWallet: "0x3070000000000000000000000000000000000002",
      acceptedAt: 1_050,
      betCutoff: 1_230,
      yesPool: "15000000",
      noPool: "0",
    });
    s = reducer(s, { type: "task", task: open });
    expect(s.order).toEqual([1]);
    expect(s.tasks[1].task.state).toBe("Open");
    expect(s.tasks[1].task.selfStake).toBe("15000000");
    expect(s.tasks[1].odds).toEqual([{ t: 1_050, pBps: 10000 }]);
  });
});

describe("reducer: bet", () => {
  function openState(): StoreState {
    return reducer(initialState, {
      type: "snapshot",
      tasks: [
        makeTask({
          state: "Open",
          selfStake: "15000000",
          acceptedAt: 1_050,
          betCutoff: 1_230,
          yesPool: "15000000",
          noPool: "0",
        }),
      ],
    });
  }

  it("appends the bet, appends an odds point, and updates the task pools", () => {
    const s = reducer(openState(), { type: "bet", taskId: 1, bet: makeBet(), pBps: 5000 });
    const e = s.tasks[1];
    expect(e.bets).toHaveLength(1);
    expect(e.bets[0].side).toBe("No");
    expect(e.odds[e.odds.length - 1]).toEqual({ t: 1_100, pBps: 5000 });
    expect(e.task.yesPool).toBe("15000000");
    expect(e.task.noPool).toBe("15000000");
  });

  it("accumulates multiple bets into a growing odds series", () => {
    let s = reducer(openState(), { type: "bet", taskId: 1, bet: makeBet(), pBps: 5000 });
    s = reducer(s, {
      type: "bet",
      taskId: 1,
      bet: makeBet({ id: 2, agentId: 3, side: "Yes", amount: "10000000", yesPoolAfter: "25000000", noPoolAfter: "15000000", ts: 1_120 }),
      pBps: 6250,
    });
    expect(s.tasks[1].bets).toHaveLength(2);
    expect(s.tasks[1].odds.map((o) => o.pBps)).toEqual([10000, 5000, 6250]);
    expect(s.tasks[1].task.yesPool).toBe("25000000");
  });

  it("ignores bets for unknown tasks", () => {
    const s = reducer(initialState, { type: "bet", taskId: 99, bet: makeBet({ taskId: 99 }), pBps: 5000 });
    expect(s).toBe(initialState);
  });
});

describe("reducer: settled", () => {
  it("flips the task to Settled with outcome, viaRule, validatorScore and marks justSettled", () => {
    let s = reducer(initialState, { type: "snapshot", tasks: [makeTask({ state: "Delivered" })] });
    s = reducer(s, { type: "settled", taskId: 1, outcome: "No", viaRule: 3, validatorScore: 50 });
    const e = s.tasks[1];
    expect(e.task.state).toBe("Settled");
    expect(e.task.outcome).toBe("No");
    expect(e.task.viaRule).toBe(3);
    expect(e.task.validatorScore).toBe(50);
    expect(e.justSettled).toBe(true);
  });

  it("snapshot-loaded settled tasks are NOT marked justSettled (no banner replay)", () => {
    const s = reducer(initialState, {
      type: "snapshot",
      tasks: [makeTask({ state: "Settled", outcome: "Yes", viaRule: 2, validatorScore: 100 })],
    });
    expect(s.tasks[1].justSettled).toBe(false);
  });
});

describe("reducer: connection", () => {
  it("tracks socket connectivity", () => {
    const s = reducer(initialState, { type: "connection", connected: true });
    expect(s.connected).toBe(true);
    expect(reducer(s, { type: "connection", connected: false }).connected).toBe(false);
  });
});

describe("currentPBps", () => {
  it("computes implied probability in bps from pool strings", () => {
    expect(currentPBps(makeTask({ yesPool: "15000000", noPool: "15000000" }))).toBe(5000);
    expect(currentPBps(makeTask({ yesPool: "25000000", noPool: "45000000" }))).toBe(3571);
    expect(currentPBps(makeTask({ yesPool: "0", noPool: "0" }))).toBe(5000); // empty market -> even
  });
});
