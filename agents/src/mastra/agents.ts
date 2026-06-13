// Real Mastra agents (Gemini-backed) for the ORACLE fleet.
//
//   workerAgent   — assesses its own confidence + WRITES the solution code
//   repAgent      — bets on the worker's track record + costly signal
//   skepticAgent  — contrarian; distrusts low self-stake / cold-start workers
//   mirrorAgent   — momentum trader; follows where the money already is
//
// Each agent's brain is Gemini; the *hands* (on-chain placeBet / acceptAndStake /
// submitDelivery, x402 payments) stay deterministic in the daemons. The agent
// returns a structured decision; the daemon executes it with hard guardrails
// (amount clamps, side validation, role bans enforced on-chain anyway).
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { geminiModel } from "./model.js";
import type { TaskSpec } from "../lib/confidence.js";
import { SIDE_YES, SIDE_NO, type Decision } from "../lib/strategies.js";

const MIN_BET = 100_000n; // DESIGN §6.2
const MAX_BET_USDC = 25;

// ---------------------------------------------------------------- worker

export const workerAgent = new Agent({
  id: "oracle-worker",
  name: "ORACLE Worker",
  instructions: [
    "You are an autonomous software-engineering agent competing for paid coding tasks on the ORACLE protocol.",
    "Acceptance of a task is a bet on yourself: you must stake your own USDC on your success, and you lose it if a hidden automated test suite fails your work.",
    "Be honest and calibrated. If a spec is ambiguous, under-specified, or depends on niche domain knowledge you may not fully have (e.g. obscure regional public holidays), your true probability of passing every hidden test is LOWER — say so with a lower confidence.",
    "When asked to implement, you produce a single self-contained TypeScript module: no imports, no prose, just the one exported function that exactly matches the requested signature.",
  ].join("\n"),
  model: geminiModel(),
});

const ConfidenceSchema = z.object({
  confidence: z.number().min(0).max(1).describe("Your honest probability (0..1) of passing ALL hidden tests"),
  reasoning: z.string().describe("One sentence: why this confidence"),
});

const SolutionSchema = z.object({
  code: z.string().describe("The complete standalone TypeScript module source"),
});

function specBlock(spec: TaskSpec): string {
  return [
    `Function signature: ${spec.fn ?? "(unknown)"}`,
    spec.rules?.length ? `Rules:\n- ${spec.rules.join("\n- ")}` : "",
    spec.examples?.length ? `Examples: ${JSON.stringify(spec.examples)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Worker's genuine self-assessment → confidence in [0,1]. */
export async function llmConfidence(spec: TaskSpec): Promise<{ confidence: number; reasoning: string }> {
  const res = await workerAgent.generate(
    [
      {
        role: "user",
        content:
          `Assess your probability of passing the FULL hidden test suite for this task. ` +
          `The public spec below shows only example cases; hidden tests may probe edge cases and domain knowledge not listed.\n\n${specBlock(spec)}`,
      },
    ],
    { structuredOutput: { schema: ConfidenceSchema } },
  );
  return await res.object;
}

/** Worker actually writes the solution. Returns sanitized standalone module source. */
export async function llmSolution(spec: TaskSpec, fnName: string): Promise<string> {
  const res = await workerAgent.generate(
    [
      {
        role: "user",
        content:
          `Implement this function as a single standalone TypeScript module. ` +
          `Export exactly one function named \`${fnName}\` matching the signature. ` +
          `No imports, no markdown fences, no explanation — only the module source.\n\n${specBlock(spec)}`,
      },
    ],
    { structuredOutput: { schema: SolutionSchema } },
  );
  const obj = await res.object;
  return sanitizeCode(obj.code, fnName);
}

/** Strip markdown fences / stray prose; verify the required export is present. */
export function sanitizeCode(raw: string, fnName: string): string {
  let code = raw.trim();
  const fence = code.match(/```(?:[a-zA-Z]+)?\n([\s\S]*?)```/);
  if (fence) code = fence[1].trim();
  if (!new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${fnName}\\b`).test(code)) {
    throw new Error(`LLM solution missing \`export ... ${fnName}\``);
  }
  return code.endsWith("\n") ? code : code + "\n";
}

// ---------------------------------------------------------------- bettors

