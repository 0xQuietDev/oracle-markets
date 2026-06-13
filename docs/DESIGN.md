# ORACLE — Outcome Markets for Agent Trust
## Technical Design Document

| Field | Value |
|---|---|
| **Version** | 1.0 (build-ready) |
| **Date** | June 12, 2026 |
| **Event** | Team1 India Speedrun #1 — Agentic Payments (build: Jun 8–17, demo: Jun 27–28) |
| **Target network** | Avalanche Fuji testnet, chainId **43113** |
| **Standards** | x402 (scheme `exact`, network `avalanche-fuji`), ERC-8004 (Identity, Reputation, Validation registries) |
| **Team size** | 1–2 builders |
| **Status** | Frozen for implementation. Changes require a decision-record entry in §15. |

**Conventions.** The keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are used as in RFC 2119. All currency amounts are USDC with **6 decimals** (1 USDC = 1,000,000 units). All timestamps are `block.timestamp` (seconds). Items tagged `[VERIFY-n]` are facts to be re-confirmed on Day 1 of the build (see §12) — every other value in this document is final.

---

## 1. One-page summary

**Problem.** ERC-8004's Reputation Registry is *backward-looking*: it aggregates feedback about what an agent did in the past. It cannot price the question a hiring agent actually cares about: *"Will this agent succeed at this task, now?"* It is silent on new agents (cold start) and can be inflated by farming many cheap, easy jobs.

**ORACLE** adds the missing *forward-looking* trust signal: every task assigned to an agent automatically spawns a **binary parimutuel prediction market** — *"Will worker agent W complete task T successfully before the deadline?"* — settled in USDC on Avalanche Fuji.

Three mechanisms make this a new primitive rather than a gambling app:

1. **Mandatory self-stake (costly signaling).** The worker agent cannot accept a task without staking ≥ 10% of the task reward on its **own success**. Acceptance *is* a bet. If the worker fails, its stake is paid out to the skeptics who bet against it. Confidence becomes capital at risk — unfakeable, unlike a reputation score.
2. **Open odds as a live trust price.** Any ERC-8004-registered agent can bet YES/NO during the betting window. The pool ratio is a real-time, capital-weighted probability of success, aggregating private information that no registry captures.
3. **Calibration write-back.** After settlement, ORACLE writes the outcome to the ERC-8004 Reputation Registry and computes, off-chain, each worker's **Trust Tuple** — market-implied probability vs. realized outcomes (Brier score) plus average self-stake ratio. ORACLE then **sells this Trust Tuple to other agents over x402** at $0.005/query. Forward-looking trust becomes a paid data product, which is the business model.

**Why it fits the hackathon theme exactly.** Agents *pay* (worker buys task inputs and validation over x402; consumers buy trust data over x402), agents *get paid* (worker earns reward + winnings; validator earns fees; bettors earn payouts), and agents *establish trust autonomously* (self-stake + market odds + ERC-8004 write-back) — all three pillars, on Avalanche, with sub-second finality making a live on-stage market loop feasible.

**Demo in one sentence.** A live odds ticker over a real agent doing a real task: bettor agents move the line, the worker's self-stake glows on screen, the validator scores the deliverable on-chain, and money settles to winners in front of the audience — twice (one success, one failure).

---

## 2. Novelty statement & prior art

Claim made on stage MUST be precise: *"ORACLE is, to our knowledge, the first system where the underlying event of a prediction market is an AI agent's own task completion, with mandatory self-staking by the worker, settled against ERC-8004 validation and sold as a trust feed over x402."*

| Prior art | What it is | Why ORACLE is different |
|---|---|---|
| Olas/Valory prediction agents, Gnosis `prediction-market-agent`, Kalshi/Polymarket AI traders | Agents act as **traders** on markets about *external events* (elections, sports) | In ORACLE the **agent's own performance is the underlying**. The market prices the agent, not the world. |
| "Prediction Arena" (arXiv 2026) | **Benchmark** scoring LLMs by trading real markets | Evaluation harness, not a trust protocol; no self-stake, no on-chain registries, no payments rail. |
| Academic "artificial prediction markets" (Barbu & Lay; Storkey; et al.) | Simulated markets of classifiers used as an ensemble learning method | Closest intellectual ancestor — validates that markets aggregate machine confidence — but offline, simulated, no money, no identity layer. Cite it as lineage. |
| ERC-8004 Reputation Registry | Standardized **historical** feedback | ORACLE is complementary and explicitly writes back into it; ORACLE adds the *forecast* layer. |
| ERC-8183 ReputationGateHook (Base) | Escrow gated by reputation **threshold** | Gating on a static score ≠ open price discovery; no skeptic incentive, no self-stake. |
| x402Resolve (Solana hackathon) | Oracle-verified payment **escrow** | Verification of one payment, not an open market with odds, calibration, or a trust feed product. |
| Agent insurance-pool concepts | Pooled coverage against failures | Insurance prices risk via an underwriter; ORACLE prices it via an open market and makes the worker the first underwriter of itself. |

---

## 3. Goals and non-goals

### 3.1 Goals (in priority order)
- **G1.** Ship a working end-to-end loop on Fuji: task → self-stake → open betting → execution → ERC-8004 validation → parimutuel settlement → ERC-8004 reputation write-back.
- **G2.** Real x402 payments in three places: (a) Trust-feed API sold by ORACLE, (b) worker buying task inputs, (c) worker paying the validator's evaluation fee.
- **G3.** A spectator dashboard with a live odds ticker suitable for an IRL stage.
- **G4.** Honest, documented threat model (§10) — judges reward teams who know their attack surface.
- **G5.** Autonomous agent fleet: 1 worker, 3 bettors, 1 validator, all running without human input during the demo.

### 3.2 Non-goals (explicitly out of scope for v1 — do not build these)
- **N1.** Continuous AMM trading (LMSR/CPMM) during task execution — see decision DR-1.
- **N2.** Bet relaying via x402 POST (custody complexity) — bets are direct on-chain calls; see DR-4.
- **N3.** Human KYC/eligibility, real-money compliance, mainnet deployment.
- **N4.** Multi-validator quorum / validator staking & slashing (single designated validator per task in v1).
- **N5.** Cross-chain reputation portability (listed as future work via Avalanche ICM, §14).
- **N6.** Partial-completion / scalar outcomes. Markets are strictly binary.

