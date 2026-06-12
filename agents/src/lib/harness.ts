// Deterministic validation harness (DESIGN §8.3 validator): copies the hidden
// suite for a template next to the downloaded deliverable (solution.ts) in an
// isolated working dir inside the agents package (so node/vitest resolution
// walks up to agents/node_modules), runs vitest with the JSON reporter, and
// scores round(100 * passed / total). No LLM in the verdict path.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS_ROOT = fileURLToPath(new URL("../..", import.meta.url)); // agents/
const HIDDEN_TESTS_DIR = join(AGENTS_ROOT, "hidden-tests");
const WORK_ROOT = join(AGENTS_ROOT, ".validator-work");
const VITEST_BIN = join(AGENTS_ROOT, "node_modules", ".bin", "vitest");

export type HarnessResult = { passed: number; total: number; score: number };

export async function runHarness(
  template: string,
  solutionSource: string,
  runLabel: string,
): Promise<HarnessResult> {
  const suiteDir = join(HIDDEN_TESTS_DIR, template);
  if (!existsSync(join(suiteDir, "hidden.test.ts"))) {
    console.error(`[harness] no hidden suite for template "${template}" -> score 0`);
    return { passed: 0, total: 10, score: 0 };
  }
  mkdirSync(WORK_ROOT, { recursive: true });
  const workdir = mkdtempSync(join(WORK_ROOT, `${runLabel}-`));
  writeFileSync(join(workdir, "solution.ts"), solutionSource);
  copyFileSync(join(suiteDir, "cases.ts"), join(workdir, "cases.ts"));
  copyFileSync(join(suiteDir, "hidden.test.ts"), join(workdir, "hidden.test.ts"));
  // minimal vitest setup: ESM marker only — vitest defaults pick up *.test.ts
  writeFileSync(
    join(workdir, "package.json"),
    JSON.stringify({ name: "oracle-validation-run", private: true, type: "module" }, null, 2),
  );

  const stdout = await new Promise<string>((resolvePromise) => {
    const child = spawn(VITEST_BIN, ["run", "--reporter=json"], {
      cwd: workdir,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let errOut = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (errOut += String(d)));
    child.on("close", () => {
      if (errOut.trim()) console.log(`[harness] vitest stderr (truncated): ${errOut.slice(0, 500)}`);
      resolvePromise(out);
    });
    child.on("error", (err) => {
      console.error("[harness] vitest spawn error:", err.message);
      resolvePromise("");
    });
  });

  try {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("no JSON in vitest output");
    const report = JSON.parse(stdout.slice(start, end + 1)) as {
      numTotalTests?: number;
      numPassedTests?: number;
    };
    const total = report.numTotalTests ?? 0;
    const passed = report.numPassedTests ?? 0;
    if (total === 0) throw new Error("vitest reported 0 tests");
    return { passed, total, score: Math.round((100 * passed) / total) };
  } catch (err) {
    console.error("[harness] failed to parse vitest output -> score 0:", (err as Error).message);
    return { passed: 0, total: 10, score: 0 };
  }
}
