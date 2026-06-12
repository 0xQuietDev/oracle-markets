// WS-B Task B3 — Trust Tuple math per DESIGN §6.6.
import { describe, it, expect } from "vitest";
import { computeTrustCore, buildTrustTuple, type SettledWorkerTask } from "../src/trust.js";
import { OracleDb } from "../src/db.js";
import type { Deployment } from "@oracle/shared/config";

const DEP = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  deployBlock: 0,
  contracts: {
    oracleCore: "0x1111111111111111111111111111111111111111",
    usdc: "0x2222222222222222222222222222222222222222",
    identityRegistry: "0x3333333333333333333333333333333333333333",
    reputationRegistry: "0x4444444444444444444444444444444444444444",
    validationRegistry: "0x5555555555555555555555555555555555555555",
  },
  usdcDomain: { name: "USD Coin", version: "2" },
  params: {
    minSelfStakeBps: 1000, protocolFeeBps: 200, validatorFeeShareBps: 5000,
    bettingWindow: 600, acceptWindow: 3600, disputeWindow: 600, graceWindow: 300,
    validationThreshold: 80, minBet: "100000", maxPoolPerSide: "10000000000", minReward: "1000000",
  },
  agents: {},
} as unknown as Deployment;

describe("computeTrustCore", () => {
  it("plan fixture: two settled tasks p=0.5 YES + p=0.5 NO => brier 0.25, winRate 0.5", () => {
    const tasks: SettledWorkerTask[] = [
      { pCutoffBps: 5000, outcome: "Yes", selfStake: 15_000_000n, reward: 100_000_000n },
      { pCutoffBps: 5000, outcome: "No", selfStake: 15_000_000n, reward: 100_000_000n },
    ];
    const core = computeTrustCore(tasks);
    expect(core.n).toBe(2);
    expect(core.brier).toBeCloseTo(0.25, 10);
    expect(core.winRate).toBeCloseTo(0.5, 10);
    expect(core.ssr).toBeCloseTo(0.15, 10);
    expect(core.forfeited).toBe(15_000_000n); // only the NO task's self-stake is lost
  });

  it("perfectly-priced agent has brier 0", () => {
    const core = computeTrustCore([
      { pCutoffBps: 10000, outcome: "Yes", selfStake: 10_000_000n, reward: 100_000_000n },
      { pCutoffBps: 0, outcome: "No", selfStake: 10_000_000n, reward: 100_000_000n },
    ]);
    expect(core.brier).toBe(0);
    expect(core.winRate).toBe(0.5);
    expect(core.forfeited).toBe(10_000_000n);
  });

  it("empty history => zeros", () => {
    const core = computeTrustCore([]);
    expect(core).toEqual({ n: 0, winRate: 0, brier: 0, ssr: 0, forfeited: 0n });
  });

  it("missing p_cutoff treated as p=1.0 (self-stake-only market)", () => {
    const core = computeTrustCore([{ pCutoffBps: null, outcome: "No", selfStake: 10n, reward: 100n }]);
    expect(core.brier).toBe(1); // (1 - 0)^2
  });
});

describe("buildTrustTuple", () => {
  function seededDb(): OracleDb {
    const db = new OracleDb(":memory:");
    // settled YES at p=0.5
    db.insertTask({ taskId: 1, client: "0xc1", workerAgentId: 7, validatorAgentId: 2, reward: "100000000", createdAt: 1000, deadline: 5000, specUri: "http://s/a.json" });
    db.markAccepted(1, { workerWallet: "0xw", selfStake: "15000000", acceptedAt: 1100, betCutoff: 1300 });
    db.setPCutoffBps(1, 5000);
    db.markSettled(1, { outcome: "Yes", viaRule: 2, validatorScore: 100 });
    // settled NO at p=0.5
    db.insertTask({ taskId: 2, client: "0xc1", workerAgentId: 7, validatorAgentId: 2, reward: "100000000", createdAt: 2000, deadline: 6000, specUri: "http://s/b.json" });
    db.markAccepted(2, { workerWallet: "0xw", selfStake: "15000000", acceptedAt: 2100, betCutoff: 2300 });
    db.setPCutoffBps(2, 5000);
    db.markSettled(2, { outcome: "No", viaRule: 3, validatorScore: 50 });
    // currently-open task: pools 60/40
    db.insertTask({ taskId: 3, client: "0xc1", workerAgentId: 7, validatorAgentId: 2, reward: "100000000", createdAt: 3000, deadline: 9000, specUri: "http://s/a.json" });
    db.markAccepted(3, { workerWallet: "0xw", selfStake: "10000000", acceptedAt: 3100, betCutoff: 3400 });
    db.updatePools(3, "60000000", "40000000");
    return db;
  }

  it("assembles the full DESIGN §6.6 tuple", async () => {
    const db = seededDb();
    const tuple = await buildTrustTuple(db, DEP, 7, async () => ({ count: 2, sum: "100" }));
    expect(tuple.agentId).toBe(7);
    expect(tuple.agentRegistry).toBe("eip155:31337:0x3333333333333333333333333333333333333333");
    expect(tuple.n).toBe(2);
    expect(tuple.brier).toBe("0.2500"); // 4-decimal fixed string
    expect(tuple.winRate).toBe(0.5);
    expect(tuple.ssr).toBeCloseTo(0.15, 10);
    expect(tuple.forfeited).toBe("15000000");
    expect(tuple.p_live).toEqual([{ taskId: 3, pBps: 6000 }]);
    expect(tuple.rep8004).toEqual({ count: 2, sum: "100" });
    db.close();
  });

  it("tolerates a reverting reputation registry (rep8004 = null)", async () => {
    const db = seededDb();
    const tuple = await buildTrustTuple(db, DEP, 7, async () => {
      throw new Error("revert");
    });
    expect(tuple.rep8004).toBeNull();
    db.close();
  });

  it("cold start agent: n=0, empty p_live", async () => {
    const db = new OracleDb(":memory:");
    const tuple = await buildTrustTuple(db, DEP, 99);
    expect(tuple.n).toBe(0);
    expect(tuple.brier).toBe("0.0000");
    expect(tuple.p_live).toEqual([]);
    expect(tuple.rep8004).toBeNull();
    db.close();
  });
});
