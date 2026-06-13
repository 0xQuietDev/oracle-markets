// SQLite layer (better-sqlite3, WAL) — schema is the exact SQL of plan §4 Task B3.
import Database from "better-sqlite3";

export type TaskRow = {
  taskId: number;
  client: string;
  workerAgentId: number;
  validatorAgentId: number;
  reward: string;
  createdAt: number;
  deadline: number;
  specUri: string;
  state: string; // Created | Open | Executing | Delivered | Settled | Cancelled
  workerWallet: string | null;
  selfStake: string | null;
  acceptedAt: number | null;
  betCutoff: number | null;
  deliveredAt: number | null;
  deliverableHash: string | null;
  evidenceUri: string | null;
  outcome: string | null; // Yes | No
  viaRule: number | null;
  validatorScore: number | null;
  yesPool: string;
  noPool: string;
  pCutoffBps: number | null;
};

export type BetRow = {
  id: number;
  taskId: number;
  agentId: number;
  bettor: string;
  side: "Yes" | "No";
  amount: string;
  yesPoolAfter: string;
  noPoolAfter: string;
  blockNumber: number;
  txHash: string;
  ts: number;
};

export type OddsSnapshot = { t: number; pBps: number };

export type TrustTupleRow = {
  agentId: number;
  n: number;
  winRate: number;
  brier: number;
  ssr: number;
  forfeited: string;
  updatedAt: number;
  json: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks(task_id INTEGER PRIMARY KEY, client TEXT, worker_agent_id INTEGER, validator_agent_id INTEGER,
  reward TEXT, created_at INTEGER, deadline INTEGER, spec_uri TEXT, state TEXT, worker_wallet TEXT,
  self_stake TEXT, accepted_at INTEGER, bet_cutoff INTEGER, delivered_at INTEGER, deliverable_hash TEXT,
  evidence_uri TEXT, outcome TEXT, via_rule INTEGER, validator_score INTEGER,
  yes_pool TEXT, no_pool TEXT, p_cutoff_bps INTEGER);
CREATE TABLE IF NOT EXISTS bets(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, agent_id INTEGER, bettor TEXT,
  side TEXT, amount TEXT, yes_pool_after TEXT, no_pool_after TEXT, block_number INTEGER, tx_hash TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS odds_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, t INTEGER, p_bps INTEGER);
CREATE TABLE IF NOT EXISTS trust_tuples(agent_id INTEGER PRIMARY KEY, n INTEGER, win_rate REAL, brier REAL, ssr REAL,
  forfeited TEXT, updated_at INTEGER, json TEXT);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
`;

function mapTask(r: any): TaskRow {
  return {
    taskId: r.task_id,
    client: r.client,
    workerAgentId: r.worker_agent_id,
    validatorAgentId: r.validator_agent_id,
    reward: r.reward,
    createdAt: r.created_at,
    deadline: r.deadline,
    specUri: r.spec_uri,
    state: r.state,
    workerWallet: r.worker_wallet,
    selfStake: r.self_stake,
    acceptedAt: r.accepted_at,
    betCutoff: r.bet_cutoff,
    deliveredAt: r.delivered_at,
    deliverableHash: r.deliverable_hash,
    evidenceUri: r.evidence_uri,
    outcome: r.outcome,
    viaRule: r.via_rule,
    validatorScore: r.validator_score,
    yesPool: r.yes_pool ?? "0",
    noPool: r.no_pool ?? "0",
    pCutoffBps: r.p_cutoff_bps,
  };
}

function mapBet(r: any): BetRow {
  return {
    id: r.id,
    taskId: r.task_id,
    agentId: r.agent_id,
    bettor: r.bettor,
    side: r.side,
    amount: r.amount,
    yesPoolAfter: r.yes_pool_after,
    noPoolAfter: r.no_pool_after,
    blockNumber: r.block_number,
    txHash: r.tx_hash,
    ts: r.ts,
  };
}

export class OracleDb {
  readonly db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  /**
   * Wipe all indexed data if the deployment fingerprint (chainId:oracleCore)
   * differs from what is stored. Prevents stale trust tuples / tasks from a
   * previous deployment leaking into a freshly-deployed chain (e.g. a new anvil
   * run reusing the on-disk DB), which would corrupt cold-start bettor logic.
   */
  resetIfDeploymentChanged(fingerprint: string): boolean {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key='deployment'`).get() as
      | { value: string }
      | undefined;
    if (row?.value === fingerprint) return false;
    this.db.exec(
      `DELETE FROM bets; DELETE FROM odds_snapshots; DELETE FROM trust_tuples; DELETE FROM tasks; DELETE FROM meta;`,
    );
    this.db.prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES ('deployment', ?)`).run(fingerprint);
    return true;
  }

  close(): void {
    this.db.close();
  }

  // ---- tasks ----
  insertTask(t: {
    taskId: number; client: string; workerAgentId: number; validatorAgentId: number;
    reward: string; createdAt: number; deadline: number; specUri: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO tasks(task_id, client, worker_agent_id, validator_agent_id, reward, created_at, deadline, spec_uri, state, yes_pool, no_pool)
         VALUES (?,?,?,?,?,?,?,?, 'Created', '0', '0')`,
      )
      .run(t.taskId, t.client, t.workerAgentId, t.validatorAgentId, t.reward, t.createdAt, t.deadline, t.specUri);
  }

  markAccepted(taskId: number, a: { workerWallet: string; selfStake: string; acceptedAt: number; betCutoff: number }): void {
    this.db
      .prepare(
        `UPDATE tasks SET state='Open', worker_wallet=?, self_stake=?, accepted_at=?, bet_cutoff=?, yes_pool=?, no_pool='0' WHERE task_id=?`,
      )
      .run(a.workerWallet, a.selfStake, a.acceptedAt, a.betCutoff, a.selfStake, taskId);
  }

  setState(taskId: number, state: string): void {
    this.db.prepare(`UPDATE tasks SET state=? WHERE task_id=?`).run(state, taskId);
  }

  updatePools(taskId: number, yesPool: string, noPool: string): void {
    this.db.prepare(`UPDATE tasks SET yes_pool=?, no_pool=? WHERE task_id=?`).run(yesPool, noPool, taskId);
  }

  markDelivered(taskId: number, d: { deliveredAt: number; deliverableHash: string; evidenceUri: string }): void {
    this.db
      .prepare(`UPDATE tasks SET state='Delivered', delivered_at=?, deliverable_hash=?, evidence_uri=? WHERE task_id=?`)
      .run(d.deliveredAt, d.deliverableHash, d.evidenceUri, taskId);
  }

  markSettled(taskId: number, s: { outcome: "Yes" | "No"; viaRule: number; validatorScore: number }): void {
    this.db
      .prepare(`UPDATE tasks SET state='Settled', outcome=?, via_rule=?, validator_score=? WHERE task_id=?`)
      .run(s.outcome, s.viaRule, s.validatorScore, taskId);
  }

  markCancelled(taskId: number): void {
    this.setState(taskId, "Cancelled");
  }

  setValidatorScore(taskId: number, score: number): void {
    this.db.prepare(`UPDATE tasks SET validator_score=? WHERE task_id=?`).run(score, taskId);
  }

  setPCutoffBps(taskId: number, pBps: number): void {
    this.db.prepare(`UPDATE tasks SET p_cutoff_bps=? WHERE task_id=?`).run(pBps, taskId);
  }

  getTask(taskId: number): TaskRow | undefined {
    const r = this.db.prepare(`SELECT * FROM tasks WHERE task_id=?`).get(taskId);
    return r ? mapTask(r) : undefined;
  }

  listTasks(): TaskRow[] {
    return this.db.prepare(`SELECT * FROM tasks ORDER BY task_id DESC`).all().map(mapTask);
  }

  settledForWorker(agentId: number): TaskRow[] {
    return this.db
      .prepare(`SELECT * FROM tasks WHERE worker_agent_id=? AND state='Settled' AND outcome IN ('Yes','No') ORDER BY task_id`)
      .all(agentId)
      .map(mapTask);
  }

  openForWorker(agentId: number): TaskRow[] {
    return this.db
      .prepare(`SELECT * FROM tasks WHERE worker_agent_id=? AND state IN ('Open','Executing') ORDER BY task_id`)
      .all(agentId)
      .map(mapTask);
  }

  // ---- bets & odds ----
  insertBet(b: Omit<BetRow, "id">): BetRow {
    const info = this.db
      .prepare(
        `INSERT INTO bets(task_id, agent_id, bettor, side, amount, yes_pool_after, no_pool_after, block_number, tx_hash, ts)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(b.taskId, b.agentId, b.bettor, b.side, b.amount, b.yesPoolAfter, b.noPoolAfter, b.blockNumber, b.txHash, b.ts);
    return { id: Number(info.lastInsertRowid), ...b };
  }

  listBets(taskId: number): BetRow[] {
    return this.db.prepare(`SELECT * FROM bets WHERE task_id=? ORDER BY id`).all(taskId).map(mapBet);
  }

  insertSnapshot(taskId: number, t: number, pBps: number): void {
    this.db.prepare(`INSERT INTO odds_snapshots(task_id, t, p_bps) VALUES (?,?,?)`).run(taskId, t, pBps);
  }

  listSnapshots(taskId: number): OddsSnapshot[] {
    return this.db
      .prepare(`SELECT t, p_bps FROM odds_snapshots WHERE task_id=? ORDER BY id`)
      .all(taskId)
      .map((r: any) => ({ t: r.t, pBps: r.p_bps }));
  }

  lastSnapshotAtOrBefore(taskId: number, t: number): number | undefined {
    const r = this.db
      .prepare(`SELECT p_bps FROM odds_snapshots WHERE task_id=? AND t<=? ORDER BY id DESC LIMIT 1`)
      .get(taskId, t) as any;
    return r?.p_bps;
  }

  // ---- trust tuples ----
  upsertTrustTuple(t: TrustTupleRow): void {
    this.db
      .prepare(
        `INSERT INTO trust_tuples(agent_id, n, win_rate, brier, ssr, forfeited, updated_at, json)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(agent_id) DO UPDATE SET n=excluded.n, win_rate=excluded.win_rate, brier=excluded.brier,
           ssr=excluded.ssr, forfeited=excluded.forfeited, updated_at=excluded.updated_at, json=excluded.json`,
      )
      .run(t.agentId, t.n, t.winRate, t.brier, t.ssr, t.forfeited, t.updatedAt, t.json);
  }

  getTrustTuple(agentId: number): TrustTupleRow | undefined {
    const r = this.db.prepare(`SELECT * FROM trust_tuples WHERE agent_id=?`).get(agentId) as any;
    if (!r) return undefined;
    return {
      agentId: r.agent_id, n: r.n, winRate: r.win_rate, brier: r.brier, ssr: r.ssr,
      forfeited: r.forfeited, updatedAt: r.updated_at, json: r.json,
    };
  }

  // ---- meta ----
  setMeta(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO meta(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const r = this.db.prepare(`SELECT value FROM meta WHERE key=?`).get(key) as any;
    return r?.value;
  }
}
