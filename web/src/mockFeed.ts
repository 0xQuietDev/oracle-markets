// Dev/demo mock feed (?mock=1): replays a scripted ConsoleWsMessage sequence —
// Task A success then Task B failure — with realistic timing and the full set
// of console channels (task/bet/settled + activity/payment/tx/director), so the
// console renders with zero backend. Emits exactly the FROZEN protocol shapes
// the real server sends (@oracle/shared/console-types).
//
// Agent ids (local registration order): 1 worker 🤖, 2 validator ⚖️,
// 3 rep 🧠, 4 skeptic 🦨, 5 mirror 🪞, 6 vendor 🏪.

import type { ActivityItem, BetRow, PaymentEvent, TaskRow, TxEvent } from "./types.js";
import type { Dispatcher } from "./ws.js";

const ADDR = {
  client: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  worker: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  rep: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  skeptic: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  mirror: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  vendor: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  oracle: "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
};

const nowSec = () => Math.floor(Date.now() / 1000);
const nowMs = () => Date.now();

const M = 1_000_000; // 1 USDC in units
const u = (usdc: number) => String(usdc * M);

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
    txHash: `0x${(0xbe7 + betId).toString(16).padStart(64, "0")}`,
    ts: nowSec(),
  };
}

let txSeq = 0;
function txHash(): string {
  txSeq += 1;
  return `0x${(0x7a000 + txSeq).toString(16).padStart(64, "0")}`;
}

function activity(p: Partial<ActivityItem> & Pick<ActivityItem, "taskId" | "agent" | "role" | "kind" | "text">): ActivityItem {
  return { ts: nowMs(), source: "gemini", ...p };
}

const SLUGIFY_CODE = `export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\\s-]/g, "")
    .replace(/\\s+/g, "-")
    .replace(/-+/g, "-");
}`;

const NBD_CODE = `export function nextBusinessDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  // BUG: ignores weekends and holidays
  return next;
}`;

/**
 * Start the scripted feed. Returns a cleanup that cancels all pending timers.
 */