---

## 4. Actors and trust assumptions

| Actor | On-chain identity | Holds | Role | Trust assumption in v1 |
|---|---|---|---|---|
| **Client** | EOA (registration optional) | USDC for reward | Posts task, escrows reward; fallback attestor | May be lazy (timeouts cover it); banned from betting on own task |
| **Worker agent** | ERC-8004 `agentId` (MUST) | USDC for self-stake + x402 spending; signer key | Accepts task by self-staking; executes; submits delivery | Untrusted — that is the point of the market |
| **Bettor agents** | ERC-8004 `agentId` (MUST) | USDC | Bet YES/NO during window | Untrusted; capital-weighted |
| **Validator agent** | ERC-8004 `agentId` (MUST) | Signer key; AVAX for gas | Runs deterministic test harness; posts `validationResponse` | **Trusted-but-accountable** in v1: cannot bet on assigned tasks (enforced on-chain); its verdicts are public and reputation-scored (§10, T6) |
| **ORACLE protocol** | `OracleCore` contract + `oracle-server` | Treasury fees | Escrow, market, settlement, feeds | Contract is non-upgradeable in v1; server is read-only w.r.t. funds |
| **x402 facilitator** | External service | — | Verifies & settles EIP-3009 payments | Standard x402 trust model; see §8.2 fallback |

**Wallet binding rule.** A caller acts "as" agent `A` iff `IdentityRegistry.ownerOf(A) == msg.sender` **or** `IdentityRegistry.getAgentWallet(A) == msg.sender`. This check is implemented once in an internal `_isAgentController(agentId, addr)` and used everywhere.

---

## 5. Protocol lifecycle (normative)

```
            createTask                acceptAndStake             betCutoff reached
 Client ──────────────▶ CREATED ─────────────────────▶ OPEN ─────────────────────▶ EXECUTING
   │  (escrows reward)     │      (worker stakes ≥10%,    (bets allowed)               │
   │                       │       betting opens)                                      │ submitDelivery
   │        acceptDeadline │                                                           ▼
   │        passes, no     ▼                                                       DELIVERED
   │        worker      CANCELLED ◀── (full refunds)                                   │
   │                                                              validator responds   │ (or timeouts,
   └──────────────────────────────────────────────────────────────────────────────────┤  see §6.4)
                                                                                       ▼
                                                                  YES / NO ──▶ SETTLED ──▶ claims + ERC-8004 write-back
```

Exactly six task states exist: `Created`, `Open`, `Executing`, `Delivered`, `Settled`, `Cancelled`. Exactly three outcomes exist: `Unresolved`, `Yes`, `No`. The full transition table is in §7.3; any call not listed there MUST revert.

---

## 6. Mechanism design (normative)

### 6.1 Decision records

**DR-1 — Market type: parimutuel pools. LMSR/CPMM rejected for v1.**
*Chosen:* two-pool parimutuel (YES pool, NO pool). Odds shown = implied probability `p = yesPool / (yesPool + noPool)`. Winners split the losing pool pro-rata after fees.
*Why:* zero liquidity bootstrapping (no `b` subsidy, no LP), no fixed-point `exp/ln` math (no PRBMath dependency = less audit surface in a 5-day build), payouts are two lines of arithmetic, and a hard betting cutoff (DR-2) removes parimutuel's only structural flaw (late free-riding on near-certain outcomes).
*Rejected:* LMSR — continuous prices are nicer for spectators but cost ~1.5 days of math-library risk; deferred to v2 (§14).

**DR-2 — Betting closes at a fixed cutoff, before execution begins.**
`betCutoff = acceptedAt + bettingWindow`. After the cutoff the market is frozen and the worker may begin execution. Without a cutoff, a bettor who observes the finished deliverable could bet risk-free, diluting honest early bettors. Demo configuration uses a short window (180 s) so the ticker visibly moves on stage; default is 600 s.

**DR-3 — Worker self-stake is mandatory, minimum 10% of reward, YES-only.**
Acceptance and staking are one atomic call. The worker MUST NOT be able to bet NO (directly enforced; sybil hedging is analyzed in §10/T2). The worker MAY stake more than the minimum — overstaking is itself a signal and is surfaced in the Trust Tuple.

**DR-4 — Bets are direct on-chain calls; no x402 bet relay.**
A relay would require the server to custody or move bettor funds. v1 keeps `oracle-server` strictly read-only over funds. x402 is used where it is natively strong: selling data (trust feed, odds feed) and agent-to-agent service fees (validator evaluation, task inputs).

**DR-5 — Resolution authority: ERC-8004 ValidationRegistry response from one pre-assigned validator, with deterministic timeout fallbacks.**
The validator is fixed at task creation (its `agentId` is a `createTask` parameter), so bettors can price validator quality too. Fallback ladder in §6.4 guarantees every task settles without anyone's cooperation.

### 6.2 Protocol parameters (constants, frozen)

| Name | Type | Value (default) | Value (stage demo) | Meaning |
|---|---|---|---|---|
| `MIN_SELF_STAKE_BPS` | uint16 | **1000** (10%) | 1000 | Min worker self-stake as bps of reward |
| `PROTOCOL_FEE_BPS` | uint16 | **200** (2%) | 200 | Fee on the **losing pool** at settlement |
| `VALIDATOR_FEE_SHARE_BPS` | uint16 | **5000** (50%) | 5000 | Validator's share *of the fee* (rest → treasury) |
| `BETTING_WINDOW` | uint32 | **600 s** | **180 s** | From `acceptedAt` to `betCutoff` |
| `ACCEPT_WINDOW` | uint32 | **3600 s** | 300 s | Worker must accept by `createdAt + ACCEPT_WINDOW` |
| `DISPUTE_WINDOW` (D) | uint32 | **600 s** | 120 s | Validator must respond by `deliveredAt + D` |
| `GRACE_WINDOW` (G) | uint32 | **300 s** | 60 s | Client attestation window after D lapses |
| `VALIDATION_THRESHOLD` | uint8 | **80** | 80 | Validator response ∈ [0,100]; YES iff ≥ 80 |
| `MIN_BET` | uint128 | **100_000** (0.10 USDC) | same | Dust prevention |
| `MAX_POOL_PER_SIDE` | uint128 | **10_000e6** | same | Testnet sanity cap |
| `MIN_REWARD` | uint128 | **1_000_000** (1 USDC) | same | Prevents degenerate markets |

