import { llmConfidence } from "./src/mastra/agents.ts";
const specs = [
  { name: "ambiguous parseQuantity (no examples, vague rules)", spec: { template:"task-c", fn:"parseQuantity(input: string): number", rules:["handle common human formats","use sensible defaults for locale","support shorthand and fractions"], examples:[] } },
  { name: "underspecified internal-format parser", spec: { template:"task-d", fn:"normalizeRecord(raw: string): object", rules:["follow our internal record conventions","apply the usual field mappings"], examples:[] } },
];
for (const s of specs) {
  try { const r = await llmConfidence(s.spec as any); console.log(`${s.name} -> conf=${r.confidence.toFixed(2)} | ${r.reasoning.slice(0,90)}`); }
  catch(e){ console.log(`${s.name} -> ERROR ${(e as Error).message}`); }
}
