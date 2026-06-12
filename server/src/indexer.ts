// Event indexer — DESIGN §8.1. getLogs catch-up from deployBlock, then
// watchContractEvent (1 s poll) for all OracleCore events + ValidationResponded.
// Thin, obvious wiring; all derived math lives in trust.ts / db.ts.
import type { AbiEvent, PublicClient } from "viem";
import { ORACLE_CORE_ABI, VALIDATION_REGISTRY_ABI, OUTCOME } from "@oracle/shared/abi";
import type { Deployment } from "@oracle/shared/config";
import type { OracleDb, TaskRow } from "./db.js";
import type { WsMessage } from "./ws.js";
import { computeTrustCore, settledInputsFor } from "./trust.js";

const CORE_EVENTS = ORACLE_CORE_ABI.filter((i) => i.type === "event") as unknown as AbiEvent[];
const VAL_EVENTS = VALIDATION_REGISTRY_ABI.filter(
  (i) => i.type === "event" && i.name === "ValidationResponded",
) as unknown as AbiEvent[];

export type IndexerOptions = {
  db: OracleDb;
  dep: Deployment;
  client: PublicClient;
  broadcast?: (msg: WsMessage) => void;
  pollingInterval?: number;
};

export type Indexer = { stop: () => void };

type AnyLog = {
  eventName: string;
  args: Record<string, any>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
};