All parameters are `immutable`, set in the constructor. No owner setters in v1 (smaller attack surface; redeploy to retune on testnet).

### 6.3 Betting rules (exact)

- **B1.** `placeBet(taskId, agentId, side, amount)` is valid iff task state is `Open`, `block.timestamp < betCutoff`, `amount ≥ MIN_BET`, pool cap not exceeded, and `_isAgentController(agentId, msg.sender)` is true.
- **B2.** Role bans, enforced by address **and** by agentId: the **client** of a task MUST NOT bet on it (either side); the **validator** assigned to a task MUST NOT bet on it (either side); the **worker** MUST NOT bet NO on its own task and MAY add additional YES stake via `placeBet`.
- **B3.** One bettor may bet multiple times and on **both** sides (other than the bans above); positions are tracked per address per side.
- **B4.** Bets are non-cancellable and non-transferable. There is no order book; a bet is a pool deposit.
- **B5.** Every bet emits `BetPlaced(taskId, agentId, bettor, side, amount, newYesPool, newNoPool)` — the indexer derives the ticker exclusively from this event stream.

### 6.4 Resolution rules (exact, exhaustive)

Let `tA = acceptedAt`, `tC = betCutoff`, `tDl = deadline`, `tDv = deliveredAt`.

| Rule | Condition | Outcome | Who can trigger |
|---|---|---|---|
| **R0** | No `acceptAndStake` by `createdAt + ACCEPT_WINDOW` | `Cancelled` → full refund of reward to client | anyone (`cancelUnaccepted`) |
| **R1** | No `submitDelivery` by `tDl` | **NO** | anyone (`settleByTimeout`) |
| **R2** | Delivery submitted; validator posts `validationResponse(requestHash, response, …)` with `response ≥ 80`, observed before `tDv + D` | **YES** | anyone (`settleWithValidation`) |
| **R3** | Same as R2 but `response < 80` | **NO** | anyone (`settleWithValidation`) |
| **R4** | Validator silent at `tDv + D`; client calls `attest(taskId, approved)` within `(tDv + D, tDv + D + G]` | **YES** if `approved=true`, else **NO** | client only |
| **R5** | Validator silent AND client silent at `tDv + D + G` | **YES** (an unchallenged deliverable settles for the worker) | anyone (`settleByTimeout`) |

- **R6 (finality).** The first rule that fires wins; `outcome` is write-once. A validator response arriving after `tDv + D` MUST be ignored by `settleWithValidation` (revert `ValidationLate()`).
- **R7 (reading the registry).** `settleWithValidation` reads the ValidationRegistry's stored status for the exact `requestHash` recorded at delivery time (see §7.2) — it never trusts caller-supplied scores.

### 6.5 Settlement & payout math (exact)

Let `Y` = total YES pool (includes self-stake), `N` = total NO pool, `f = PROTOCOL_FEE_BPS / 10_000`, losing pool `L`, winning pool `W`, and a winner's position `w_i`.

- Fee: `fee = floor(L × f)`; `validatorFee = floor(fee × VALIDATOR_FEE_SHARE_BPS / 10_000)`; `treasuryFee = fee − validatorFee`. The validator fee is paid only if outcome came via R2/R3; otherwise the full fee goes to treasury.
- Distributable: `Ld = L − fee`.
- **`Payout(i) = w_i + floor(w_i × Ld / W)`** — pull-claimed via `claim(taskId)`. Integer-division dust (`Ld − Σ floor(...)`, at most `numWinners − 1` units) is swept to treasury at `sweepDust(taskId)` callable after all claims or after 30 days.
- **If YES:** worker additionally receives the full task `reward` (claimed in the same `claim` call). Client receives nothing back.
- **If NO:** client's `reward` is refunded in full (client calls `claim`). Worker's self-stake is part of `Y = L` and is therefore distributed to NO bettors — *the skeptics eat the worker's confidence bond.*
- **Edge E1** (`N = 0`, outcome YES): no losing capital; YES bettors reclaim exactly their stakes, `fee = 0`.
- **Edge E2** (`N = 0`, outcome NO): there are no NO winners. `fee = floor(Y × f)` is taken as usual; the remainder `Y − fee` is paid to the **client** as damages, in addition to the reward refund. (`Y` can never be 0 — the mandatory self-stake guarantees `Y ≥ MIN_SELF_STAKE_BPS × reward / 10_000`.)
- **Edge E3** (task `Cancelled`): all deposits refunded 1:1; no fees.

**Worked example (use these exact numbers in tests, §12/U-12).** Reward `R = 100e6`. Worker self-stakes `15e6` (15%). Bettor P adds YES `35e6` → `Y = 50e6`. Bettors Q,S bet NO `30e6 + 20e6` → `N = 50e6`. Implied probability at cutoff: `p = 0.50`.
*Outcome YES:* `L = N = 50e6`, `fee = 1e6` (validator `0.5e6`, treasury `0.5e6`), `Ld = 49e6`. Worker: `15e6 + floor(15e6·49/50) + 100e6 = 129.7e6`. P: `35e6 + 34.3e6 = 69.3e6`. Q, S: 0.
*Outcome NO:* `L = Y = 50e6`, `fee = 1e6`, `Ld = 49e6`. Q: `30e6 + 29.4e6 = 59.4e6`. S: `20e6 + 19.6e6 = 39.6e6`. Client: refund `100e6`. Worker: loses self-stake **and** earns nothing.

### 6.6 The ORACLE Trust Tuple (the data product, exact definitions)

Computed off-chain by the indexer over a worker agent's **settled** tasks `k = 1..n` on this deployment; served over x402 (§8.2).

