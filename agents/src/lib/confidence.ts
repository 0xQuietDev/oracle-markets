// Deterministic worker self-confidence (plan §5/C1, DESIGN §8.3).
// NO LLM calls anywhere — confidence is a pure function of the task template.

export type TaskSpec = {
  template?: string;
  fn?: string;
  rules?: string[];
  examples?: unknown[];
};

export const TEMPLATE_CONFIDENCE: Record<string, number> = {
  "task-a-slugify": 0.45,
  "task-b-nextbusinessday": 0.12,
};

export const DEFAULT_CONFIDENCE = 0.25;

/** Deterministic confidence per template; 0.25 for anything unknown. */
export function estimateConfidence(spec: TaskSpec): number {
  const t = spec.template ?? "";
  return TEMPLATE_CONFIDENCE[t] ?? DEFAULT_CONFIDENCE;
}

/** clamp(conf, 0.10, 0.50) — DESIGN §8.3 stake rule bounds. */
export function clampConfidence(conf: number): number {
  return Math.min(0.5, Math.max(0.1, conf));
}

/**
 * stake = reward × clamp(conf, 0.10, 0.50), computed in basis-point bigint math
 * (no floats touch the USDC amount).
 */
export function stakeFor(reward: bigint, conf: number): bigint {
  const bps = BigInt(Math.round(clampConfidence(conf) * 10_000));
  return (reward * bps) / 10_000n;
}

/** "http://host/specs/task-a-slugify.json" -> "task-a-slugify" */
export function templateFromSpecURI(specURI: string): string {
  const last = specURI.split("/").pop() ?? "";
  return last.split("?")[0].split("#")[0].replace(/\.json$/i, "");
}
