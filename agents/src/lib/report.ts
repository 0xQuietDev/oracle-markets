// Best-effort console reporting (spec 2026-06-13-demo-console §Agents).
//
// Agents POST their reasoning / payment events to the oracle-server console
// ingest endpoints; the server broadcasts + buffers them for the demo console.
// This is PURELY observational: it must NEVER block or break the protocol, so
// every call is wrapped in try/catch with a short timeout and silently no-ops
// on any failure (server down, slow, non-2xx). Decision/on-chain/x402 logic is
// unchanged — these are additive side-channel emits.
import { SERVER_URL, CONSOLE_INGEST, type ActivityItem, type PaymentEvent } from "@oracle/shared";
import { decodePaymentHeader } from "@oracle/shared/x402-types";
import { SIDE_YES, type Decision } from "./strategies.js";

/**
 * Best-effort extraction of {from, txHash} for a paid x402 request, from the
 * inbound X-PAYMENT header (payer = EIP-3009 authorization.from) and the
 * X-PAYMENT-RESPONSE the gate set on the way out (settlement txHash). Returns
 * empty strings on any decode failure — never throws.
 */
export function x402Settlement(getReqHeader: (name: string) => string | undefined, resPaymentResponse?: string): {
  from: string;
  txHash?: string;
} {
  let from = "";
  let txHash: string | undefined;
  try {
    const h = getReqHeader("X-PAYMENT");
    if (h) from = decodePaymentHeader(h)?.payload?.authorization?.from ?? "";
  } catch {
    // ignore
  }
  try {
    if (resPaymentResponse) {
      const decoded = JSON.parse(Buffer.from(resPaymentResponse, "base64").toString("utf8")) as {
        txHash?: string;
      };
      txHash = decoded.txHash;
    }
  } catch {
    // ignore
  }
  return { from, ...(txHash ? { txHash } : {}) };
}

const BETTOR_AGENT_NAME: Record<string, string> = {
  bettorRep: "ORACLE RepBot",
  bettorSkeptic: "ORACLE Skeptic",
  bettorMirror: "ORACLE Mirror",
};

const REPORT_TIMEOUT_MS = 1500;

async function post(path: string, body: unknown): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REPORT_TIMEOUT_MS);
    try {
      await fetch(`${SERVER_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // best-effort: console reporting must never affect the protocol path.
  }
}

/**
 * Report one line of agent "thinking" to the console feed. Stamps ts and fills
 * sensible defaults; caller supplies whatever fields it knows. Never throws.
 */
export function reportActivity(item: Partial<ActivityItem>): void {
  const full: ActivityItem = {
    ts: item.ts ?? Date.now(),
    taskId: item.taskId ?? 0,
    agent: item.agent ?? "ORACLE",
    role: item.role ?? "client",
    kind: item.kind ?? "info",
    text: item.text ?? "",
    ...(item.side !== undefined ? { side: item.side } : {}),
    ...(item.amount !== undefined ? { amount: item.amount } : {}),
    ...(item.score !== undefined ? { score: item.score } : {}),
    ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
    ...(item.source !== undefined ? { source: item.source } : {}),
    ...(item.code !== undefined ? { code: item.code } : {}),
  };
  void post(CONSOLE_INGEST.activity, full);
}

/**
 * Convenience for the three bettor daemons: shape a bet/abstain Decision into an
 * ActivityItem and report it. role = the bettor role; source = "gemini" when the
 * decision came from the LLM agent, "rule" when it fell back to deterministic
 * strategy logic. Never throws.
 */
export function reportBet(
  role: "bettorRep" | "bettorSkeptic" | "bettorMirror",
  taskId: number,
  decision: Decision,
  reasoning: string,
  source: "gemini" | "rule",
): void {
  const agent = BETTOR_AGENT_NAME[role] ?? role;
  if (decision.action === "bet") {
    reportActivity({
      taskId,
      agent,
      role,
      kind: "bet",
      text: reasoning,
      side: decision.side === SIDE_YES ? "YES" : "NO",
      amount: decision.amount.toString(),
      source,
    });
  } else {
    reportActivity({
      taskId,
      agent,
      role,
      kind: "abstain",
      text: reasoning,
      source,
    });
  }
}

/**
 * Report a real x402 settlement to the console payment channel. Stamps ts and
 * fills sensible defaults. Never throws.
 */
export function reportPayment(p: Partial<PaymentEvent>): void {
  const full: PaymentEvent = {
    ts: p.ts ?? Date.now(),
    from: p.from ?? "",
    to: p.to ?? "",
    amountUnits: p.amountUnits ?? "0",
    purpose: p.purpose ?? "vendor",
    ...(p.taskId !== undefined ? { taskId: p.taskId } : {}),
    ...(p.txHash !== undefined ? { txHash: p.txHash } : {}),
  };
  void post(CONSOLE_INGEST.payment, full);
}