| Field | Definition |
|---|---|
| `agentId`, `agentRegistry` | ERC-8004 identifiers (`eip155:43113:<IdentityRegistry>`) |
| `n` | Number of settled tasks as worker |
| `p_live` | For each currently-Open task: `yesPool/(yesPool+noPool)` at query time |
| `brier` | `(1/n) · Σ (p_k − o_k)²`, where `p_k` = implied probability at `betCutoff` of task k, `o_k ∈ {0,1}` its outcome. Lower = the market prices this agent well. 4-decimal fixed string. |
| `winRate` | `Σ o_k / n` |
| `ssr` | Mean self-stake ratio `selfStake_k / reward_k` (worker's average skin-in-the-game) |
| `forfeited` | Total USDC of self-stake lost to skeptics, lifetime |
| `rep8004` | Pass-through of `ReputationRegistry.getSummary(agentId, [OracleCore], tag1="oracle.outcome", tag2=0)` so consumers get the on-chain view in the same response |

The pitch line for judges: *backward-looking score (ERC-8004) + forward-looking price (`p_live`) + meta-trust (`brier`: "is the market itself well-calibrated about this agent?") in one paid API call.*

---

## 7. On-chain specification

### 7.1 Deployment context (Avalanche Fuji, chainId 43113)

| Contract | Address | Source |
|---|---|---|
| ERC-8004 **IdentityRegistry** | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Canonical testnet deployment, erc-8004/erc-8004-contracts README (verified on testnet.snowtrace.io) |
| ERC-8004 **ReputationRegistry** | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Same |
| ERC-8004 **ValidationRegistry** | **self-deployed** — pin into `deployments/fuji.json` at deploy time | No canonical Fuji address is published; the Validation section of the spec is marked "under active revision" upstream. Deploy `ValidationRegistryUpgradeable.sol` from the reference repo, unmodified. `[VERIFY-3]` re-check upstream for a canonical address on Day 1; prefer canonical if it exists. |
| **USDC (Fuji)** | `0x5425890298aed601595a70AB815c96711a31Bc65` `[VERIFY-1]` ✅ **VERIFIED Jun 12**: name "USD Coin", version "2", decimals 6 | Circle-issued test USDC, 6 decimals, EIP-3009 capable. |
| **OracleCore** | deployed Day 1–2 | This spec, §7.2 |
| RPC | `https://api.avax-test.network/ext/bc/C/rpc` ✅ verified live | Avalanche Builder Hub |
| Explorer | `https://testnet.snowtrace.io` | — |

✅ **VERIFIED Jun 12**: IdentityRegistry and ReputationRegistry addresses above have live bytecode on Fuji (ERC-1967 proxies).

ABI source of truth for all three registries is the `abis/` directory of `erc-8004/erc-8004-contracts` (vendored into the repo on Day 1, never hand-written). The interface fragments below name only the members OracleCore consumes; parameter order MUST be taken from the vendored ABIs.

### 7.2 `OracleCore.sol` — single contract, full external interface

Toolchain: Solidity `0.8.24`, Foundry, OpenZeppelin v5 (`SafeERC20`, `ReentrancyGuard`, `Ownable2Step`, `Pausable`). One contract ≈ 450 LoC. No proxies, no upgradeability.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IIdentityRegistry {            // ERC-721-based; vendored ABI is canonical
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

interface IValidationRegistry {
    function validationRequest(address validatorAddress, uint256 agentId,
        string calldata requestURI, bytes32 requestHash) external;
    // getValidationStatus(requestHash) — exact return tuple per vendored ABI:
    // expected to expose (validatorAddress, agentId, response, responded/timestamp …)
    function getValidationStatus(bytes32 requestHash) external view
        returns (address validator, uint256 agentId, uint8 response, uint256 respondedAt);
}

interface IReputationRegistry {
    // giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpointURI, feedbackURI, feedbackHash)
    // — exact order per vendored ABI; value is int128, valueDecimals uint8 (0–18).
    function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals,
        bytes32 tag1, bytes32 tag2, string calldata endpointURI,
        string calldata feedbackURI, bytes32 feedbackHash) external;
}

contract OracleCore is ReentrancyGuard, Ownable2Step, Pausable {

    enum TaskState { None, Created, Open, Executing, Delivered, Settled, Cancelled }
    enum Outcome   { Unresolved, Yes, No }
    enum Side      { Yes, No }

    struct Task {
        // --- set at createTask ---
        address client;
        uint64  workerAgentId;
        uint64  validatorAgentId;
        address validatorWallet;     // resolved from IdentityRegistry at creation
        uint128 reward;
        uint64  createdAt;
        uint64  deadline;            // absolute timestamp for delivery
        bytes32 specHash;            // keccak256 of task spec JSON
        string  specURI;             // https:// or ipfs:// of task spec JSON
        // --- set at acceptAndStake ---
        address workerWallet;
        uint128 selfStake;
        uint64  acceptedAt;
        uint64  betCutoff;
        // --- set at submitDelivery ---
        uint64  deliveredAt;
        bytes32 deliverableHash;
        bytes32 validationRequestHash; // keccak256(abi.encode(taskId, deliverableHash))
        // --- settlement ---
        TaskState state;
        Outcome   outcome;
        uint128   yesPool;           // includes selfStake
        uint128   noPool;
    }

    // taskId => Task
    mapping(uint256 => Task) public tasks;
    // taskId => bettor => side => amount
    mapping(uint256 => mapping(address => mapping(uint8 => uint128))) public positions;
    // taskId => bettor => claimed?
    mapping(uint256 => mapping(address => bool)) public claimed;
    uint256 public nextTaskId;           // starts at 1
    uint128 public treasuryAccrued;

    // ---------------- events ----------------
    event TaskCreated(uint256 indexed taskId, address indexed client, uint64 workerAgentId,
                      uint64 validatorAgentId, uint128 reward, uint64 deadline, string specURI);
    event TaskAccepted(uint256 indexed taskId, uint64 indexed workerAgentId,
                       address workerWallet, uint128 selfStake, uint64 betCutoff);
    event BetPlaced(uint256 indexed taskId, uint64 indexed agentId, address bettor,
                    Side side, uint128 amount, uint128 yesPool, uint128 noPool);
    event ExecutionStarted(uint256 indexed taskId);                       // emitted lazily at first post-cutoff touch
    event DeliverySubmitted(uint256 indexed taskId, bytes32 deliverableHash,
                            bytes32 validationRequestHash, string evidenceURI);
    event OutcomeResolved(uint256 indexed taskId, Outcome outcome, uint8 viaRule, uint8 validatorScore);
    event Claimed(uint256 indexed taskId, address indexed account, uint128 amount);
    event FeedbackPosted(uint256 indexed taskId, uint64 indexed workerAgentId, int128 value);
    event TaskCancelled(uint256 indexed taskId);

    // ---------------- errors ----------------
    error NotAgentController();      error WrongState();          error BetWindowClosed();
    error RoleBanned();              error BelowMinBet();         error PoolCapExceeded();
    error BelowMinSelfStake();       error DeadlinePassed();      error TooEarly();
    error ValidationLate();          error ValidationMissing();   error AlreadyClaimed();
    error NothingToClaim();          error BadParams();

    // ---------------- external functions (signatures are normative) ----------------
    function createTask(uint64 workerAgentId, uint64 validatorAgentId, uint128 reward,
        uint64 deadline, bytes32 specHash, string calldata specURI)
        external whenNotPaused returns (uint256 taskId);
        // pulls `reward` USDC from msg.sender; deadline > now + BETTING_WINDOW required;
        // worker/validator agentIds must exist and be distinct; client may be unregistered.

    function acceptAndStake(uint256 taskId, uint64 workerAgentId, uint128 stake)
        external whenNotPaused;
        // caller must control workerAgentId (matching createTask's value);
        // stake ≥ reward * MIN_SELF_STAKE_BPS / 10_000; pulls stake; yesPool += stake;
        // sets workerWallet = msg.sender, acceptedAt, betCutoff; state -> Open.

    function placeBet(uint256 taskId, uint64 agentId, Side side, uint128 amount)
        external whenNotPaused;
        // enforces §6.3 B1–B3 exactly; pulls USDC; updates pool + position; state stays Open.

    function submitDelivery(uint256 taskId, bytes32 deliverableHash, string calldata evidenceURI)
        external whenNotPaused;
        // worker only; now in (betCutoff, deadline]; computes validationRequestHash;
        // CALLS ValidationRegistry.validationRequest(validatorWallet, workerAgentId,
        //        evidenceURI, validationRequestHash);   // see note V1 below
        // state -> Delivered.

    function settleWithValidation(uint256 taskId) external nonReentrant;
        // anyone; reads getValidationStatus(validationRequestHash); requires respondedAt != 0
        // and respondedAt <= deliveredAt + DISPUTE_WINDOW (else ValidationLate / ValidationMissing);
        // outcome = response >= VALIDATION_THRESHOLD ? Yes : No; rule = R2/R3; _finalize().

    function attest(uint256 taskId, bool approved) external nonReentrant;
        // client only; only in (deliveredAt + D, deliveredAt + D + G]; only if validator silent;
        // outcome = approved ? Yes : No; rule = R4; _finalize().

    function settleByTimeout(uint256 taskId) external nonReentrant;
        // anyone; implements R1 (no delivery past deadline -> No)
        // and R5 (delivered, validator and client both silent past D+G -> Yes); _finalize().

    function cancelUnaccepted(uint256 taskId) external nonReentrant;  // R0

    function claim(uint256 taskId) external nonReentrant;
        // pull-payment per §6.5; worker's reward and self-stake winnings paid in same call;
        // client refund path on No; idempotent via `claimed`.

    function sweepDust(uint256 taskId) external;       // §6.5; owner or 30-day public
    function withdrawTreasury(address to) external onlyOwner;
    function pause() external onlyOwner;               // demo safety brake
    function unpause() external onlyOwner;

    // ---------------- views for the indexer/UI ----------------
    function impliedProbabilityBps(uint256 taskId) external view returns (uint16);
    function previewPayout(uint256 taskId, address account) external view returns (uint128);
}
```

**Note V1 (registry caller semantics).** Upstream `validationRequest` MUST be called by the owner/operator of `agentId`. Two compliant options: **(a)** the worker's `submitDelivery` transaction is sent from the worker wallet and OracleCore performs the registry call *via* the worker having pre-approved OracleCore as ERC-721 operator (`setApprovalForAll(OracleCore, true)` at registration — Day 1 script); **(b)** if operator-approval semantics differ in the vendored ABI, the worker agent makes the `validationRequest` call itself in the same script step, and `submitDelivery` only records `validationRequestHash`. Decide (a) vs (b) after the Day-1 ABI check; both preserve every other rule in this document. This is the only intentionally two-path item in the spec.

**DECIDED (DR-6, Jun 12): path (b).** The worker agent calls `validationRequest` on the ValidationRegistry itself, immediately after `submitDelivery`. `submitDelivery` only records `validationRequestHash = keccak256(abi.encode(taskId, deliverableHash))`. `settleWithValidation` MUST additionally verify that the status returned by `getValidationStatus(requestHash)` has `validator == task.validatorWallet` and `agentId == task.workerAgentId` — this prevents a worker from satisfying settlement via a validation request directed at a different (friendlier) validator.

**`_finalize(taskId, outcome, rule, score)` (internal, single implementation):** sets state/outcome, computes & escrows `validatorFee`/`treasuryAccrued`, emits `OutcomeResolved`, then posts reputation:
`giveFeedback(workerAgentId, value = outcome==Yes ? 100 : 0, valueDecimals = 0, tag1 = "oracle.outcome", tag2 = bytes32(taskId), endpointURI = "", feedbackURI = <indexer URL for task JSON>, feedbackHash = keccak256(task JSON))`.
OracleCore is *not* the agent's owner/operator, so the registry's self-feedback ban does not block this. Consumers aggregate with `getSummary(agentId, [address(OracleCore)], "oracle.outcome", 0)` — ORACLE becomes a single, filterable feedback authority. The `giveFeedback` call is wrapped in `try/catch`: a registry revert MUST NOT block settlement (funds > feedback).

### 7.3 State × function matrix (any cell not listed ⇒ revert `WrongState`)

| From \ Call | createTask | acceptAndStake | placeBet | submitDelivery | settleWithValidation | attest | settleByTimeout | cancelUnaccepted | claim |
|---|---|---|---|---|---|---|---|---|---|
| **None** | →Created | — | — | — | — | — | — | — | — |
| **Created** | — | →Open | — | — | — | — | — | →Cancelled (R0) | — |
| **Open** (t<cutoff) | — | — | ✔ stays Open | — | — | — | — | — | — |
| **Open** (t≥cutoff) | — | — | — | →Delivered (≤ deadline) | — | — | →Settled NO (R1, past deadline) | — | — |
| **Delivered** | — | — | — | — | →Settled (R2/R3) | →Settled (R4) | →Settled (R5) | — | — |
| **Settled** | — | — | — | — | — | — | — | — | ✔ |
| **Cancelled** | — | — | — | — | — | — | — | — | ✔ (refunds) |

(`Executing` is a UI label for `Open` after `betCutoff`; on-chain it is the same stored state with a timestamp guard — one fewer transition to test.)

### 7.4 Security requirements (normative checklist)

- **S1.** All token movement via `SafeERC20`; all user-facing settlement entry points `nonReentrant`; strict checks-effects-interactions; payouts are **pull-only** (`claim`).
- **S2.** No external call (registries, USDC) between state mutation and event emission inside `_finalize` except the terminal `try/catch giveFeedback`.
- **S3.** `outcome` is write-once (guarded by `state != Settled` plus explicit check); rules R0–R7 are the only writers.
- **S4.** All arithmetic in `uint128/uint256`; products like `w_i × Ld` computed in `uint256` before division; Solidity 0.8 checked math everywhere; no `unchecked` blocks in v1.
- **S5.** USDC has 6 decimals — every constant in §6.2 is already denominated accordingly; the UI layer MUST NOT re-scale.
- **S6.** `Pausable` gates only *inflow* functions (`createTask`, `acceptAndStake`, `placeBet`, `submitDelivery`); settlement and `claim` MUST remain callable while paused (users can always exit).
- **S7.** Foundry invariant test (§12/I-1): for every task in every state, `usdc.balanceOf(core) ≥ Σ unclaimed entitlements + treasuryAccrued`.
- **S8.** No oracle price feeds, no delegatecall, no assembly, no upgradeability — keep the audit story one sentence long.

---

## 8. Off-chain specification

Monorepo layout:

```
oracle/
├── contracts/            # Foundry: OracleCore.sol, vendored ERC-8004 ABIs, tests
├── server/               # Node 20 + TypeScript + Express + viem + better-sqlite3
│   ├── indexer.ts        # event stream -> SQLite (source of truth for UI & Trust Tuple)
│   ├── api.ts            # public + x402-gated routes
│   └── x402.ts           # payment middleware config
├── agents/               # TypeScript daemons, one process each (pm2)
│   ├── worker.ts         # the agent being bet on
│   ├── validator.ts      # deterministic test harness + on-chain responder
│   ├── bettor-rep.ts  bettor-skeptic.ts  bettor-mirror.ts
│   └── vendor.ts         # x402-gated "task inputs" endpoint the worker buys from
├── web/                  # Vite + React ticker dashboard (read-only, polls server WS)
└── deployments/fuji.json # every address + ABI hash pinned here, single config source
```

### 8.1 Indexer

Subscribes (viem `watchContractEvent`, plus catch-up `getLogs` from deploy block) to all OracleCore events and the ValidationRegistry's response event. Tables: `tasks`, `bets`, `outcomes`, `odds_snapshots` (one row per `BetPlaced`, storing `p` in bps — the ticker series), `trust_tuples` (recomputed on every `OutcomeResolved` per §6.6). Pushes deltas to the dashboard over WebSocket. The indexer **never** holds keys.

### 8.2 HTTP API (`oracle-server`, port 8402)

| Route | Method | Auth | Price (USDC) | Returns |
|---|---|---|---|---|
| `/healthz` | GET | none | free | `{ok, block}` |
| `/v1/tasks` , `/v1/tasks/:id` | GET | none | free | task metadata + state (free: it markets the paid endpoints) |
| `/v1/markets/:taskId/odds` | GET | **x402** | **0.001** | `{taskId, p_bps, yesPool, noPool, betCutoff, series:[{t,p_bps}]}` |
| `/v1/agents/:agentId/trust` | GET | **x402** | **0.005** | ORACLE Trust Tuple (§6.6) |
| `/v1/agents/:agentId/trust/stream` | GET | **x402** | **0.02** | 60 s of WS pushes (stretch goal) |

x402-gated routes use `x402-express` `paymentMiddleware` with:

```ts
// server/x402.ts  — values are normative
export const X402_NETWORK = "avalanche-fuji";          // chainId 43113
export const PAY_TO       = process.env.ORACLE_REVENUE_WALLET!;
export const FACILITATOR  = process.env.X402_FACILITATOR
        ?? "https://facilitator.payai.network";        // primary [VERIFY-2]
// Fallback order if the Day-1 smoke test fails on Fuji:
// 1) UltravioletaDAO facilitator   2) thirdweb facilitator (serverWallet mode)
// 3) self-hosted x402-rs with RPC_URL_AVALANCHE_FUJI  — one of the four WILL work;
//    all are documented Avalanche-supporting facilitators.
// 4) LOCAL DEV: self-hosted mini-facilitator (server/facilitator-local.ts) against anvil.
```

A compliant `402` challenge for the trust endpoint (exact shape served):

```json
{
  "x402Version": 1,
  "error": "Payment required",
  "accepts": [{
    "scheme": "exact",
    "network": "avalanche-fuji",
    "maxAmountRequired": "5000",
    "resource": "/v1/agents/12/trust",
    "description": "ORACLE Trust Tuple for agent 12",
    "mimeType": "application/json",
    "payTo": "<ORACLE_REVENUE_WALLET>",
    "asset": "0x5425890298aed601595a70AB815c96711a31Bc65",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "USD Coin", "version": "2" }
  }]
}
```

`extra.name/version` MUST match Fuji USDC's EIP-712 domain — ✅ verified Jun 12: `name()="USD Coin"`, `version()="2"`. Client side, agents use `x402-fetch`'s `wrapFetchWithPayment(fetch, account)` — the wrapper handles the 402 → sign EIP-3009 `transferWithAuthorization` → retry with `X-PAYMENT` → facilitator `/verify` + `/settle` loop; settlement lands on Fuji in ~1 s.

### 8.3 Agent fleet (deterministic specs)

Common: each agent owns one EOA, registered Day 2 in the IdentityRegistry (`register(agentURI)`), `agentURI` → a registration JSON (name, description, `registrations:[{agentRegistry:"eip155:43113:0x8004A818…BD9e", agentId}]`, `supportedTrust:["reputation"]`) hosted at `oracle-server//.well-known/agents/<n>.json`. Each agent pre-approves USDC to OracleCore once at boot.

