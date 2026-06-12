# ORACLE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete ORACLE outcome-market protocol per `docs/DESIGN.md` (frozen v1.0): OracleCore contract + tests, indexer/API server with x402-gated routes, autonomous 6-agent fleet, and live ticker dashboard — fully runnable end-to-end on a local anvil chain, deploy-ready for Avalanche Fuji.

**Architecture:** pnpm monorepo with 5 packages. `contracts/` (Foundry) is the source of truth for on-chain logic; `shared/` pins the ABI, config loader, and x402 wire protocol so server/agents/web can be built in parallel; `server/` indexes events into SQLite and sells data over x402; `agents/` are independent TS daemons; `web/` is a read-only WebSocket dashboard. Local dev substitutes MockUSDC (EIP-3009), minimal local ERC-8004 registries, and a self-hosted mini-facilitator — identical code paths, different `deployments/*.json`.

**Tech Stack:** Solidity 0.8.24 + Foundry + OpenZeppelin v5 · Node 22 + TypeScript + tsx · viem 2.x · Express 4 · better-sqlite3 · ws · vitest · React 18 + Vite 5 + recharts.

**Authority order on any conflict:** `docs/DESIGN.md` (normative) > this plan > your judgment. DESIGN.md §-references below are normative requirements, not suggestions.

---

## 0. Verified facts & frozen decisions (do not re-litigate)

- Fuji RPC `https://api.avax-test.network/ext/bc/C/rpc` live, chainId 43113. ✅
- Fuji USDC `0x5425890298aed601595a70AB815c96711a31Bc65`: name `USD Coin`, version `2`, decimals 6. ✅
- ERC-8004 IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e` and ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713` have live code on Fuji. ✅
- **DR-6 = path (b):** worker calls `ValidationRegistry.validationRequest` itself after `submitDelivery`; `settleWithValidation` verifies returned `validator == task.validatorWallet && agentId == task.workerAgentId`.
- **DR-7:** local stack = MockUSDC + local minimal Identity/Reputation/Validation registries + mini-facilitator on anvil. Fuji stack = canonical USDC/Identity/Reputation + self-deployed ValidationRegistry + external facilitator.
- **No LLM dependency in the demo loop.** Worker confidence + solvers are deterministic (overridable via `ANTHROPIC_API_KEY` later; out of scope here).
- **Git rule for parallel agents: do NOT run any `git` command.** The orchestrator commits per workstream. Never create files outside your assigned directories.

## 1. Repo layout (final)

```
oracle/
├── docs/DESIGN.md                      # frozen spec (read it first, fully)
├── docs/superpowers/plans/…            # this plan
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  .gitignore
├── deployments/local.json  fuji.json   # single config source (schema §2.3)
├── contracts/                          # WS-A (Foundry)
│   ├── foundry.toml
│   ├── src/OracleCore.sol
│   ├── src/registries/ValidationRegistry.sol      # minimal, per DESIGN §7.2 interface
│   ├── src/mocks/MockUSDC.sol                     # EIP-3009
│   ├── src/mocks/MockIdentityRegistry.sol
│   ├── src/mocks/MockReputationRegistry.sol
│   ├── script/Deploy.s.sol                        # local + fuji profiles, writes deployments json
│   └── test/{OracleCore.t.sol, OracleCoreSettlement.t.sol, OracleCoreClaims.t.sol, Invariant.t.sol, helpers/Fixtures.sol}
├── shared/                             # phase-0 (orchestrator) + x402-lite (WS-B)
│   ├── package.json  tsconfig.json
│   └── src/{abi.ts, config.ts, x402-types.ts, x402-lite.ts}
├── server/                             # WS-B
│   ├── package.json  tsconfig.json
│   ├── src/{index.ts, indexer.ts, db.ts, api.ts, trust.ts, ws.ts, x402.ts, facilitator-local.ts}
│   ├── static/specs/{task-a-slugify.json, task-b-nextbusinessday.json}
│   ├── static/well-known/agents/      # registration JSONs (WS-C provides content contract §5.6)
│   ├── artifacts/                     # worker uploads land here
│   └── test/{trust.test.ts, x402-lite.test.ts, api.test.ts}
├── agents/                             # WS-C
│   ├── package.json  tsconfig.json
│   ├── src/{worker.ts, validator.ts, bettor-rep.ts, bettor-skeptic.ts, bettor-mirror.ts, vendor.ts}
│   ├── src/lib/{chain.ts, confidence.ts, solvers/slugify.ts, solvers/next-business-day.ts}
│   ├── hidden-tests/task-a-slugify/hidden.test.ts
│   ├── hidden-tests/task-b-nextbusinessday/hidden.test.ts
│   └── test/{confidence.test.ts, solvers.test.ts, strategies.test.ts}
├── web/                                # WS-D
│   ├── package.json  vite.config.ts  index.html
│   └── src/{main.tsx, App.tsx, ws.ts, components/{TaskCard.tsx, OddsTicker.tsx, PoolsBar.tsx, StakeBadge.tsx, SettleBanner.tsx, AgentAvatar.tsx}}
└── scripts/                            # WS-C (demo.ts, register-agents.ts) + phase-3 (orchestrator)
    ├── demo.ts  register-agents.ts  run-all.sh  e2e-local.sh
```

