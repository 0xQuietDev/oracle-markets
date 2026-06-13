# ORACLE — Outcome Markets for Agent Trust

> ERC-8004 tells you an agent's **past**. Nobody prices its **future** — and the agent has to bet on itself.

ORACLE turns every paid agent task into a **binary parimutuel prediction market**: *"Will worker agent W complete task T successfully before the deadline?"* — settled in USDC on Avalanche, validated against ERC-8004, and sold as a forward-looking **trust feed** over x402.

Built for **Team1 India Speedrun #1 — Agentic Payments**. Target: Avalanche Fuji (chainId 43113). Standards: **x402** (scheme `exact`) + **ERC-8004** (Identity / Reputation / Validation).

## Why it's a new primitive

1. **Mandatory self-stake (costly signal).** A worker can't accept a task without staking ≥10% of the reward on its *own* success. Acceptance *is* a bet. Fail → the stake flows to the skeptics. Confidence becomes capital at risk — unfakeable, unlike a reputation score.
2. **Open odds = a live trust price.** Any registered agent bets YES/NO during a betting window; the pool ratio is a real-time, capital-weighted probability of success.
3. **Calibration write-back, sold over x402.** After settlement ORACLE writes the outcome to ERC-8004 and computes a per-agent **Trust Tuple** (win rate, Brier calibration, mean self-stake, forfeited stake) — and **sells it to other agents at $0.005/query**. Forward-looking trust as a paid data product.

All three hackathon pillars fire: agents **pay** (worker buys task inputs + pays the validator; bettors buy the trust/odds feed), agents **get paid** (reward + winnings + fees + payouts), agents **establish trust autonomously** (self-stake + market + ERC-8004).

## The agents are real

The fleet is built on **[Mastra](https://mastra.ai)** with **Gemini 2.5 Flash** as the brain:

- **worker** — a real LLM agent that reads the task spec, honestly assesses its confidence (which sets its self-stake), and **writes the solution code**.
- **bettor-rep / -skeptic / -mirror** — LLM agents that reason over the worker's track record, costly signal, and live odds to place bets.
- **validator** — deterministic on purpose: runs a hidden `vitest` suite and posts the score on-chain. The judge of success must be objective, never an LLM opinion.
- **vendor** — an x402-gated endpoint selling a "task input."

The on-chain transactions and x402 payments stay deterministic in the daemons (with money guardrails); only the *decisions* are LLM-driven. **No key? Everything falls back to deterministic strategies** so tests + the local e2e run fast and offline.

## Architecture

```
contracts/   Foundry — OracleCore.sol (parimutuel escrow, R0–R7 settlement, ERC-8004 write-back)
             + ValidationRegistry + EIP-3009 MockUSDC + mock registries. 37 tests incl. solvency invariant.
shared/      Binding interfaces: ABI, config loader, x402 wire protocol, x402-lite middleware+client.
server/      Indexer → SQLite, x402-gated API (odds + trust feed), Trust Tuple, mini-facilitator, WebSocket.
agents/      Mastra+Gemini fleet (worker, 3 bettors, validator, vendor) + register/demo CLIs.
web/         Live ticker dashboard (React + recharts): odds line, pools, self-stake badge, settle animation.
deployments/ local.json / fuji.json — single config source.
```

## Quickstart (local, zero faucets)

```bash
pnpm install
pnpm test                      # contracts (37) + server (24) + agents (30) + web (12)
./scripts/e2e-local.sh         # boots anvil + contracts + server + 6 agents, runs Task A + Task B, asserts
```

Deterministic by default. To run the **real Gemini agents** locally:

```bash
echo 'GEMINI_API_KEY=your_key' >> .env.gemini      # https://aistudio.google.com/apikey
bash scripts/stop-all.sh; rm -f server/data/oracle.db*
PROFILE=demo bash scripts/run-all.sh               # 180s betting windows
pnpm -F @oracle/web dev                             # dashboard at http://localhost:5173/
pnpm -F @oracle/agents demo -- --both               # drive Task A (succeeds) then Task B (fails)
```

## The two-task demo

- **Task A — `slugify`:** Gemini writes a correct solution → validator scores 10/10 → **YES** → worker paid.
- **Task B — `nextBusinessDay(date, "IN")`:** the hidden tests include Indian regional holidays (Pongal, Onam) absent from the public spec. Gemini doesn't know them → scores ~5/10 → **NO** → the worker's self-stake drains to the skeptic on screen. An *authentic* failure, not a script.

## Deploying to Avalanche Fuji

See **[docs/FUJI.md](docs/FUJI.md)** — funding table, facilitator smoke test `[VERIFY-2]`, deploy + register + run commands. Canonical addresses (verified live):

| Contract | Address |
|---|---|
| USDC (Fuji) | `0x5425890298aed601595a70AB815c96711a31Bc65` (name "USD Coin", version "2", 6 decimals) |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Status & honesty

Full spec: **[docs/DESIGN.md](docs/DESIGN.md)** (frozen v1.0). Threat model: DESIGN §10. This is **unaudited hackathon code — testnet only.** Settlement is guarded by `nonReentrant`, pull-payments, checks-effects-interactions, and a fuzzed solvency invariant, but it has not had a security audit.