export async function startIndexer(opts: IndexerOptions): Promise<Indexer> {
  const { db, dep, client } = opts;
  const broadcast = opts.broadcast ?? (() => {});
  const pollingInterval = opts.pollingInterval ?? 1000;
  const tsCache = new Map<bigint, number>();

  async function blockTime(bn: bigint): Promise<number> {
    const hit = tsCache.get(bn);
    if (hit !== undefined) return hit;
    const block = await client.getBlock({ blockNumber: bn });
    const t = Number(block.timestamp);
    tsCache.set(bn, t);
    return t;
  }

  // Per-source cursors make replays idempotent (plan §4 B3).
  function isNew(cursorKey: string, log: AnyLog): boolean {
    const cur = db.getMeta(cursorKey);
    if (!cur) return true;
    const [bn, li] = cur.split(":");
    const cbn = BigInt(bn);
    if (log.blockNumber > cbn) return true;
    if (log.blockNumber < cbn) return false;
    return log.logIndex > Number(li);
  }
  function advance(cursorKey: string, log: AnyLog): void {
    db.setMeta(cursorKey, `${log.blockNumber}:${log.logIndex}`);
    db.setMeta("lastBlock", log.blockNumber.toString());
  }

  function pushTask(taskId: number): TaskRow | undefined {
    const task = db.getTask(taskId);
    if (task) broadcast({ type: "task", task });
    return task;
  }

  /** p_cutoff_bps = last odds snapshot at/or-before betCutoff (10000 if only self-stake). */
  function ensurePCutoff(taskId: number): void {
    const task = db.getTask(taskId);
    if (!task || task.pCutoffBps != null || task.betCutoff == null) return;
    db.setPCutoffBps(taskId, db.lastSnapshotAtOrBefore(taskId, task.betCutoff) ?? 10_000);
  }

  function recomputeTrust(workerAgentId: number): void {
    const core = computeTrustCore(settledInputsFor(db, workerAgentId));
    db.upsertTrustTuple({
      agentId: workerAgentId,
      n: core.n,
      winRate: core.winRate,
      brier: core.brier,
      ssr: core.ssr,
      forfeited: core.forfeited.toString(),
      updatedAt: Math.floor(Date.now() / 1000),
      json: JSON.stringify({
        agentId: workerAgentId, n: core.n, winRate: core.winRate,
        brier: core.brier.toFixed(4), ssr: core.ssr, forfeited: core.forfeited.toString(),
      }),
    });
  }

  async function handleCoreLog(log: AnyLog): Promise<void> {
    const a = log.args;
    const ts = await blockTime(log.blockNumber);
    switch (log.eventName) {
      case "TaskCreated": {
        const taskId = Number(a.taskId);
        db.insertTask({
          taskId,
          client: a.client,
          workerAgentId: Number(a.workerAgentId),
          validatorAgentId: Number(a.validatorAgentId),
          reward: a.reward.toString(),
          createdAt: ts,
          deadline: Number(a.deadline),
          specUri: a.specURI,
        });
        pushTask(taskId);
        break;
      }
      case "TaskAccepted": {
        const taskId = Number(a.taskId);
        db.markAccepted(taskId, {
          workerWallet: a.workerWallet,
          selfStake: a.selfStake.toString(),
          acceptedAt: ts,
          betCutoff: Number(a.betCutoff),
        });
        // p = 10000 bps while only the self-stake is in the YES pool
        db.insertSnapshot(taskId, ts, 10_000);
        pushTask(taskId);
        break;
      }
      case "BetPlaced": {
        const taskId = Number(a.taskId);
        const yes = a.yesPool as bigint;
        const no = a.noPool as bigint;
        const pBps = Number((yes * 10_000n) / (yes + no));
        db.updatePools(taskId, yes.toString(), no.toString());
        const bet = db.insertBet({
          taskId,
          agentId: Number(a.agentId),
          bettor: a.bettor,
          side: Number(a.side) === 0 ? "Yes" : "No",
          amount: a.amount.toString(),
          yesPoolAfter: yes.toString(),
          noPoolAfter: no.toString(),
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash,
          ts,
        });
        db.insertSnapshot(taskId, ts, pBps);
        broadcast({ type: "bet", taskId, bet, pBps });
        break;
      }
      case "ExecutionStarted": {
        const taskId = Number(a.taskId);
        ensurePCutoff(taskId);
        db.setState(taskId, "Executing");
        pushTask(taskId);
        break;
      }
      case "DeliverySubmitted": {
        const taskId = Number(a.taskId);
        ensurePCutoff(taskId);
        db.markDelivered(taskId, {
          deliveredAt: ts,
          deliverableHash: a.deliverableHash,
          evidenceUri: a.evidenceURI,
        });
        db.setMeta(`reqhash:${a.validationRequestHash}`, String(taskId));
        pushTask(taskId);
        break;
      }
      case "OutcomeResolved": {
        const taskId = Number(a.taskId);
        ensurePCutoff(taskId);
        const outcome = OUTCOME[Number(a.outcome)] as "Yes" | "No";
        const viaRule = Number(a.viaRule);
        const validatorScore = Number(a.validatorScore);
        db.markSettled(taskId, { outcome, viaRule, validatorScore });
        const task = pushTask(taskId);
        if (task) recomputeTrust(task.workerAgentId);
        broadcast({ type: "settled", taskId, outcome, viaRule, validatorScore });
        break;
      }
      case "TaskCancelled": {
        const taskId = Number(a.taskId);
        db.markCancelled(taskId);
        pushTask(taskId);
        break;
      }
      // Claimed / FeedbackPosted carry no indexed state we serve.
      default:
        break;
    }
  }

  async function handleValLog(log: AnyLog): Promise<void> {
    if (log.eventName !== "ValidationResponded") return;
    const taskId = db.getMeta(`reqhash:${log.args.requestHash}`);
    if (taskId !== undefined) db.setValidatorScore(Number(taskId), Number(log.args.response));
  }

  async function processBatch(
    cursorKey: string,
    logs: AnyLog[],
    handler: (log: AnyLog) => Promise<void>,
  ): Promise<void> {
    for (const log of logs) {
      if (!isNew(cursorKey, log)) continue;
      try {
        await handler(log);
      } catch (err) {
        console.error(`[indexer] failed on ${log.eventName} @${log.blockNumber}:${log.logIndex}`, err);
      }
      advance(cursorKey, log);
    }
  }

  // ---- catch-up ----
  const latest = await client.getBlockNumber();
  const fromBlock = BigInt(dep.deployBlock);
  const coreLogs = (await client.getLogs({
    address: dep.contracts.oracleCore,
    events: CORE_EVENTS,
    fromBlock,
    toBlock: latest,
  })) as unknown as AnyLog[];
  await processBatch("cursor:core", coreLogs, handleCoreLog);
  const valLogs = (await client.getLogs({
    address: dep.contracts.validationRegistry,
    events: VAL_EVENTS,
    fromBlock,
    toBlock: latest,
  })) as unknown as AnyLog[];
  await processBatch("cursor:val", valLogs, handleValLog);
  db.setMeta("lastBlock", latest.toString());

  // ---- live watch (serialized so handlers never interleave) ----
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (fn: () => Promise<void>) => {
    queue = queue.then(fn).catch((err) => console.error("[indexer] watch batch failed", err));
  };

  const unwatchCore = client.watchContractEvent({
    address: dep.contracts.oracleCore,
    abi: ORACLE_CORE_ABI,
    pollingInterval,
    onLogs: (logs) => enqueue(() => processBatch("cursor:core", logs as unknown as AnyLog[], handleCoreLog)),
    onError: (err) => console.error("[indexer] core watch error", err),
  });
  const unwatchVal = client.watchContractEvent({
    address: dep.contracts.validationRegistry,
    abi: VALIDATION_REGISTRY_ABI,
    eventName: "ValidationResponded",
    pollingInterval,
    onLogs: (logs) => enqueue(() => processBatch("cursor:val", logs as unknown as AnyLog[], handleValLog)),
    onError: (err) => console.error("[indexer] validation watch error", err),
  });

  return {
    stop() {
      unwatchCore();
      unwatchVal();
    },
  };
}
