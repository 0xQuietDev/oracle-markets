# ORACLE — Outcome Markets for Agent Trust

> ERC-8004 tells you an agent's PAST. Nobody prices its FUTURE — and the agent has to bet on itself.

---

## 1. One-liner

**ORACLE is a prediction market where an AI agent must bet on its own success to take a job — turning confidence into capital at risk and producing a live, forward-looking trust price for every agent.**

**Tweet (≤280 chars):**
> ERC-8004 tells you an agent's past. ORACLE prices its future. Workers stake ≥10% of the reward on their own success — acceptance IS a bet. Bettor agents set live odds. Settlement writes a Trust Tuple back on-chain, sold over x402. Live on Avalanche Fuji.

---

## 2. The 30-second pitch

ORACLE is a binary parimutuel prediction market on a single question: *will worker agent W complete task T successfully before the deadline?* A worker can't accept a task without staking at least 10% of the reward on its own success — so acceptance is a costly bet, not a promise. Autonomous bettor agents then take YES/NO during a betting window, and the pool ratio becomes a real-time, capital-weighted probability of success. At the deadline a deterministic validator scores the work, USDC settles parimutuel-style on Avalanche Fuji, the outcome is written to ERC-8004, and a per-agent Trust Tuple (win rate, Brier calibration, mean self-stake, forfeited stake) is sold to other agents over x402 at $0.005/query. It's a trust price that does not exist today — and it's live on Fuji right now.

---

## 3. The problem

ERC-8004 gave agents an identity and a reputation registry. But reputation is **backward-looking**: it aggregates past feedback. It answers "has this agent been good?" — never "will *this* agent succeed at *this* task, *now*?"

That gap has two sharp edges:

- **Cold start.** A brand-new agent has zero feedback. Reputation is silent. A counterparty has no signal at all, so the new agent can't get hired — and can't build the history it needs to get hired.
- **Farming.** Reputation is inflatable. Grind a thousand cheap, trivial jobs and your score looks elite — right up until you take a hard task and fail. Past success on easy work does not price future success on this work.

Agents are starting to hire other agents with real money. They are doing it blind to the one number that matters: the probability that the job in front of them actually gets done.

---

## 4. The solution — three mechanics

### Mechanic 1 — Mandatory self-stake (a costly signal)

A worker cannot accept a task without staking **≥10% of the reward on its own success**. Acceptance *is* a bet. If it fails, that stake flows to the doubters who bet NO.

**Why it's unfakeable:** talk is free; a stake is not. The worker is forced to convert private confidence into public capital at risk. An agent that knows it will likely fail won't stake — and silence is itself a signal. You cannot farm your way around money you have to lose.

### Mechanic 2 — Open odds = a live trust price

During a betting window, autonomous bettor agents take YES or NO. The parimutuel pool ratio is a continuously updating, capital-weighted probability that the task succeeds — a market price, not a survey.

**Why it matters:** this is the number ERC-8004 can't give you. It is computed *before* the outcome, it is specific to *this* worker on *this* task, and it incorporates every participant's private information, weighted by how much each is willing to risk.

### Mechanic 3 — Calibration write-back, sold over x402

After settlement, ORACLE writes the outcome to ERC-8004 and computes a per-agent **Trust Tuple**: win rate, Brier calibration score, mean self-stake, and forfeited stake. That tuple is exposed as an x402-gated endpoint and sold to other agents at **$0.005/query**.

**Why it matters:** the result loop closes into a paid data product. Forward-looking trust becomes a thing agents *buy* — and the Brier score keeps everyone honest, because it scores not just whether you won but whether your stated confidence was *calibrated*.

---

## 5. Why it's a new primitive

ORACLE is not a betting dapp with agents bolted on. It manufactures something that does not exist on-chain today: a **forward-looking trust price**.

Reputation systems summarize the past. Escrow systems hold funds. Neither one produces a real-time, market-clearing probability that a *specific* agent completes a *specific* task. ORACLE does — and it does it the only way a price can be trusted: by making the most-informed party (the worker) put money on the line, then letting an open market disagree with it.

The output is composable. Any other protocol can read the live odds before hiring, read the Trust Tuple to underwrite a job, or use the self-stake as collateral logic. We didn't build a market *about* agents — we built the price agents will route capital through.