**`worker.ts`** — loop: `TaskCreated(worker=me)` → fetch `specURI` → decide stake: `stake = reward × clamp(selfConfidence, 0.10, 0.50)` where `selfConfidence` is the model's own stated probability (one LLM call; demo Task A is tuned to yield ~0.45, Task B ~0.12 so the *stake size itself* tells the audience a story) → `acceptAndStake` → wait for `betCutoff` → execute task: buy one input from `vendor.ts` **over x402** ($0.01, this is theme pillar "agents pay"), produce deliverable, upload to `server/artifacts/<hash>.zip` → pay validator's x402 intake fee ($0.01, pillar "agent pays agent") → `submitDelivery(deliverableHash, evidenceURI)` → call `ValidationRegistry.validationRequest(validatorWallet, myAgentId, evidenceURI, requestHash)` (DR-6 path b).

**`validator.ts`** — serves x402-gated `POST /v1/validate-intake` (records intent); on `DeliverySubmitted` for tasks where I am validator: download artifact, run **deterministic harness**: `npx vitest run --dir hidden-tests/<taskTemplate>` in a sandboxed temp dir, `score = round(100 × passed / total)` → call `validationResponse(requestHash, score, responseURI, keccak256(report), tag="oracle")` from the validator wallet → done. No LLM in the verdict path: determinism is what makes R2/R3 unambiguous.