export function startMockFeed(dispatch: Dispatcher): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

  let taskA: TaskRow;
  let taskB: TaskRow;

  const act = (item: ActivityItem) => dispatch({ type: "activity", item });
  const pay = (payment: PaymentEvent) => dispatch({ type: "payment", payment });
  const tx = (e: TxEvent) => dispatch({ type: "tx", tx: e });

  dispatch({ type: "connection", connected: true });
  at(200, () =>
    dispatch({
      type: "snapshot",
      tasks: [],
      activity: [],
      payments: [],
      txs: [],
      director: { mode: "replay", runId: "demo-2026-06-13", block: 1024, serverOk: true, geminiOk: true },
    }),
  );

  // ---- Task A: slugify — the success story (p drifts 0.50 → ~0.67, settles YES)
  at(1200, () => {
    taskA = baseTask(1, u(100), "task-a-slugify.json", 120);
    dispatch({ type: "task", task: taskA });
    act(activity({ taskId: 1, agent: "Client", role: "client", kind: "info", text: "Posted task: implement a URL slugify() with hidden-test acceptance." }));
    tx({ ts: nowMs(), taskId: 1, kind: "create", txHash: txHash(), label: "create task" });
    dispatch({ type: "director", status: { mode: "replay", block: 1025 } });
  });

  at(2600, () => {
    act(activity({ taskId: 1, agent: "ORACLE Worker", role: "worker", kind: "confidence", text: "Spec is well-bounded; I'm confident — staking 15% to signal it.", confidence: 0.82 }));
  });

  at(3000, () => {
    const t = nowSec();
    taskA = {
      ...taskA,
      state: "Open",
      workerWallet: ADDR.worker,
      selfStake: u(15),
      acceptedAt: t,
      betCutoff: t + 24,
      yesPool: u(15),
      noPool: "0",
    };
    dispatch({ type: "task", task: taskA });
    act(activity({ taskId: 1, agent: "ORACLE Worker", role: "worker", kind: "accept", text: "Accepted & self-staked $15 (15% of reward).", amount: u(15) }));
    tx({ ts: nowMs(), taskId: 1, kind: "accept", txHash: txHash(), label: "accept + stake" });
  });

  // bets every ~2s, each with a Gemini reasoning line + an on-chain bet tx
  at(5000, () => {
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 4, ADDR.skeptic, "No", u(15), u(15), u(15)), pBps: 5000 });
    act(activity({ taskId: 1, agent: "Skeptic", role: "bettorSkeptic", kind: "bet", side: "NO", amount: u(15), source: "gemini", text: "Hidden tests on edge cases (unicode, repeated dashes) often trip workers. Fading to 50/50." }));
    tx({ ts: nowMs(), taskId: 1, kind: "bet", txHash: txHash(), label: "skeptic NO $15" });
  });
  at(7000, () => {
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 3, ADDR.rep, "Yes", u(10), u(25), u(15)), pBps: 6250 });
    act(activity({ taskId: 1, agent: "RepBot", role: "bettorRep", kind: "bet", side: "YES", amount: u(10), source: "gemini", text: "Worker's 15% self-stake is a strong honesty signal; slugify is a solved problem. YES." }));
    tx({ ts: nowMs(), taskId: 1, kind: "bet", txHash: txHash(), label: "rep YES $10" });
  });
  at(9000, () => {
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 4, ADDR.skeptic, "No", u(5), u(25), u(20)), pBps: 5556 });
    act(activity({ taskId: 1, agent: "Skeptic", role: "bettorSkeptic", kind: "bet", side: "NO", amount: u(5), source: "rule", text: "Rate-limited — falling back to deterministic hedge of $5 NO." }));
  });
  at(11500, () => {
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 3, ADDR.rep, "Yes", u(10), u(35), u(20)), pBps: 6364 });
    act(activity({ taskId: 1, agent: "RepBot", role: "bettorRep", kind: "bet", side: "YES", amount: u(10), source: "gemini", text: "Doubling down — implied prob is too low for a routine string task." }));
    tx({ ts: nowMs(), taskId: 1, kind: "bet", txHash: txHash(), label: "rep YES $10" });
  });
  at(13500, () => {
    dispatch({ type: "bet", taskId: 1, bet: bet(1, 5, ADDR.mirror, "Yes", u(5), u(40), u(20)), pBps: 6667 });
    act(activity({ taskId: 1, agent: "Mirror", role: "bettorMirror", kind: "bet", side: "YES", amount: u(5), source: "gemini", text: "Mirroring the smart-money flow toward YES." }));
  });

  // worker buys a tool from the vendor (x402), then delivers
  at(16000, () => {
    pay({ ts: nowMs(), taskId: 1, from: ADDR.worker, to: ADDR.vendor, amountUnits: u(2), purpose: "vendor", txHash: txHash() });
    act(activity({ taskId: 1, agent: "Vendor", role: "vendor", kind: "info", text: "Sold worker a unicode-normalization helper for $2 (x402)." }));
  });
  at(18000, () => {
    act(activity({ taskId: 1, agent: "ORACLE Worker", role: "worker", kind: "solution", source: "gemini", text: "Implemented slugify() with unicode + dash collapsing; all local checks pass.", code: SLUGIFY_CODE }));
  });

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
    act(activity({ taskId: 1, agent: "ORACLE Worker", role: "worker", kind: "deliver", text: "Delivered slugify-deliverable.ts for validation." }));
    tx({ ts: nowMs(), taskId: 1, kind: "deliver", txHash: txHash(), label: "deliver" });
    pay({ ts: nowMs(), taskId: 1, from: ADDR.oracle, to: ADDR.worker, amountUnits: u(1), purpose: "validator-intake", txHash: txHash() });
  });

  at(33000, () => {
    act(activity({ taskId: 1, agent: "Validator", role: "validator", kind: "verdict", score: 100, source: "gemini", text: "ascii basic: pass\nunicode accents: pass\nrepeated dashes: pass\nleading/trailing space: pass\nempty string: pass" }));
    tx({ ts: nowMs(), taskId: 1, kind: "feedback", txHash: txHash(), label: "score 100 → ERC-8004" });
  });
  at(34000, () => {
    dispatch({ type: "settled", taskId: 1, outcome: "Yes", viaRule: 2, validatorScore: 100 });
    tx({ ts: nowMs(), taskId: 1, kind: "settle", txHash: txHash(), label: "settle YES" });
    tx({ ts: nowMs(), taskId: 1, kind: "claim", txHash: txHash(), label: "worker claim $100" });
  });

  // ---- Task B: nextBusinessDay — the trap (p drifts 0.40 → ~0.26, settles NO)
  at(39000, () => {
    taskB = baseTask(2, u(80), "task-b-nextbusinessday.json", 100);
    dispatch({ type: "task", task: taskB });
    act(activity({ taskId: 2, agent: "Client", role: "client", kind: "info", text: "Posted task: nextBusinessDay(date) skipping weekends + US holidays." }));
    tx({ ts: nowMs(), taskId: 2, kind: "create", txHash: txHash(), label: "create task" });
  });
  at(40000, () => {
    act(activity({ taskId: 2, agent: "ORACLE Worker", role: "worker", kind: "confidence", source: "rule", text: "Holiday calendar is fuzzy; staking the bare 10% minimum.", confidence: 0.41 }));
  });
  at(41000, () => {
    const t = nowSec();
    taskB = {
      ...taskB,
      state: "Open",
      workerWallet: ADDR.worker,
      selfStake: u(8),
      acceptedAt: t,
      betCutoff: t + 20,
      yesPool: u(8),
      noPool: "0",
    };
    dispatch({ type: "task", task: taskB });
    act(activity({ taskId: 2, agent: "ORACLE Worker", role: "worker", kind: "accept", text: "Accepted & self-staked only $8 (10% floor).", amount: u(8) }));
    tx({ ts: nowMs(), taskId: 2, kind: "accept", txHash: txHash(), label: "accept + stake" });
  });
  at(43000, () => {
    dispatch({ type: "bet", taskId: 2, bet: bet(2, 4, ADDR.skeptic, "No", u(12), u(8), u(12)), pBps: 4000 });
    act(activity({ taskId: 2, agent: "Skeptic", role: "bettorSkeptic", kind: "bet", side: "NO", amount: u(12), source: "gemini", text: "Bare-minimum stake = low worker confidence. Holiday edge cases are a classic trap. Heavy NO." }));
    tx({ ts: nowMs(), taskId: 2, kind: "bet", txHash: txHash(), label: "skeptic NO $12" });
  });
  at(45500, () => {
    dispatch({ type: "bet", taskId: 2, bet: bet(2, 4, ADDR.skeptic, "No", u(6), u(8), u(18)), pBps: 3077 });
    act(activity({ taskId: 2, agent: "Skeptic", role: "bettorSkeptic", kind: "bet", side: "NO", amount: u(6), source: "gemini", text: "Adding to NO — no sign the worker bought a holiday-calendar tool." }));
  });
  at(47500, () => {
    dispatch({ type: "bet", taskId: 2, bet: bet(2, 5, ADDR.mirror, "No", u(5), u(8), u(23)), pBps: 2581 });
    act(activity({ taskId: 2, agent: "Mirror", role: "bettorMirror", kind: "bet", side: "NO", amount: u(5), source: "gemini", text: "Mirroring the dominant NO flow." }));
    tx({ ts: nowMs(), taskId: 2, kind: "bet", txHash: txHash(), label: "mirror NO $5" });
  });
  at(50000, () => {
    act(activity({ taskId: 2, agent: "ORACLE Worker", role: "worker", kind: "solution", source: "gemini", text: "Naive +1 day; did not special-case weekends/holidays.", code: NBD_CODE }));
  });

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
    act(activity({ taskId: 2, agent: "ORACLE Worker", role: "worker", kind: "deliver", text: "Delivered nbd-deliverable.ts." }));
    tx({ ts: nowMs(), taskId: 2, kind: "deliver", txHash: txHash(), label: "deliver" });
  });
  at(67000, () => {
    act(activity({ taskId: 2, agent: "Validator", role: "validator", kind: "verdict", score: 50, source: "gemini", text: "weekday: pass\nfriday→monday: fail\nsaturday input: fail\nholiday (Jul 4): fail\nyear boundary: pass" }));
    tx({ ts: nowMs(), taskId: 2, kind: "feedback", txHash: txHash(), label: "score 50 → ERC-8004" });
  });
  at(68000, () => {
    dispatch({ type: "settled", taskId: 2, outcome: "No", viaRule: 3, validatorScore: 50 });
    tx({ ts: nowMs(), taskId: 2, kind: "settle", txHash: txHash(), label: "settle NO" });
  });

  return () => timers.forEach(clearTimeout);
}
