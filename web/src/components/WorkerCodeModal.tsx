// Clicking the worker's solution activity shows the actual TypeScript Gemini
// wrote (item.code) plus, when present, the validator's verdict for the same
// task (score + reasoning). Per-test detail is parsed out of the verdict text
// when the validator formats it as "test: pass/fail" lines.

import { clockTime } from "../format.js";
import type { ActivityItem } from "../types.js";

/** Pull "name … PASS/FAIL" style lines out of a verdict's free text. */
function parseTests(text?: string): { name: string; pass: boolean }[] {
  if (!text) return [];
  const out: { name: string; pass: boolean }[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/(.+?)[:\-–]\s*(pass|fail|ok|✓|✗|✅|❌)/i);
    if (m) {
      const verdict = m[2].toLowerCase();
      out.push({ name: m[1].trim(), pass: /pass|ok|✓|✅/.test(verdict) });
    }
  }
  return out;
}

export function WorkerCodeModal({
  solution,
  verdict,
  onClose,
}: {
  solution: ActivityItem;
  verdict?: ActivityItem | null;
  onClose: () => void;
}) {
  const tests = parseTests(verdict?.text);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer code-modal" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <div className="drawer-kicker">🤖 worker solution · Task #{solution.taskId}</div>
            <div className="drawer-title">
              {solution.agent}
              {solution.source && (
                <span className={"src-tag " + (solution.source === "gemini" ? "src-gemini" : "src-rule")}>
                  {solution.source === "gemini" ? "🧠 Gemini" : "⚙️ rule"}
                </span>
              )}
              <span className="feed-time">{clockTime(solution.ts)}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </header>

        {solution.text && <div className="code-summary">{solution.text}</div>}

        <pre className="code-block">
          <code>{solution.code ?? "// (no source captured for this solution)"}</code>
        </pre>

        {verdict && (
          <div className="verdict-panel">
            <div className="verdict-head">
              ⚖️ validator verdict
              {verdict.score != null && (
                <span className={"verdict-score " + (verdict.score >= 70 ? "vs-pass" : "vs-fail")}>
                  {verdict.score}/100
                </span>
              )}
            </div>
            {tests.length > 0 ? (
              <ul className="test-list">
                {tests.map((t, i) => (
                  <li key={i} className={t.pass ? "test-pass" : "test-fail"}>
                    <span className="test-mark">{t.pass ? "✓" : "✗"}</span>
                    {t.name}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="verdict-text">{verdict.text}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
