// Deliverable registry: template -> standalone solver module source.
// The worker uploads the raw solver source as the artifact; the validator's
// hidden suite imports it as `./solution` (named export per template's fn).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOLVER_URLS: Record<string, URL> = {
  "task-a-slugify": new URL("./solvers/slugify.ts", import.meta.url),
  "task-b-nextbusinessday": new URL("./solvers/next-business-day.ts", import.meta.url),
};

export function hasSolver(template: string): boolean {
  return template in SOLVER_URLS;
}

/** Returns the solver source emitted as a standalone module (the deliverable body). */
export function deliverableSource(template: string): string {
  const url = SOLVER_URLS[template];
  if (!url) throw new Error(`no solver registered for template "${template}"`);
  return readFileSync(fileURLToPath(url), "utf8");
}