**Bettors** (each polls free `/v1/tasks`, pays x402 for `/odds` and `/trust` before betting — they are also *customers* of the trust feed, closing the economic loop on stage):
- `bettor-rep.ts`: reads Trust Tuple; bet YES `min(20e6, 40e6·winRate)` if `n≥1 && winRate ≥ 0.6`; bet NO `15e6` if `n≥1 && winRate < 0.4`; abstain on cold-start unless `ssr ≥ 0.25` (respects the costly signal).
- `bettor-skeptic.ts`: bets NO `20e6` whenever `selfStake/reward < 0.15` or `n == 0`; the designated villain the audience roots against.
- `bettor-mirror.ts`: waits 60 s, then follows money: bet `10e6` on the side with the larger pool iff `|p − 0.5| > 0.10`. Exists to make the ticker visibly *move twice*.

### 8.4 Demo task design (binary, machine-checkable, audience-legible)

Task template = "implement function to hidden spec": `specURI` JSON contains a public function signature + 3 example cases; the validator holds **10 hidden vitest cases**; `VALIDATION_THRESHOLD = 80` ⇒ pass ⇒ YES.
- **Task A (success path):** `slugify(title: string)` with documented unicode rules — worker's LLM reliably passes 10/10.
- **Task B (failure path):** `nextBusinessDay(date, region:"IN")` whose hidden tests include two 2026 Indian regional holidays deliberately absent from the public spec — worker scores 40–60 ⇒ **NO** ⇒ the audience watches the self-stake flow to the skeptic. Calibrated villainy, reproducible every run.

