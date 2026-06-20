import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_INGEST } from "@oracle/shared";
import { reportActivity, reportBet, reportPayment } from "../src/lib/report.js";
import { SIDE_NO, SIDE_YES, type Decision } from "../src/lib/strategies.js";

// report.ts is best-effort fire-and-forget: it calls global fetch and never
// awaits/throws. We stub fetch and assert on the JSON payload SHAPE it POSTs.
type Capture = { url: string; method?: string; body: any };

function lastBody(spy: ReturnType<typeof vi.fn>): Capture {
  const call = spy.mock.calls[spy.mock.calls.length - 1];
  const [url, init] = call as [string, RequestInit];
  return { url, method: init?.method, body: JSON.parse(String(init?.body)) };
}

describe("report.ts payload shaping", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // fetch is fired without await; give the microtask queue a tick to flush.
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("reportActivity stamps ts, fills defaults, and posts to the activity endpoint", async () => {
    reportActivity({ taskId: 7, role: "worker", kind: "confidence", text: "hi", confidence: 0.8, source: "gemini" });
    await flush();
    const { url, method, body } = lastBody(fetchSpy);
    expect(url.endsWith(CONSOLE_INGEST.activity)).toBe(true);
    expect(method).toBe("POST");
    expect(typeof body.ts).toBe("number");
    expect(body.taskId).toBe(7);
    expect(body.role).toBe("worker");
    expect(body.kind).toBe("confidence");
    expect(body.confidence).toBe(0.8);
    expect(body.source).toBe("gemini");
    expect(body.agent).toBe("ORACLE"); // default
  });

  it("reportActivity omits undefined optional fields", async () => {
    reportActivity({ taskId: 1, role: "worker", kind: "deliver", text: "done" });
    await flush();
    const { body } = lastBody(fetchSpy);
    expect("side" in body).toBe(false);
    expect("amount" in body).toBe(false);
    expect("score" in body).toBe(false);
    expect("code" in body).toBe(false);
  });

  it("reportPayment posts to the payment endpoint with defaults", async () => {
    reportPayment({ from: "0xabc", to: "0xdef", amountUnits: "10000", purpose: "vendor", taskId: 3 });
    await flush();
    const { url, body } = lastBody(fetchSpy);
    expect(url.endsWith(CONSOLE_INGEST.payment)).toBe(true);
    expect(typeof body.ts).toBe("number");
    expect(body.from).toBe("0xabc");
    expect(body.to).toBe("0xdef");
    expect(body.amountUnits).toBe("10000");
    expect(body.purpose).toBe("vendor");
    expect(body.taskId).toBe(3);
    expect("txHash" in body).toBe(false);
  });

  it("reportBet maps a bet Decision to kind:bet with side+amount+source", async () => {
    const d: Decision = { action: "bet", side: SIDE_NO, amount: 20_000_000n };
    reportBet("bettorSkeptic", 5, d, "distrust thin stake", "gemini");
    await flush();
    const { body } = lastBody(fetchSpy);
    expect(body.kind).toBe("bet");
    expect(body.side).toBe("NO");
    expect(body.amount).toBe("20000000");
    expect(body.role).toBe("bettorSkeptic");
    expect(body.agent).toBe("ORACLE Skeptic");
    expect(body.source).toBe("gemini");
    expect(body.text).toBe("distrust thin stake");
  });

  it("reportBet maps a YES bet and an abstain Decision correctly", async () => {
    reportBet("bettorRep", 9, { action: "bet", side: SIDE_YES, amount: 10_000_000n }, "strong record", "rule");
    await flush();
    expect(lastBody(fetchSpy).body.side).toBe("YES");

    reportBet("bettorMirror", 9, { action: "abstain" }, "no clear lean", "rule");
    await flush();
    const { body } = lastBody(fetchSpy);
    expect(body.kind).toBe("abstain");
    expect("side" in body).toBe(false);
    expect("amount" in body).toBe(false);
    expect(body.agent).toBe("ORACLE Mirror");
  });

  it("never throws even when fetch rejects", async () => {
    fetchSpy.mockRejectedValue(new Error("server down"));
    expect(() => reportActivity({ kind: "info", text: "x" })).not.toThrow();
    await flush();
  });
});