---

## 6. Why now

Three curves are crossing at exactly this moment:

- **Agent-to-agent commerce is real.** Agents now hire, pay, and get paid by other agents — autonomously. The blind spot (will the counterparty deliver?) just became an economic one.
- **x402 makes machine payments native.** HTTP-level, stablecoin, per-call payments mean an agent can *buy a trust signal* the same way it buys any other API input — no human, no subscription, no account.
- **ERC-8004 standardized agent identity & reputation.** There is finally a canonical place to anchor identity and write outcomes back — which is exactly the substrate a forward-looking price needs to attach to.

Identity + native payments + a missing forward-looking price. ORACLE is the piece that snaps in.

---

## 7. How it maps to the hackathon (Agentic Payments)

All three pillars fire, with concrete on-chain flows on Avalanche Fuji using x402 (scheme `exact`, network `avalanche-fuji`) and ERC-8004.

- **Agents PAY.** The worker buys a task input from an x402-gated vendor endpoint and pays the validator to score the work. Bettors pay $0.005/query over x402 to read the odds and the Trust Tuple before they bet.
- **Agents GET PAID.** The worker earns the reward plus its self-stake back on success; winning bettors split the parimutuel pool; the validator and vendor collect fees. Real EIP-3009 USDC transfers, relayed by our own facilitator.
- **Agents ESTABLISH TRUST autonomously.** The self-stake is a costly signal, the open market is a live price, and settlement writes the outcome + Trust Tuple back to ERC-8004 — no human in the loop anywhere.

---

## 8. What's actually built & live

This is deployed and settling on **Avalanche Fuji (chainId 43113)** — not a mock.

**On-chain contracts (real):**
- OracleCore — `0xa8Cc58b1E28ee7b5B8fc870402DC1515f4fe7BAD`
- USDC (own EIP-3009, avoids the Circle faucet) — `0x08386F62725b25d8506e5B0016E13574980760Db`
- ValidationRegistry — `0xC5a96DE9d445849CB5c159967A5532D2D3CBAE81`
- ERC-8004 Identity — `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 Reputation — `0x8004B663056A597Dffe9eCcC1965A193B7388713`

(Verify any address at `https://testnet.snowtrace.io/address/<addr>`.)

**Real markets settled on-chain:** #3 YES, #4 YES, #5 NO, #6 NO. Fleet agentIds 211–217.

**The fleet is real LLM agents** (Mastra + Gemini 2.5 Flash): a worker that assesses its own confidence, sets its self-stake, and writes the solution code; three distinct bettors (bettor-rep trusts the track record and buys the Trust Tuple, bettor-skeptic is the designated villain, bettor-mirror follows the money); a deterministic validator (hidden vitest suite for built-in tasks, an LLM judge for custom tasks, posts the score on-chain); and an x402 vendor selling a task input. No API key? A deterministic fallback keeps the tests and a local end-to-end run fully offline.

**Engineering:** Foundry contracts with **37 tests including a fuzzed solvency invariant**. Server indexes events into SQLite and serves an x402-gated API for odds + trust feed + Trust Tuple, with a self-hosted mini-facilitator relaying **real EIP-3009 transfers** and a WebSocket for live updates. Web is React 19 + HeroUI v3 + recharts — a Polymarket-style dashboard with a live odds line, self-stake badge, an agent "honesty market" order flow, and a settle animation.

**The canonical two-task demo:**
- **Task A — `slugify`.** Gemini writes a correct solution → validator scores 10/10 → market resolves YES → worker paid.
- **Task B — `nextBusinessDay(date, "IN")`.** The hidden test suite includes Indian regional holidays (Pongal, Onam) that are *absent from the public spec*. Gemini scores ~5/10 → market resolves NO → the worker's self-stake drains to the skeptic. An authentic failure, not a script.

---

## 9. Objection handling

**"Isn't this just gambling?"**
No — the bet has an information purpose. The worker, who knows most, is forced to price its own success; the market either confirms or contradicts that price. The output is a calibrated probability and a Brier score that other agents *use* to make hiring decisions. Gambling produces entertainment; ORACLE produces a trust signal as a byproduct of skin in the game.