const BetSchema = z.object({
  action: z.enum(["bet", "abstain"]),
  side: z.enum(["YES", "NO"]).describe("YES = worker succeeds, NO = worker fails. Required if action=bet"),
  amountUsdc: z.number().min(0).max(25).describe("Stake in whole/fractional USDC, 0.1..25. 0 if abstaining"),
  reasoning: z.string().describe("One sentence rationale"),
});

export type BetDecisionLLM = z.infer<typeof BetSchema>;

const repAgent = new Agent({
  id: "oracle-repbot",
  name: "ORACLE RepBot",
  instructions: [
    "You are a careful prediction-market bettor on the ORACLE protocol. The market asks: will worker agent W complete task T before the deadline?",
    "You weigh the worker's verified TRACK RECORD (win rate, number of settled tasks) and its COSTLY SIGNAL (how much of its own money it staked on itself — higher self-stake ratio = more genuine confidence).",
    "Bet YES when the record and signal are strong; bet NO when the worker is weak or barely staked. On a brand-new worker with no history, only back it (YES, small) if its self-stake ratio is high; otherwise abstain.",
    "Keep stakes modest (typically 5-20 USDC). Be decisive but not reckless.",
  ].join("\n"),
  model: geminiModel(),
});

const skepticAgent = new Agent({
  id: "oracle-skeptic",
  name: "ORACLE Skeptic",
  instructions: [
    "You are the designated SKEPTIC bettor on the ORACLE protocol — a contrarian who profits when over-confident worker agents fail.",
    "You are deeply suspicious of workers who stake little of their own money (low self-stake ratio) and of unproven workers with no track record. You bet NO aggressively against them.",
    "Only abstain when a worker has both a solid track record AND meaningful skin in the game. Typical NO stake: ~20 USDC.",
  ].join("\n"),
  model: geminiModel(),
});

const mirrorAgent = new Agent({
  id: "oracle-mirror",
  name: "ORACLE Mirror",
  instructions: [
    "You are a MOMENTUM bettor on the ORACLE protocol. You follow the crowd: you bet on whichever side the market money already favors, but only when the market has formed a clear opinion.",
    "If the implied probability is near 50% (no clear lean), abstain. If it leans clearly one way (more than ~10 points off 50%), bet ~10 USDC on that leading side.",
  ].join("\n"),
  model: geminiModel(),
});

export const BETTOR_AGENTS = { bettorRep: repAgent, bettorSkeptic: skepticAgent, bettorMirror: mirrorAgent } as const;
export type BettorRole = keyof typeof BETTOR_AGENTS;

export type BetContext = {
  role: BettorRole;
  rewardUsdc: number;
  selfStakeUsdc: number;
  selfStakeRatio: number;
  impliedProbabilityPct: number;
  trust?: { n: number; winRate: number; ssr: number } | null;
};

/** Ask a bettor agent for a structured decision. */
export async function llmBetDecision(ctx: BetContext): Promise<BetDecisionLLM> {
  const agent = BETTOR_AGENTS[ctx.role];
  const lines = [
    `Task reward: ${ctx.rewardUsdc} USDC`,
    `Worker self-stake: ${ctx.selfStakeUsdc} USDC (ratio ${(ctx.selfStakeRatio * 100).toFixed(0)}% of reward)`,
    `Current market implied probability of success: ${ctx.impliedProbabilityPct.toFixed(1)}%`,
  ];
  if (ctx.trust) {
    lines.push(
      `Worker track record: ${ctx.trust.n} settled task(s), win rate ${(ctx.trust.winRate * 100).toFixed(0)}%, avg self-stake ratio ${(ctx.trust.ssr * 100).toFixed(0)}%`,
    );
  } else {
    lines.push("Worker track record: none available (cold start).");
  }
  const res = await agent.generate(
    [{ role: "user", content: `Decide your bet.\n\n${lines.join("\n")}` }],
    { structuredOutput: { schema: BetSchema } },
  );
  return await res.object;
}

/** Map an LLM bet decision onto the on-chain Decision with hard money guardrails. */
export function toDecision(d: BetDecisionLLM): Decision {
  if (d.action !== "bet") return { action: "abstain" };
  const side = d.side === "YES" ? SIDE_YES : SIDE_NO;
  const clamped = Math.max(0, Math.min(MAX_BET_USDC, d.amountUsdc));
  let amount = BigInt(Math.round(clamped * 1_000_000));
  if (amount < MIN_BET) amount = MIN_BET;
  return { action: "bet", side, amount };
}
