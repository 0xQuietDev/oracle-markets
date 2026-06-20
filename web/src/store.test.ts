import { describe, expect, it } from "vitest";
import { currentPBps, initialState, reducer } from "./store.js";
import type {
  ActivityItem,
  BetRow,
  PaymentEvent,
  StoreAction,
  StoreState,
  TaskRow,
  TxEvent,
} from "./types.js";

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

/** Build a full frozen snapshot action with sane empty feeds. */
function snapshot(tasks: TaskRow[], extra: Partial<Extract<StoreAction, { type: "snapshot" }>> = {}) {
  return {
    type: "snapshot",
    tasks,
    activity: [],
    payments: [],
    txs: [],
    director: { mode: "live", serverOk: true },
    ...extra,
  } as StoreAction;
}

function makeActivity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    ts: 1_700_000_000_000,
    taskId: 1,
    agent: "RepBot",
    role: "bettorRep",
    kind: "bet",
    text: "YES — solved problem",
    side: "YES",
    amount: "10000000",
    source: "gemini",
    ...overrides,
  };
}

describe("reducer: snapshot", () => {
  it("loads tasks keyed by taskId, ordered newest-first; hydrates feeds", () => {
    const t1 = makeTask({ taskId: 1, createdAt: 1_000 });
    const t2 = makeTask({ taskId: 2, createdAt: 1_500 });
    const a = makeActivity();
    const s = reducer(initialState, snapshot([t1, t2], { activity: [a] }));
    expect(Object.keys(s.tasks)).toHaveLength(2);
    expect(s.order).toEqual([2, 1]);
    expect(s.tasks[1].task).toEqual(t1);
    expect(s.tasks[1].bets).toEqual([]);
    expect(s.activity).toEqual([a]);
    expect(s.director.mode).toBe("live");
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
    const s = reducer(initialState, snapshot([t]));
    expect(s.tasks[1].odds).toEqual([{ t: 1_050, pBps: 7500 }]);
  });

  it("preserves an existing bet/odds history across reconnect snapshots", () => {
    let s = reducer(initialState, snapshot([makeTask()]));
    s = reducer(s, { type: "bet", taskId: 1, bet: makeBet(), pBps: 5000 });
    const s2 = reducer(s, snapshot([makeTask({ state: "Open" })]));
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
    expect(s.tasks[1].odds).toEqual([{ t: 1_050, pBps: 10000 }]);
  });
});

describe("reducer: bet", () => {
  function openState(): StoreState {
    return reducer(
      initialState,
      snapshot([
        makeTask({
          state: "Open",
          selfStake: "15000000",
          acceptedAt: 1_050,
          betCutoff: 1_230,
          yesPool: "15000000",
          noPool: "0",
        }),
      ]),
    );
  }

  it("appends the bet, appends an odds point, updates pools, and emits a pulse", () => {
    const s = reducer(openState(), { type: "bet", taskId: 1, bet: makeBet(), pBps: 5000 });
    const e = s.tasks[1];
    expect(e.bets).toHaveLength(1);
    expect(e.bets[0].side).toBe("No");
    expect(e.odds[e.odds.length - 1]).toEqual({ t: 1_100, pBps: 5000 });
    expect(e.task.yesPool).toBe("15000000");
    expect(e.task.noPool).toBe("15000000");
    expect(s.pulseSeq).toBe(1);
    expect(s.lastPulse?.tone).toBe("money");
    // agentId 4 = skeptic → pulse rides the skeptic→oracle edge
    expect(s.lastPulse?.edgeId).toBe("skeptic-oracle");
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
    expect(s.pulseSeq).toBe(2);
  });

  it("ignores bets for unknown tasks", () => {
    const s = reducer(initialState, { type: "bet", taskId: 99, bet: makeBet({ taskId: 99 }), pBps: 5000 });
    expect(s).toBe(initialState);
  });
});

describe("reducer: settled", () => {
  it("flips the task to Settled with outcome, viaRule, validatorScore and marks justSettled", () => {
    let s = reducer(initialState, snapshot([makeTask({ state: "Delivered" })]));
    s = reducer(s, { type: "settled", taskId: 1, outcome: "No", viaRule: 3, validatorScore: 50 });
    const e = s.tasks[1];
    expect(e.task.state).toBe("Settled");
    expect(e.task.outcome).toBe("No");
    expect(e.task.viaRule).toBe(3);
    expect(e.task.validatorScore).toBe(50);
    expect(e.justSettled).toBe(true);
  });

  it("snapshot-loaded settled tasks are NOT marked justSettled (no banner replay)", () => {
    const s = reducer(
      initialState,
      snapshot([makeTask({ state: "Settled", outcome: "Yes", viaRule: 2, validatorScore: 100 })]),
    );
    expect(s.tasks[1].justSettled).toBe(false);
  });
});

