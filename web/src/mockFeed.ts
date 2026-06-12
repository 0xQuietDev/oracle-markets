// Dev/demo mock feed (?mock=1): replays a scripted Task A success followed by
// a Task B failure with realistic timing, so the dashboard demos with zero
// backend. Emits exactly the plan §2.5 message shapes the real server sends.
//
// Agent ids (local registration order): 1 worker 🤖, 2 validator ⚖️,
// 3 rep 🧠, 4 skeptic 🦨, 5 mirror 🪞, 6 vendor 🏪.

import type { BetRow, TaskRow } from "./types";
import type { Dispatcher } from "./ws";

const ADDR = {
  client: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  worker: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  rep: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  skeptic: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  mirror: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
};

const nowSec = () => Math.floor(Date.now() / 1000);

function baseTask(taskId: number, reward: string, specFile: string, deadlineIn: number): TaskRow {
  const t = nowSec();
  return {
    taskId,
    client: ADDR.client,
    workerAgentId: 1,
    validatorAgentId: 2,
    reward,
    createdAt: t,
    deadline: t + deadlineIn,
    specUri: `http://localhost:8402/specs/${specFile}`,
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
  };
}

let betId = 0;
function bet(
  taskId: number,
  agentId: number,
  bettor: string,
  side: "Yes" | "No",
  amount: string,
  yesPoolAfter: string,
  noPoolAfter: string,
): BetRow {
  betId += 1;
  return {
    id: betId,
    taskId,
    agentId,
    bettor,
    side,
    amount,
    yesPoolAfter,
    noPoolAfter,
    blockNumber: 1000 + betId,
    txHash: `0x${betId.toString(16).padStart(64, "0")}`,
    ts: nowSec(),
  };
}

const M = 1_000_000; // 1 USDC in units
const u = (usdc: number) => String(usdc * M);

/**
 * Start the scripted feed. Returns a cleanup that cancels all pending timers.
 */
export function startMockFeed(dispatch: Dispatcher): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

  // shared mutable task rows so later steps build on earlier ones
  let taskA: TaskRow;
  let taskB: TaskRow;

  dispatch({ type: "connection", connected: true });
  at(300, () => dispatch({ type: "snapshot", tasks: [] }));

  // ---- Task A: slugify — the success story (p drifts 0.50 → ~0.65, settles YES)
  at(1200, () => {
    taskA = baseTask(1, u(100), "task-a-slugify.json", 120);
    dispatch({ type: "task", task: taskA });
  });
  at(3000, () => {
    const t = nowSec();
    taskA = {
      ...taskA,
      state: "Open",
      workerWallet: ADDR.worker,
      selfStake: u(15), // 15% of reward — confident worker
      acceptedAt: t,
      betCutoff: t + 24,
      yesPool: u(15),
      noPool: "0",
    };
    dispatch({ type: "task", task: taskA });
  });
  // bets every ~2s: 1.00 → 0.50 → 0.625 → 0.556 → 0.636 → 0.667
  at(5000, () =>
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 4, ADDR.skeptic, "No", u(15), u(15), u(15)), pBps: 5000 }));
  at(7000, () =>
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 3, ADDR.rep, "Yes", u(10), u(25), u(15)), pBps: 6250 }));
  at(9000, () =>
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 4, ADDR.skeptic, "No", u(5), u(25), u(20)), pBps: 5556 }));
  at(11500, () =>
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 3, ADDR.rep, "Yes", u(10), u(35), u(20)), pBps: 6364 }));
  at(13500, () =>
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 5, ADDR.mirror, "Yes", u(5), u(40), u(20)), pBps: 6667 }));
  // betCutoff hits at ~27s → card flips to "Executing" via the local 1s tick
  at(31000, () => {
    taskA = {
      ...taskA,
      state: "Delivered",
      deliveredAt: nowSec(),
      deliverableHash: "0x" + "a1".repeat(32),
      evidenceUri: "http://localhost:8402/artifacts/slugify-deliverable.ts",
      yesPool: u(40),
      noPool: u(20),
    };
    dispatch({ type: "task", task: taskA });
  });
  at(34000, () =>
    dispatch({ type: "settled", taskId: 1, outcome: "Yes", viaRule: 2, validatorScore: 100 }));

  // ---- Task B: nextBusinessDay — the trap (p drifts 0.40 → ~0.25, settles NO)
  at(39000, () => {
    taskB = baseTask(2, u(80), "task-b-nextbusinessday.json", 100);
    dispatch({ type: "task", task: taskB });
  });
  at(41000, () => {
    const t = nowSec();
    taskB = {
      ...taskB,
      state: "Open",
      workerWallet: ADDR.worker,
      selfStake: u(8), // bare 10% minimum — the stake size tells the story
      acceptedAt: t,
      betCutoff: t + 20,
      yesPool: u(8),
      noPool: "0",
    };
    dispatch({ type: "task", task: taskB });
  });
  // 1.00 → 0.40 → 0.31 → 0.26
  at(43000, () =>
    dispatch({ type: "bet", taskId: 2, bet: bet(2, 4, ADDR.skeptic, "No", u(12), u(8), u(12)), pBps: 4000 }));
  at(45500, () =>
    dispatch({ type: "bet", taskId: 2, bet: bet(2, 4, ADDR.skeptic, "No", u(6), u(8), u(18)), pBps: 3077 }));
  at(47500, () =>
    dispatch({ type: "bet", taskId: 2, bet: bet(2, 5, ADDR.mirror, "No", u(5), u(8), u(23)), pBps: 2581 }));
  // cutoff at ~61s → Executing; harness scores 5/10 → NO
  at(65000, () => {
    taskB = {
      ...taskB,
      state: "Delivered",
      deliveredAt: nowSec(),
      deliverableHash: "0x" + "b2".repeat(32),
      evidenceUri: "http://localhost:8402/artifacts/nbd-deliverable.ts",
      yesPool: u(8),
      noPool: u(23),
    };
    dispatch({ type: "task", task: taskB });
  });
  at(68000, () =>
    dispatch({ type: "settled", taskId: 2, outcome: "No", viaRule: 3, validatorScore: 50 }));

  return () => timers.forEach(clearTimeout);
}