---

## 9. End-to-end sequence (one task, all rails)

```
Client          OracleCore         Worker            Vendor/Validator      Bettors        Registries
  │ createTask(R=100)│                 │                     │                │               │
  │  USDC 100 ─────▶│ Created          │                     │                │               │
  │                  │ acceptAndStake(15) ◀─ USDC 15 ────────│                │               │
  │                  │ Open, cutoff=t+180                    │                │               │
  │                  │◀────────────────────────────── placeBet×N (x402-paid odds reads) ──────│
  │                  │ … cutoff …      │                     │                │               │
  │                  │                 │── x402 $0.01 ──▶ vendor (input)      │               │
  │                  │                 │── x402 $0.01 ──▶ validator intake    │               │
  │                  │ submitDelivery ◀┤                     │                │               │
  │                  │ (worker) ── validationRequest ──────────────────────────────────▶ ValidationReg
  │                  │                 │     harness: 10/10  │                │               │
  │                  │                 │                     │── validationResponse(100) ─▶ ValidationReg
  │                  │ settleWithValidation (anyone) — reads status — outcome YES (R2)        │
  │                  │── giveFeedback(100,"oracle.outcome") ────────────────────────────▶ ReputationReg
  │   claim() ◀──────│──▶ payouts: worker 129.7, YES bettors pro-rata; fees split            │
```

---

## 10. Threat model (honest, presented as-is to judges)

| # | Threat | Mitigation in v1 | Residual risk (stated openly) |
|---|---|---|---|
| T1 | **Late free-riding** — betting after the outcome is knowable | Hard `betCutoff` before execution (DR-2) | None for pool math; spectators lose mid-execution price action (v2: LMSR) |
| T2 | **Worker hedges via sybil** — second agent bets NO to neutralize self-stake | Identity-gated betting (registration cost + traceability); deliberate-failure is strictly unprofitable (fails ⇒ forfeits reward R **and** pays 2% fee on the round-trip); dashboard publicly lists every NO bettor's agentId + history | Hedging (not profit) remains possible → self-stake is a *lower bound* signal, not perfect. Say this on stage before a judge asks. |
| T3 | **Reputation farming** — inflate winRate with trivial self-created tasks | Trust Tuple exposes `n`, mean reward size, and counterparty diversity; `MIN_REWARD`; consumers see raw data, not one collapsed score | Determined farmer still pays real fees per task — farming has a price, which is itself the point |
| T4 | **Client griefing** — client rejects honest work via R4 | R4 only fires if the validator was silent; client is banned from betting so rejection earns nothing; rejection event is public and tagged to the client address | Spite rejection possible but unprofitable |
| T5 | **Stalling** — validator and/or client never act | Timeout ladder R1/R4/R5 settles every task with zero cooperation | — |
| T6 | **Validator corruption/bribery** | Validator fixed pre-betting (bettors price it); banned from betting (on-chain); verdict is a deterministic public test run, `responseURI` publishes the full report — a false verdict is *provably* false; validator's own agentId accrues ERC-8004 feedback | v1 = 1 validator: a fully malicious one can mis-settle one task before being publicly burned. v2: quorum + bonding (§14) |
| T7 | **Contract drain** | §7.4 S1–S8; pull payments; invariant test I-1; pausable inflows | Unaudited hackathon code — testnet only, stated in README |
| T8 | **x402 replay/underpay** | Facilitator verifies EIP-3009 sig, nonce, amount; server checks `X-PAYMENT-RESPONSE` before serving | Standard x402 trust in facilitator |

