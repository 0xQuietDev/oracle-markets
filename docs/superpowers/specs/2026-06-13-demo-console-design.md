# ORACLE Demo Console — Design Spec

**Date:** 2026-06-13 · **Status:** approved, build-ready · **Supersedes:** the basic `web/` dashboard.

Goal: present the ORACLE demo **clearly and visibly real** — an n8n-style animated agent-flow + a Kalshi-style market board + a live Gemini reasoning feed — driven entirely by the real system (real Gemini agents, real on-chain settlement on anvil, real x402 payments), with a recorded-replay safety net.

## Approved decisions
- **Layout:** hybrid control room (market board top, flow canvas bottom, agent feed right, director bar strip).
- **Run mode:** live + recorded replay fallback (replay = a real prior run, labelled "REPLAY (recorded live run)", never fake).
- **Proofs on screen (all four):** Gemini reasoning bubbles · the code Gemini wrote (+ per-test pass/fail) · clickable on-chain tx (decoded receipts via a bundled mini-explorer) · animated x402 payment pulses.
- **Chain:** local anvil; tx links resolve through a bundled mini-explorer (`GET /v1/tx/:hash` → decoded receipt) since anvil has no public explorer.

## Architecture
React + Vite + **@xyflow/react** (n8n engine) + recharts. Single source of live data is the existing `oracle-server` WebSocket, extended with three new channels (`activity`, `payment`, `tx`) plus a `director` control. Frozen protocol in `shared/src/console-types.ts` (binding interface — server emits, web consumes).

### Backend additions (oracle-server) — additive, removes nothing
1. **Activity channel** — agents `POST /v1/activity` (Gemini reasoning, honesty-tagged gemini|rule) → broadcast `{type:"activity"}`, buffered for snapshot.
2. **Payment channel** — x402 sellers (server odds/trust, vendor, validator-intake) `POST /v1/payment` on a settled paid request → broadcast `{type:"payment"}`, buffered.
3. **Tx channel + mini-explorer** — indexer broadcasts `{type:"tx"}` for create/accept/bet/deliver/settle/feedback/claim with the real tx hash; `GET /v1/tx/:hash` returns the decoded receipt (viem `getTransactionReceipt` + ABI decode).
4. **Director** — the WS broadcaster tees every outbound message to `runs/<runId>.jsonl` with time offsets; `GET /v1/replay/:runId` (or WS `?replay=<id>`) re-emits a recorded run through the identical protocol at original cadence; `GET /v1/runs` lists captures. Director status (live|replay, anvil block, gemini ok/limited) broadcast as `{type:"director"}`.

### Frontend (`web/`, rebuilt into the console)
Components: `MarketBoard` (Kalshi: YES/NO ¢, recharts price history, volume, pool split, countdown, resolution source), `FlowCanvas` (React Flow; custom `AgentNode` per actor + `PulseEdge` carrying labelled $ pulses; nodes light by phase), `AgentFeed` (chronological Gemini-reasoning stream, gemini|rule tag), `TxDrawer` (decoded receipt — the mini-explorer view), `WorkerCodeModal` (the actual TS Gemini wrote + validator per-hidden-test pass/fail), `DirectorBar` (● LIVE / ▶ Replay, health pills). Single WS store keyed by taskId + global feed; React Flow nodes/edges derived from store. Reconnecting WS client + a replay/mock fixture so it renders with zero backend.

Flow-canvas actors (fixed layout): Client, ORACLE (OracleCore), Worker🤖, RepBot🧠, Skeptic🦨, Mirror🪞, Validator⚖️, Vendor🏪, ERC-8004, x402 facilitator.

### Agents
Add thin `reportActivity` / `reportPayment` calls (best-effort, never block the protocol) in worker (confidence, solution, accept, deliver, claim), bettors (bet/abstain with reasoning + source tag), validator (verdict + score), vendor/validator-intake (payment received). Add 2-try backoff to Gemini calls before the existing deterministic fallback; tag each decision `source: "gemini" | "rule"`.

## Honesty & resilience
Every feed line tags 🧠 Gemini vs ⚙️ rule — a rate-limited fallback is never shown as the LLM. Replay is a real recorded run, explicitly labelled.

## Testing
Reducer unit tests for activity/payment/tx/director; a replay fixture for backendless render; existing contract (37) / server (24) / agents (30) suites stay green; `web` build clean.

## Scope cuts (YAGNI)
One task on the board at a time (A→B). Fixed node layout (no drag/edit). Mini-explorer shows receipts, not a full index. No multi-market grid.