## 2. Phase 0 — shared interface contracts (orchestrator, before dispatch)

These files are written before agents start and are **binding interfaces**. Agents MUST NOT change their exported shapes; report mismatches instead.

### 2.1 `shared/src/abi.ts` — canonical ABIs (human-readable, viem `parseAbi`)

OracleCore ABI = exactly the events/functions/errors of DESIGN §7.2 (already written in Phase 0; WS-A's forge artifact must match — integration runs a selector diff).

### 2.2 `shared/src/config.ts`

```ts
export type Deployment = {
  chainId: number; rpcUrl: string; deployBlock: number;
  contracts: { oracleCore: Address; usdc: Address; identityRegistry: Address;
               reputationRegistry: Address; validationRegistry: Address };
  usdcDomain: { name: string; version: string };
  params: { minSelfStakeBps: number; protocolFeeBps: number; validatorFeeShareBps: number;
            bettingWindow: number; acceptWindow: number; disputeWindow: number;
            graceWindow: number; validationThreshold: number; minBet: string;
            maxPoolPerSide: string; minReward: string };
  agents: Record<string, { address: Address; agentId: number }>; // worker, validator, bettorRep, bettorSkeptic, bettorMirror, vendor
};
export function loadDeployment(): Deployment  // reads $ORACLE_DEPLOYMENT (path) or ../deployments/local.json
export const PORTS = { server: 8402, vendor: 8403, validatorIntake: 8404, facilitatorLocal: 8405 } as const;
export const PRICES = { odds: 1000n, trust: 5000n, trustStream: 20000n, vendorInput: 10000n, validatorIntake: 10000n } as const; // USDC units
```

### 2.3 `deployments/local.json` schema = serialized `Deployment`. Anvil account assignment (mnemonic `test test … junk`):
index 0 deployer/owner, 1 client, 2 worker, 3 validator, 4 bettor-rep, 5 bettor-skeptic, 6 bettor-mirror, 7 vendor, 8 ORACLE_REVENUE_WALLET, 9 facilitator relayer.

### 2.4 x402 wire protocol (`shared/src/x402-types.ts`) — frozen; both WS-B (middleware) and WS-C (client) build against it

- 402 challenge body: exactly DESIGN §8.2 JSON shape.
- `X-PAYMENT` request header: `base64(JSON.stringify({ x402Version: 1, scheme: "exact", network, payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce } } }))`.
- EIP-712: domain `{name, version, chainId, verifyingContract: usdc}`; type `TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)`.
- Facilitator REST: `POST /verify` and `POST /settle`, body `{ paymentPayload, paymentRequirements }` → `/verify: { isValid, invalidReason? }`, `/settle: { success, txHash?, errorReason? }`.
- Success response header `X-PAYMENT-RESPONSE`: `base64(JSON.stringify({ success: true, txHash, networkId }))`.
- `shared/src/x402-lite.ts` (implemented by WS-B) exports:
  ```ts
  export function x402Middleware(o: { payTo: Address; priceUnits: bigint; asset: Address;
    network: string; facilitatorUrl: string; description: string; usdcDomain: {name: string; version: string} }): RequestHandler
  export function wrapFetchWithPayment(f: typeof fetch, o: { privateKey: Hex; chainId: number;
    usdc: Address; usdcDomain: {name: string; version: string} }): typeof fetch
  ```
  Swap-in of official `x402-express`/`x402-fetch` is a Fuji-phase option, not v1-local scope.

### 2.5 WebSocket protocol (server → web), frozen

```ts
{ type: "snapshot", tasks: TaskRow[] }                          // on connect
{ type: "task", task: TaskRow }                                 // any task state change
{ type: "bet", taskId, bet: BetRow, pBps: number }              // per BetPlaced
{ type: "settled", taskId, outcome: "Yes"|"No", viaRule, validatorScore, payouts?: never }
```
`TaskRow`/`BetRow` mirror the DB schema in §4.2 (camelCase keys).

---

## 3. WS-A — Contracts (parallel agent A)

**Files:** everything under `contracts/`. Read DESIGN §5–§7 + §12 in full first. TDD throughout: write each test group, see it fail, implement, see it pass.

### Task A1: Foundry scaffold + mocks
- [ ] `forge init --no-git` layout inside `contracts/`; `foundry.toml`: solc 0.8.24, optimizer 200 runs, `fs_permissions = [{ access = "read-write", path = "../deployments" }]`.
- [ ] `forge install OpenZeppelin/openzeppelin-contracts --no-git` (v5.x), remapping `@openzeppelin/`.
- [ ] `MockUSDC.sol`: ERC20("USD Coin","USDC"), 6 decimals, EIP-712 domain name "USD Coin" version "2", public `mint`, and EIP-3009 `transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)` + bytes-signature overload + `authorizationState(address,bytes32)`. Reject reused nonce, expired/not-yet-valid windows, bad sig.
- [ ] `MockIdentityRegistry.sol`: ERC-721; `register(string agentURI) returns (uint256 agentId)` (auto-increment from 1, mints to caller, stores URI); `getAgentWallet(uint256) returns (address)` (defaults to `ownerOf`, settable via `setAgentWallet` by owner of the token); `agentExists(uint256) view`.
- [ ] `MockReputationRegistry.sol`: `giveFeedback(...)` per DESIGN §7.2 interface — stores rows + emits `NewFeedback(agentId, msg.sender, value, tag1, tag2)`; `getSummary(uint256 agentId, address[] clients, bytes32 tag1, bytes32 tag2) returns (uint64 count, int128 sum)` naive loop; plus `MockRevertingReputation` (always reverts) for U-18.
- [ ] `registries/ValidationRegistry.sol` (real contract, deployed on BOTH local and Fuji): struct `Status{address validator; uint256 agentId; uint8 response; uint256 respondedAt;}` + `requestURI/responseURI` storage; `validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)` (reverts if hash already used); `validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 reportHash, string tag)` — `msg.sender` MUST equal the stored `validator`, response ≤ 100, single response only, sets `respondedAt = block.timestamp`; `getValidationStatus(bytes32) returns (address,uint256,uint8,uint256)`; events `ValidationRequested(address indexed validator, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)` / `ValidationResponded(bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 reportHash, string tag)`.
- [ ] `forge build` clean. (No git commands — orchestrator commits.)

### Task A2: OracleCore — happy path (tests U-1..U-6 first, then implement)
- [ ] Implement DESIGN §7.2 exactly: storage, events, errors, constructor `(usdc, identityRegistry, reputationRegistry, validationRegistry, owner, Params struct of §6.2 values)` — all params immutable.
- [ ] `_isAgentController(agentId, addr)` = `ownerOf == addr || getAgentWallet == addr` (DESIGN §4).
- [ ] `createTask` / `cancelUnaccepted` (R0) / `acceptAndStake` / `placeBet` (B1–B5; bans by address AND agentId) / `settleByTimeout` R1 branch.
- [ ] Tests U-1..U-6 per DESIGN §12, in `OracleCore.t.sol` with `helpers/Fixtures.sol` (deploys mocks, registers agents 1=worker,2=validator,3..5=bettors, funds & approves USDC).

### Task A3: delivery + full resolution ladder (U-7..U-11, U-15, U-16)
- [ ] `submitDelivery` (worker wallet only, `(betCutoff, deadline]`, records `validationRequestHash = keccak256(abi.encode(taskId, deliverableHash))`; does NOT call the registry — DR-6 path b; emits `ExecutionStarted` then `DeliverySubmitted`).
- [ ] `settleWithValidation` (R2/R3 + R6 `ValidationLate` + R7 + DR-6 validator/agentId match check), `attest` (R4 window math exact: `(tDv+D, tDv+D+G]`), `settleByTimeout` R5 branch.
- [ ] `_finalize(taskId, outcome, rule, score)` per DESIGN §7.2 incl. try/catch `giveFeedback` (U-18 uses `MockRevertingReputation`).

### Task A4: money out (U-12..U-14, U-17)
- [ ] `claim` implementing §6.5 exactly (worker reward+winnings one call; client refund on NO; E1/E2/E3 edges), `previewPayout`, `impliedProbabilityBps`, `sweepDust`, `withdrawTreasury`, `pause`/`unpause` gating only inflows (S6).
- [ ] **U-12 asserts the §6.5 worked example to the unit** (both YES and NO branches: 129.7e6 / 69.3e6 / 59.4e6 / 39.6e6 / fee splits 0.5e6+0.5e6).
- [ ] U-13, U-14, U-17 per §12.

### Task A5: invariant + deploy script
- [ ] `Invariant.t.sol` (I-1): handler-based invariant — random create/accept/bet/deliver/settle/claim sequences, invariant `usdc.balanceOf(core) >= Σ unclaimed entitlements + treasuryAccrued`, depth 50.
- [ ] `script/Deploy.s.sol`: env `PROFILE=local|demo|default` selects §6.2 param column **plus `PROFILE=e2e`** (bettingWindow 15, acceptWindow 120, disputeWindow 30, graceWindow 15 — for the wall-clock e2e run); `local` profile deploys MockUSDC + both mock registries + ValidationRegistry + OracleCore, mints 10_000e6 USDC to anvil accounts 0–9, writes complete `deployments/local.json` per plan §2.2/§2.3 via `vm.writeJson` (agents object filled with zeros — register-agents.ts patches it). `fuji` profile uses canonical addresses (§0), deploys only ValidationRegistry + OracleCore.
- [ ] `forge test -vv` fully green; `forge inspect OracleCore abi --json > ../shared/oracle-core.abi.json` for the integration diff.

**Done-when:** `cd contracts && forge test` → all U-1..U-18 + I-1 pass. Report: test count, any deviation from DESIGN, gas of `placeBet`/`claim`.

---

## 4. WS-B — Server (parallel agent B)

**Files:** `server/`, plus `shared/src/x402-lite.ts` (you own it; types in `shared/src/x402-types.ts` are frozen). Read DESIGN §6.6, §8.1–8.2. Build against `shared/src/abi.ts` — never invent event shapes. Vitest TDD where logic is pure (trust math, x402 sig verify, payout preview).

### Task B1: x402-lite (TDD)
- [ ] Tests first (`x402-lite.test.ts`): challenge shape matches DESIGN §8.2 JSON exactly; wrapFetch signs valid EIP-3009 typed data (verify with viem `verifyTypedData`); middleware rejects: missing header → 402, bad sig → 402, wrong value → 402; happy path calls facilitator /verify + /settle (mock with `undici` MockAgent or a local express stub) and sets `X-PAYMENT-RESPONSE`.
- [ ] Implement per plan §2.4. `validAfter = 0`, `validBefore = now + 600`, `nonce = random 32 bytes`.

### Task B2: mini-facilitator (`facilitator-local.ts`)
- [ ] Express on PORTS.facilitatorLocal. `/verify`: recover EIP-712 signer == `authorization.from`, `value >= maxAmountRequired`, `to == payTo`, time window ok, nonce unused on-chain (`authorizationState`). `/settle`: relayer key (anvil index 9, `FACILITATOR_RELAYER_KEY` env) submits `transferWithAuthorization` via viem `writeContract`, waits 1 conf, returns `{success, txHash}`.

### Task B3: DB + indexer
- [ ] `db.ts` (better-sqlite3, WAL):
  ```sql
  CREATE TABLE tasks(task_id INTEGER PRIMARY KEY, client TEXT, worker_agent_id INTEGER, validator_agent_id INTEGER,
    reward TEXT, created_at INTEGER, deadline INTEGER, spec_uri TEXT, state TEXT, worker_wallet TEXT,
    self_stake TEXT, accepted_at INTEGER, bet_cutoff INTEGER, delivered_at INTEGER, deliverable_hash TEXT,
    evidence_uri TEXT, outcome TEXT, via_rule INTEGER, validator_score INTEGER,
    yes_pool TEXT, no_pool TEXT, p_cutoff_bps INTEGER);
  CREATE TABLE bets(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, agent_id INTEGER, bettor TEXT,
    side TEXT, amount TEXT, yes_pool_after TEXT, no_pool_after TEXT, block_number INTEGER, tx_hash TEXT, ts INTEGER);
  CREATE TABLE odds_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, t INTEGER, p_bps INTEGER);
  CREATE TABLE trust_tuples(agent_id INTEGER PRIMARY KEY, n INTEGER, win_rate REAL, brier REAL, ssr REAL,
    forfeited TEXT, updated_at INTEGER, json TEXT);
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
  ```
- [ ] `indexer.ts`: viem `getLogs` catch-up from `deployBlock` + `watchContractEvent` (poll 1000ms) for all OracleCore events + `ValidationResponded`. Idempotent upserts (unique on tx_hash+log index via meta cursor). On `TaskAccepted`: snapshot p. On `BetPlaced`: insert bet + snapshot + WS push. On first post-cutoff event or timer: record `p_cutoff_bps` (last snapshot ≤ betCutoff). On `OutcomeResolved`: update task, recompute trust tuple for that worker, WS push `settled`.
- [ ] `trust.ts` (TDD with fixture rows): Trust Tuple per DESIGN §6.6 — `brier = (1/n)Σ(p_k − o_k)²` with `p_k = p_cutoff_bps/10000`, `o_k = outcome==Yes?1:0`; `ssr`; `forfeited = Σ selfStake_k where outcome_k == No`; `winRate`; `p_live` array from open tasks; `rep8004` read via viem `getSummary` (tolerate revert → null). Test: 2 settled tasks (p=0.5 → YES, p=0.5 → NO) ⇒ brier 0.25, winRate 0.5.
- [ ] `ws.ts`: WS server on the same HTTP server, protocol §2.5; snapshot on connect.

### Task B4: API (`api.ts`, `x402.ts`, `index.ts`)
- [ ] Routes per DESIGN §8.2 table: free `/healthz`, `/v1/tasks`, `/v1/tasks/:id`; x402-gated `/v1/markets/:taskId/odds` (1000 units) and `/v1/agents/:agentId/trust` (5000 units) via `x402Middleware`. Skip `/trust/stream` (stretch).
- [ ] Static: `GET /specs/*` from `server/static/specs/`, `GET /.well-known/agents/*`, `GET /artifacts/:file`; `POST /artifacts` (free, raw body ≤ 1 MB) saves to `server/artifacts/<keccak256(body)>.ts` and returns `{uri, hash}`.
- [ ] Write `static/specs/task-a-slugify.json` + `task-b-nextbusinessday.json` (public spec content contract: plan §5.5).
- [ ] `index.ts` boots db → indexer → api+ws on PORTS.server; env `ORACLE_DEPLOYMENT`, `ORACLE_REVENUE_WALLET`, `X402_FACILITATOR`.
- [ ] `api.test.ts`: free routes 200; gated route without header → 402 with exact challenge shape.

**Done-when:** `pnpm -F server test` green; `pnpm -F server typecheck` clean. Report any frozen-interface friction.

---

## 5. WS-C — Agent fleet (parallel agent C)

**Files:** `agents/`, `scripts/demo.ts`, `scripts/register-agents.ts`. Read DESIGN §8.3–8.4, §9. Strategy/solver/confidence logic = pure functions with vitest tests; daemon wiring thin.

### Task C1: lib
- [ ] `lib/chain.ts`: viem clients from `loadDeployment()`; helpers `approveUsdcOnce`, `waitForState(taskId, state)`, event watchers per OracleCore ABI.
- [ ] `lib/confidence.ts` (TDD): `estimateConfidence(spec: TaskSpec): number` — deterministic: template `task-a-slugify` → 0.45, `task-b-nextbusinessday` → 0.12, default 0.25. `stakeFor(reward, conf) = reward * clamp(conf, 0.10, 0.50)` (bigint bps math).
- [ ] `lib/solvers/slugify.ts` (TDD): correct per public spec §5.5A — must pass all 10 hidden tests.
- [ ] `lib/solvers/next-business-day.ts` (TDD): **deliberately naive** — skips Sat/Sun + only the national holidays listed in the public spec. Must pass exactly 5/10 hidden tests (score 50 < 80 ⇒ NO).

### Task C2: hidden test suites (the validator's secret)
- [ ] `hidden-tests/task-a-slugify/hidden.test.ts`: 10 vitest cases importing `../solution` (the downloaded deliverable is written there at run time): lowercase, spaces→`-`, collapse repeats, trim `-`, strip diacritics (NFKD), drop non-alphanumerics, empty→`""`, numerics kept, long-string pass-through, mixed-unicode case.
- [ ] `hidden-tests/task-b-nextbusinessday/hidden.test.ts`: 10 cases over 2026 IN calendar; includes **Pongal (Thu 2026-01-15)** and **Onam (regional, 2026-08-26)** which are absent from the public spec, plus weekend rolls, holiday-then-weekend chain, year-boundary. Naive solver must pass exactly 5 — verify by running it against your own naive solver in `solvers.test.ts`.
- [ ] `test/solvers.test.ts` asserts: slugify 10/10, naive nextBusinessDay exactly 5/10 against the hidden suites.

### Task C3: validator daemon
- [ ] x402-gated `POST /v1/validate-intake` on PORTS.validatorIntake (uses `x402Middleware` from shared; price 10000 units).
- [ ] On `DeliverySubmitted` where `validatorAgentId == mine`: GET `evidenceURI` → write `tmpdir/solution.ts` + copy `hidden-tests/<template>/` → `npx vitest run --reporter=json` → `score = round(100*passed/total)` → write report JSON to artifacts via server POST → `validationResponse(requestHash, score, reportUri, keccak256(report), "oracle")` → then call `OracleCore.settleWithValidation(taskId)` (anyone-can-call; validator volunteers as cranker) → `claim` nothing (validator fee accrues internally; it's paid from claim? No — validator fee is escrowed to validator at `_finalize`; WS-A exposes it via `claim`? **Contract contract:** validator fee accrues to a `validatorAccrued[wallet]` mapping claimable via `claim(taskId)`-independent `withdrawValidatorFees()` — WS-A: implement it that way; WS-C: call `withdrawValidatorFees()` after settle.)
- [ ] Template detection: from task `specURI` filename.

### Task C4: worker daemon
- [ ] DESIGN §8.3 worker loop verbatim, with DR-6 path (b): on `TaskCreated(worker=me)` → fetch spec (free) → `estimateConfidence` → `acceptAndStake(taskId, myAgentId, stakeFor(...))` → wait cutoff → x402-buy vendor input (`wrapFetchWithPayment` → vendor `/v1/input`) → solve via solver registry keyed by template → `POST /artifacts` (deliverable = solver source file exporting the required function) → x402-pay validator intake → `submitDelivery(taskId, deliverableHash, evidenceURI)` → `validationRequest(validatorWallet, myAgentId, evidenceURI, keccak256(abi.encode(taskId, deliverableHash)))` on ValidationRegistry.
- [ ] After settlement event: `claim(taskId)` (try/catch — losing claim reverts `NothingToClaim`, that's fine; log it).

### Task C5: bettors + vendor
- [ ] `lib/strategies.ts` (TDD, pure): `repDecision(tuple, task)`, `skepticDecision(task)`, `mirrorDecision(task, pBps)` — exact rules DESIGN §8.3. Tests cover all branches (cold start, winRate bands, ssr override, |p−0.5| threshold).
- [ ] Daemons: poll free `/v1/tasks` every 3 s for Open tasks before cutoff; pay x402 for `/odds` (all three) and `/trust` (rep only); `placeBet`; after settlement `claim` (try/catch). Mirror waits `min(60_000, (betCutoff−now)/2 ms)` then acts (so the e2e 15 s window still works).
- [ ] `vendor.ts`: x402-gated `GET /v1/input` on PORTS.vendor returning `{hint: "unicode NFKD fold", ts}` — flavor only.
- [ ] `scripts/register-agents.ts`: for each fleet agent: `IdentityRegistry.register("http://localhost:8402/.well-known/agents/<name>.json")`, write `{name: {address, agentId}}` back into the deployment JSON `agents` map; also write the six registration JSONs into `server/static/well-known/agents/` (shape: DESIGN §8.3 common).
- [ ] `scripts/demo.ts`: as client (anvil 1): approve USDC, `createTask` for Task A (reward 100e6, deadline now+acceptWindow… use `now + bettingWindow + 600`, spec URI + keccak hash of the spec JSON body), wait for settlement, print payout table from `previewPayout` + events; `--task b` flag for Task B; `--both` runs A then B sequentially.

**Done-when:** `pnpm -F agents test` green (strategies, solvers vs hidden suites, confidence); `pnpm -F agents typecheck` clean.

### 5.5 Public spec content contract (WS-B writes the files; WS-C codes against them)
- **A `task-a-slugify.json`:** `{ template:"task-a-slugify", fn:"slugify(title: string): string", rules:["lowercase","NFKD strip diacritics","non-alnum runs → single '-'","trim '-'"], examples:[["Hello World","hello-world"],["Crème Brûlée!","creme-brulee"],["  --A  B--  ","a-b"]] }`
- **B `task-b-nextbusinessday.json`:** `{ template:"task-b-nextbusinessday", fn:"nextBusinessDay(dateISO: string, region: 'IN'): string", rules:["skip Sat/Sun","skip national holidays: 2026-01-26, 2026-08-15, 2026-10-02, 2026-12-25", "return next strictly-later business day, ISO date"], examples:[["2026-01-23","2026-01-27"],["2026-08-14","2026-08-17"],["2026-06-12","2026-06-15"]] }`  ← deliberately omits Pongal + Onam.

### 5.6 Registration JSON shape (server serves, WS-C writes): `{ name, description, registrations:[{ agentRegistry: "eip155:<chainId>:<identityRegistry>", agentId }], supportedTrust:["reputation"] }`

---

## 6. WS-D — Web dashboard (parallel agent D)

**Files:** `web/`. Read DESIGN §8 (WS protocol = plan §2.5) + §13 stage script for the look. No chain access — WS + free REST only (`http://localhost:8402`).

### Task D1: scaffold + data layer
- [ ] Vite React-TS app; `ws.ts` reconnecting client of plan §2.5 protocol; state in a single `useReducer` store keyed by taskId.
### Task D2: components
- [ ] `App`: dark stage theme, big header "ORACLE — outcome markets for agent trust", grid of `TaskCard`s (newest first).
- [ ] `TaskCard`: state badge (Created/Open/Executing/Delivered/Settled/Cancelled — Executing = Open && now>betCutoff, tick locally), reward, deadline countdown, `StakeBadge` ("Worker staked $X on itself" — glows when fresh), `OddsTicker` (recharts line of `p_bps/100`% over time from bet snapshots; big current-probability numeral), `PoolsBar` (YES vs NO horizontal stacked bar, USDC labels), bettor list with `AgentAvatar` (emoji per agentId: 🤖🧠🦨🪞🏪⚖️) and amounts.
- [ ] `SettleBanner`: on `settled` — full-card overlay animation: green "YES — worker paid" with payout figures, or red "NO — self-stake flows to skeptics" (CSS keyframe, 3 s).
- [ ] Demo polish: ticker must visibly animate on each bet (transition on line draw + number flip).
### Task D3: empty/loading states + `pnpm -F web build` clean. Vitest for the reducer (bet → snapshot append; settled → status change).

**Done-when:** `pnpm -F web build` + reducer tests green; screenshot-ready against mock WS data (include a `src/mockFeed.ts` dev toggle replaying a scripted Task A+B sequence so the dashboard can be demoed without a chain).

---

## 7. Phase 2 — Integration (orchestrator, sequential after all 4 agents)

- [ ] `pnpm install` at root; fix workspace/typecheck breaks across packages (interface drift = fix consumer to match `shared/`, or escalate).
- [ ] ABI diff: selectors of `shared/src/abi.ts` vs `contracts` forge artifact — must be identical; reconcile (forge artifact wins, update shared).
- [ ] `forge test` green at root CI script `package.json: "test": "pnpm -r test && cd contracts && forge test"`.
- [ ] Commit per workstream (5 commits: phase-0 already committed; contracts; server+shared; agents; web).

## 8. Phase 3 — E2E on anvil (orchestrator)

- [ ] `scripts/run-all.sh`: starts (background, logs to `/tmp/oracle-logs/`): anvil `--block-time 1` → `forge script Deploy.s.sol --profile e2e PROFILE=e2e` → `register-agents.ts` → facilitator-local → server → vendor → validator → 3 bettors → worker. Healthcheck loop until all ports respond.
- [ ] `scripts/e2e-local.sh`: run-all, then `demo.ts --both`, assert: Task 1 settles YES via rule 2 score 100; Task 2 settles NO via rule 3 score ≤ 50; ≥ 2 distinct x402 settle txs on the facilitator; trust tuple for worker shows n=2, winRate=0.5; claims succeed; exits 0.
- [ ] Debug loop until green (systematic-debugging skill). Commit.

## 9. Phase 4 — Fuji readiness (orchestrator; deploy gated on funding)

- [ ] Generate fresh mnemonic (`cast wallet new-mnemonic`), derive 10 addresses, write `.env.fuji.example` + `docs/FUJI.md` (funding table: which address needs AVAX gas / USDC from `faucet.circle.com`; deploy + register + run commands; facilitator smoke-test command `[VERIFY-2]` with fallback ladder per DESIGN §8.2).
- [ ] `README.md`: pitch (DESIGN §1), quickstart (`./scripts/e2e-local.sh`), architecture diagram, threat model link, "unaudited testnet code" notice.
- [ ] Final commit. **STOP — actual Fuji deploy + facilitator smoke test require the user to fund the printed addresses.**

## 10. Self-review notes (resolved during planning)

- Validator fee payout path was unspecified in DESIGN (claim is per-bettor): **decision — `validatorAccrued[wallet]` mapping + `withdrawValidatorFees()`** (WS-A implements, WS-C calls; logged here as DR-8).
- `ExecutionStarted` emitted inside `submitDelivery` (first post-cutoff touch in practice).
- Mirror bettor 60 s wait would overshoot the 15 s e2e window → `min(60s, half remaining window)`.
- E2e timing windows (PROFILE=e2e) added because demo windows (180 s) make the loop too slow to iterate on.
- `p_cutoff_bps` defined as last odds snapshot at/before `betCutoff` (includes acceptance-time snapshot if no bets — p=1.0 when only self-stake exists; brier then penalizes failure hard, which is correct).