describe("reducer: activity", () => {
  it("appends an activity item to the global feed", () => {
    const s = reducer(initialState, { type: "activity", item: makeActivity() });
    expect(s.activity).toHaveLength(1);
    expect(s.activity[0].agent).toBe("RepBot");
    expect(s.pulseSeq).toBe(0); // a plain bet activity does not pulse the flow
  });

  it("emits a 'score' pulse on a verdict activity", () => {
    const verdict = makeActivity({ kind: "verdict", role: "validator", agent: "Validator", score: 100, side: undefined });
    const s = reducer(initialState, { type: "activity", item: verdict });
    expect(s.activity).toHaveLength(1);
    expect(s.pulseSeq).toBe(1);
    expect(s.lastPulse?.tone).toBe("score");
    expect(s.lastPulse?.label).toBe("score 100");
  });

  it("caps the activity feed at 200 items", () => {
    let s: StoreState = initialState;
    for (let i = 0; i < 250; i++) {
      s = reducer(s, { type: "activity", item: makeActivity({ ts: i, text: `line ${i}` }) });
    }
    expect(s.activity).toHaveLength(200);
    expect(s.activity[0].text).toBe("line 50"); // oldest 50 dropped
    expect(s.activity[199].text).toBe("line 249");
  });
});

describe("reducer: payment", () => {
  it("appends a payment and emits a money pulse routed by purpose", () => {
    const payment: PaymentEvent = {
      ts: 1,
      taskId: 1,
      from: "0xworker",
      to: "0xvendor",
      amountUnits: "2000000",
      purpose: "vendor",
    };
    const s = reducer(initialState, { type: "payment", payment });
    expect(s.payments).toHaveLength(1);
    expect(s.pulseSeq).toBe(1);
    expect(s.lastPulse?.edgeId).toBe("worker-vendor");
    expect(s.lastPulse?.tone).toBe("money");
  });
});

describe("reducer: tx", () => {
  it("appends a tx and emits a pulse routed by kind", () => {
    const tx: TxEvent = { ts: 1, taskId: 1, kind: "settle", txHash: "0xdead", label: "settle YES" };
    const s = reducer(initialState, { type: "tx", tx });
    expect(s.txs).toHaveLength(1);
    expect(s.txs[0].txHash).toBe("0xdead");
    expect(s.pulseSeq).toBe(1);
    expect(s.lastPulse?.edgeId).toBe("oracle-erc8004");
    expect(s.lastPulse?.label).toBe("settle YES");
  });
});

describe("reducer: director", () => {
  it("merges director status updates", () => {
    let s = reducer(initialState, { type: "director", status: { mode: "replay", runId: "run-7" } });
    expect(s.director.mode).toBe("replay");
    expect(s.director.runId).toBe("run-7");
    // partial updates must still carry `mode` (frozen DirectorStatus requires it)
    s = reducer(s, { type: "director", status: { mode: "replay", block: 2048, geminiOk: "limited" } });
    expect(s.director.block).toBe(2048);
    expect(s.director.geminiOk).toBe("limited");
    expect(s.director.runId).toBe("run-7"); // preserved across merges
  });
});

describe("reducer: connection", () => {
  it("tracks socket connectivity and reflects it in director.serverOk", () => {
    const s = reducer(initialState, { type: "connection", connected: true });
    expect(s.connected).toBe(true);
    expect(s.director.serverOk).toBe(true);
    const s2 = reducer(s, { type: "connection", connected: false });
    expect(s2.connected).toBe(false);
    expect(s2.director.serverOk).toBe(false);
  });
});

describe("currentPBps", () => {
  it("computes implied probability in bps from pool strings", () => {
    expect(currentPBps(makeTask({ yesPool: "15000000", noPool: "15000000" }))).toBe(5000);
    expect(currentPBps(makeTask({ yesPool: "25000000", noPool: "45000000" }))).toBe(3571);
    expect(currentPBps(makeTask({ yesPool: "0", noPool: "0" }))).toBe(5000); // empty market -> even
  });
});