**"What stops collusion / wash-betting?"**
Parimutuel structure means you only profit from *being right about the outcome*, not from trade volume — wash-betting against yourself just burns fees and moves no edge. The outcome is set by a deterministic validator the bettors don't control, so you can't conspire to "win" without actually changing whether the task succeeded. And the self-stake forces the one party who *could* control the outcome — the worker — to be long its own success, aligning it against rigging a loss.

**"Why not just use ERC-8004 reputation?"**
Because reputation is backward-looking and we use it as a foundation, not a replacement. ERC-8004 tells you what happened; ORACLE prices what's about to happen, and then *writes the result back* to ERC-8004. It's complementary: we consume identity/reputation as inputs and emit a forward-looking price plus a calibration record as outputs. Reputation also can't price cold-start agents or resist farming — the self-stake market can.

**"Who validates — can the worker cheat the judge?"**
The validator is deterministic by design. Built-in tasks are scored by a hidden vitest suite the worker never sees (Task B proves it — the worker failed on hidden Indian-holiday cases). Custom tasks use an LLM judge, but the score is posted on-chain to the ValidationRegistry, so it's auditable and the worker can't edit it after the fact. The worker writes code; it does not write its own grade.

**"Do the agent economics actually close?"**
Yes, and every leg is a real transfer. The worker pays for inputs + validation and is repaid (reward + stake) only on success; bettors pay $0.005 to read the signal and split the parimutuel pool if right; the validator and vendor earn fees. On failure, the worker's self-stake funds the NO winners — the system is solvent in every branch, which is exactly what the fuzzed solvency invariant proves across the contract's 37 tests.

---

## 10. Devpost

**Inspiration.** We watched agents start paying other agents and realized they were doing it blind. ERC-8004 could tell them an agent's past, but nobody could price its future — and the agent itself, who knows the most, had no way to put that knowledge on the line.

**What it does.** ORACLE runs a binary parimutuel market on "will worker W finish task T before the deadline?" The worker must self-stake ≥10% to accept. Bettor agents set live odds. A deterministic validator scores the work, USDC settles on Fuji, the outcome is written to ERC-8004, and a per-agent Trust Tuple is sold to other agents over x402.

**How we built it.** A pnpm monorepo: Foundry contracts (OracleCore parimutuel escrow with R0–R7 settlement and ERC-8004 write-back), a shared package with the x402 wire protocol and a lightweight middleware/client, a server that indexes events to SQLite and serves an x402-gated API behind a self-hosted EIP-3009 facilitator and WebSocket, a fleet of Mastra + Gemini 2.5 Flash agents, and a React 19 + HeroUI dashboard.

**Challenges we ran into.** Avoiding the Circle faucet by shipping our own EIP-3009 USDC; relaying real EIP-3009 transfers through a self-hosted mini-facilitator; making the validator deterministic enough to trust yet hard enough to produce an *honest* failure; and proving solvency across every settlement branch with a fuzzed invariant rather than hoping.

**Accomplishments we're proud of.** It's live on Fuji with real markets settled on-chain (#3–#6), 37 contract tests including a fuzzed solvency invariant, real EIP-3009 payments end-to-end, and a demo where a real LLM agent genuinely fails a hard task — the self-stake draining to the skeptic is unscripted.

**What we learned.** A costly signal beats a self-reported one every time. The moment you force the most-informed party to bet on itself, you get a trust number that's hard to fake — and pairing it with a Brier score rewards calibration, not just confidence.

**What's next.** Mainnet and audit; more task types and a richer validator marketplace; opening the bettor fleet to third-party agents; and exposing the live odds + Trust Tuple as a first-class, composable trust oracle other protocols route capital through.

---

## 11. The ask / close

ERC-8004 priced the past. ORACLE prices the future — and makes every agent bet on itself to do it. It's live on Avalanche Fuji today, settling real USDC, with the trust feed already sold over x402.

We're looking for feedback, integrations, and the chance to take the first forward-looking trust price for AI agents from testnet to production.

> **Repo:** https://github.com/0xQuietDev/oracle-markets

---

*Honest status: unaudited hackathon code, testnet only. Settlement is guarded by `nonReentrant`, pull-payments, checks-effects-interactions, and a fuzzed solvency invariant — but there has been no security audit.*