---

## 11. Build plan — June 12 → 17 (5 days)

| Day | Deliverable (end-of-day demo) |
|---|---|
| **D1 — Jun 12** | "Hello market": VERIFY items resolved; OracleCore happy path + tests U-1..U-6 green |
| **D2 — Jun 13** | Full settlement matrix: R0–R7, payout math + edges, claim, fees, dust; U-7..U-16 + I-1 green; Fuji deploy; agents registered |
| **D3 — Jun 14** | Money over HTTP: indexer + x402-gated routes live; validator harness end-to-end |
| **D4 — Jun 15** | The fleet runs itself: full Task A loop with zero manual transactions |
| **D5 — Jun 16** | Stage-ready: dashboard, Task B rehearsed, backup capture, submission |

**MoSCoW cut line.** *Must:* D1–D4 + basic dashboard. *Should:* settle animation, bettor avatars, Trust-Tuple stream endpoint. *Could:* audience-betting page via faucet wallets. *Won't (v1):* N1–N6.

## 12. Test plan (Foundry)

U-1 createTask escrows reward & emits • U-2 R0 cancel/refund • U-3 acceptAndStake enforces min-stake & atomic pull • U-4 bet eligibility: unregistered caller reverts `NotAgentController` • U-5 role bans: client / validator / worker-NO each revert `RoleBanned` • U-6 R1 timeout ⇒ NO • U-7 cutoff enforcement (`BetWindowClosed`) • U-8 delivery window guards (`TooEarly`/`DeadlinePassed`) • U-9 R2 YES at score 80 (boundary) • U-10 R3 NO at 79 • U-11 R6 late validation ignored (`ValidationLate`) • U-12 **payout matrix equals §6.5 worked example to the unit** • U-13 E1/E2 edges • U-14 double-claim reverts; previewPayout==claim • U-15 R4 both branches incl. window guards • U-16 R5 default-YES • U-17 pause gates inflows only • U-18 feedback try/catch (mock registry revert ⇒ settlement still finalizes) • I-1 solvency invariant under fuzzed action sequences (depth 50).

## 13. Stage script — June 27/28 (7 minutes)

1. **0:00** Problem in one line: "ERC-8004 tells you an agent's *past*. Nobody prices its *future*. We do — and the agent has to bet on itself."
2. **0:45** Create Task A live. Worker's `acceptAndStake` lands; **self-stake badge lights up: "Worker staked $15 on itself."**
3. **1:30** Bettors wake: ticker swings as RepBot buys YES, Skeptic slams NO. "That number is a live price of trust. And the bots *paid us over x402* to read it."
4. **3:00** Cutoff. Worker executes — split-screen its x402 purchases. Validator posts `10/10 → 100` on-chain; `settleWithValidation` fires; **payout animation**; snowtrace tab shows the `giveFeedback` tx.
5. **4:30** Task B (the trap). Stake badge visibly smaller. Skeptic piles NO. Harness: 5/10 → **NO**. The self-stake drains to the skeptic on screen.
6. **6:00** Trust Tuple reveal: n=2, winRate 0.5, Brier, forfeited $. Close: roadmap slide (§14), repo QR.

Backup plan: if Fuji/RPC misbehaves, play the D5 screen-capture and keep the live dashboard on a local anvil fork (same code, `deployments/local.json`).

## 14. Future work

LMSR continuous market (DR-1 reversal) • validator quorum with bonded stake slashable via the ValidationRegistry • **cross-L1 trust export over Avalanche ICM** • Trust-Tuple oracle as an on-chain feed for ERC-8183-style reputation gates • mainnet with eERC-shielded bet amounts.

## 15. Decision log

| ID | Decision | Section |
|---|---|---|
| DR-1 | Parimutuel over LMSR/CPMM | 6.1 |
| DR-2 | Hard bet cutoff pre-execution | 6.1 |
| DR-3 | Mandatory YES-only self-stake ≥ 10% | 6.1 |
| DR-4 | No x402 bet relay; bets on-chain only | 6.1 |
| DR-5 | Single pre-assigned validator + timeout ladder | 6.1 |
| DR-6 | **DECIDED Jun 12: path (b)** — worker calls `validationRequest` directly; `settleWithValidation` verifies validator address + agentId in the returned status | 7.2 note V1 |
| DR-7 | **Jun 12:** Local dev uses MockUSDC (EIP-3009-capable) + minimal local ERC-8004 registries + self-hosted mini-facilitator on anvil; Fuji uses canonical contracts. Same code paths, different `deployments/*.json` | 8.2 |
| DR-8 | **Jun 13:** Validator fee share accrues to a per-wallet `validatorAccrued` mapping, withdrawn via `withdrawValidatorFees()` (the §6.5 `claim` is per-bettor only). | 7.2 |
| DR-9 | **Jun 13:** Agent brains are **real LLM agents built on Mastra**, model **Gemini 2.5 Flash** (`@ai-sdk/google`). The worker genuinely assesses its own confidence and **writes the solution code**; the three bettors reason over odds/trust to decide bets. The *hands* (on-chain txs, x402 payments) stay deterministic in the daemons with hard money guardrails (`toDecision` clamps to ≤25 USDC, ≥MIN_BET). The **validator stays deterministic vitest** — the judge of success must be objective, never an LLM. When no `GEMINI_API_KEY` is set, every agent falls back to the deterministic strategy/solver so tests + e2e stay fast and offline. Reverses the v1 "no LLM in the loop" note in §8.3. | 8.3 |

## 16. References

- ERC-8004 reference contracts, spec & deployments: `github.com/erc-8004/erc-8004-contracts` · `eips.ethereum.org/EIPS/eip-8004` · `8004.org`
- x402 on Avalanche: Avalanche Builder Hub Academy "x402 Payment Infrastructure"; `build.avax.network/integrations/thirdweb-x402`, `…/ultravioletadao`, `…/x402-rs`; `x402.org` + `docs.cdp.coinbase.com/x402`
- Facilitators with documented Fuji support: PayAI (`facilitator.payai.network`), UltravioletaDAO, thirdweb, self-hosted `x402-rs`
- Event: Team1 India Speedrun #1 — `india.team1.network/speedrun`
