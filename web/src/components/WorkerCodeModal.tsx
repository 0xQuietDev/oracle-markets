// Clicking the worker's solution shows the actual TypeScript Gemini wrote
// (item.code) plus the validator's verdict for the same task: score + the
// structured per-hidden-test pass/fail list (verdict.tests preferred, falling
// back to parsing the verdict text). Built on a controlled HeroUI Modal.

import { Chip, Modal } from "@heroui/react";
import { clockTime } from "../format.js";
import type { ActivityItem } from "../types.js";
import { SourceTag } from "./ui.js";

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
  const tests = verdict?.tests?.length ? verdict.tests : parseTests(verdict?.text);

  return (
    <Modal.Backdrop variant="blur" isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container placement="center">
        <Modal.Dialog className="w-full max-w-[640px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-muted">
                🤖 worker solution · Task #{solution.taskId}
              </span>
              <Modal.Heading className="flex flex-wrap items-center gap-2 text-base">
                {solution.agent}
                <SourceTag source={solution.source} />
                <span className="tnum text-xs font-normal text-muted">
                  {clockTime(solution.ts)}
                </span>
              </Modal.Heading>
            </div>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            {solution.text && <p className="text-sm text-foreground/90">{solution.text}</p>}

            <pre className="max-h-[280px] overflow-auto rounded-xl bg-[oklch(0.16_0.02_265)] p-4 text-xs leading-relaxed ring-1 ring-default/50">
              <code className="font-mono text-foreground/90">
                {solution.code ?? "// (no source captured for this solution)"}
              </code>
            </pre>

            {verdict && (
              <div className="rounded-xl bg-surface-secondary p-3 ring-1 ring-default/50">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-semibold">⚖️ validator verdict</span>
                  {verdict.score != null && (
                    <Chip
                      size="sm"
                      variant="soft"
                      color={verdict.score >= 70 ? "success" : "danger"}
                    >
                      <Chip.Label>{verdict.score}/100</Chip.Label>
                    </Chip>
                  )}
                </div>
                {tests.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {tests.map((t, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-sm"
                        style={{ color: t.pass ? "var(--yes)" : "var(--no)" }}
                      >
                        <span className="font-bold">{t.pass ? "✓" : "✗"}</span>
                        <span className="text-foreground/90">{t.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-foreground/80">{verdict.text}</p>
                )}
              </div>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
