// Gemini model provider for the Mastra agents.
//
// "Real" mode: when a Gemini API key is present, the worker and bettor agents
// are genuine LLM agents (Gemini 2.5 Flash by default). With no key the daemons
// fall back to the deterministic strategy/solver logic, so tests + the e2e run
// stay fast and offline. The validator is ALWAYS deterministic (hidden vitest),
// by design — the judge of success must be objective, never an LLM opinion.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "@ai-sdk/google";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../.."); // agents/src/mastra -> repo root

/** Minimal dotenv: load KEY=VALUE lines from a file, without overwriting existing env. */
function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // file absent — fine
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

// Load .env.gemini then .env (first wins; existing process env always wins).
loadEnvFile(resolve(REPO_ROOT, ".env.gemini"));
loadEnvFile(resolve(REPO_ROOT, ".env"));

// @ai-sdk/google authenticates via GOOGLE_GENERATIVE_AI_API_KEY; accept the
// friendlier GEMINI_API_KEY as an alias.
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GEMINI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export function llmEnabled(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

/** The shared Gemini model instance for every Mastra agent in the fleet. */
export function geminiModel() {
  return google(GEMINI_MODEL);
}
