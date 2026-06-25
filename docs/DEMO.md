# ORACLE — LIVE DEMO RUNBOOK

> **The hook:** *"ERC-8004 tells you an agent's PAST. Nobody prices its FUTURE — and the agent has to bet on itself."*
>
> Every command below is copy-pasteable and verified against `scripts/`. Run everything **from the repo root** (`/data/personal/oracle`). Team1 India Speedrun #1 — Agentic Payments. Avalanche Fuji (43113), x402, ERC-8004.

---

## 1. TL;DR — the 90-second version

What you show, in order:

1. **Open a market** in the dashboard: *"Will worker W complete task T before the deadline?"*
2. The **worker agent claims it and self-stakes ≥10% of the reward on its own success** → *"acceptance IS a bet."*
3. **Bettor agents (rep / skeptic / mirror) take YES/NO** during the 180s window → *"the pool ratio is a live price of trust."*
4. The **validator runs a hidden test suite and posts the score on-chain**; settlement is rule-based (R0–R7).
5. **Two outcomes, side by side:** Task A `slugify` → YES, worker paid. Task B `nextBusinessDay(...,"IN")` → NO, the worker's self-stake drains to the skeptic.
6. **Money shot:** the settle tx on Snowtrace + the ERC-8004 write-back. *"Settled on-chain, written back to ERC-8004, and resold over x402."*

Two ways to run it:
- **Path A — fully live on Fuji** (real USDC settlements, real Gemini agents). Highest impact, depends on Gemini quota + AVAX gas.
- **Path B — local deterministic** (`./scripts/e2e-local.sh` or `PROFILE=demo bash scripts/run-all.sh`). Bulletproof, offline, identical code. Your fallback.

---

## 2. Pre-flight checklist (T-15min)

Run top to bottom. Stop and fix before presenting if any step is red.

### 2.1 Install + build/test sanity (offline, ~no risk)

```bash
cd /data/personal/oracle
pnpm install
pnpm test          # contracts (37, incl. fuzzed solvency invariant) + server + agents + web
```

`pnpm test` runs `forge test` for contracts plus vitest for each TS package. Green = code is sound regardless of network.

### 2.2 Gemini key (real LLM agents)

```bash
cat .env.gemini    # expect: GEMINI_API_KEY=...
```

- `.env.gemini` already exists with a key. Both Fuji scripts `source` it automatically (`[ -f .env.gemini ] && source .env.gemini`).
- **Free-tier quota can exhaust.** Without a working key the fleet silently falls back to deterministic strategies — fine for built-in templates (Task A/B), but **custom markets typed in the UI NEED Gemini** (the worker writes code, the LLM judge scores). If you plan to demo a custom task, confirm the key works first.

### 2.3 Confirm Fuji wallets are funded (the #1 live risk)

```bash
scripts/fuji-status.sh
```

This prints, best-effort (never aborts): current Fuji block, **AVAX balances for deployer / relayer / fleet**, server `/healthz`, `/v1/control` (`available` / `canBet` / templates), and the latest task.

- The **relayer signs every x402 settlement and burns AVAX fast** — make sure `relayer` has a healthy balance, not just the fleet.
- Top up at the Avalanche Fuji faucet: <https://core.app/tools/testnet-faucet/>. A few AVAX per funded role is plenty.
- USDC is our **own EIP-3009 token** (`0x08386F62725b25d8506e5B0016E13574980760Db`), so no Circle faucet is needed — the fleet was funded at bring-up (`scripts/deploy-fuji.sh` → `fund-fuji.ts`). If a wallet is dry, re-run funding before presenting.

> First-time Fuji bring-up only (already done — do NOT run live unless redeploying): `scripts/deploy-fuji.sh` deploys contracts, funds the fleet, registers agents. The contracts are already live (OracleCore `0xa8Cc58b1E28ee7b5B8fc870402DC1515f4fe7BAD`).

### 2.4 Boot order (Path A) — facilitator → server → agents → web

One command brings up the supervised Fuji stack in the correct order:

```bash
scripts/run-fuji.sh
```

It boots, under a restart-on-exit supervisor, in this exact order with port gates: **facilitator (:8405) → server (:8402) → vendor (:8403) → validator (:8404) → bettor-rep → bettor-skeptic → bettor-mirror → worker.** It aborts fast if any of ports 8402–8405 is already in use (run `scripts/stop-all.sh` first). Logs land in `/tmp/oracle-fuji-logs/` (`facilitator.log`, `server.log`, `worker.log`, …).

Then start the dashboard in a second terminal:

```bash
pnpm -F @oracle/web dev
```

### 2.5 Confirm the dashboard loads

- Open **<http://localhost:5173/>**.
- Vite proxies `/v1` and `/artifacts` to the server on `:8402`, and the dashboard reads the live WebSocket at `ws://localhost:8402`.
- Re-run `scripts/fuji-status.sh` and confirm `/healthz` is up and `/v1/control` shows `available=true canBet=true templates=task-a-slugify,task-b-nextbusinessday`.

---

## 3. Two demo paths

### Path A — fully live on Fuji (real on-chain)

**Boot (if not already up):**

```bash
scripts/run-fuji.sh                 # facilitator → server → fleet (supervised)
pnpm -F @oracle/web dev             # dashboard on http://localhost:5173/
scripts/fuji-status.sh              # sanity: wallets funded, server up, canBet=true
```

**Drive a market — two options:**

- **From the UI (best for narration):** in the dashboard, use the *Create market* form → pick a **built-in template** (objective hidden tests) or type **your own task** (question + function signature + reward + deadline, settled by the LLM judge). A worker autonomously claims it.
- **From the CLI (deterministic, reliable trigger):**

  ```bash
  scripts/fuji-task.sh task-a-slugify             # posts Task A, prints taskId + txHash + Snowtrace link
  scripts/fuji-task.sh task-b-nextbusinessday     # posts Task B (the authentic failure)
  ```

  `fuji-task.sh` POSTs `/v1/control/task` and prints `taskId`, `txHash`, and `https://testnet.snowtrace.io/tx/<hash>`. Default template (no arg) is `task-a-slugify`.

**Narrate, watching the dashboard:** worker claim + **self-stake badge** → bettors pricing the **live odds line** → betting window (180s on Fuji per `deployments/fuji.json::params`) → validator posts the score → **settle animation**. Then open the Snowtrace link for the on-chain proof.

> Live odds note: the server indexer can **lag a few seconds** behind a settle. If the UI looks stale, refresh, or read the chain directly (`scripts/fuji-status.sh` shows the latest task state + pools).

### Path B — local deterministic, bulletproof fallback (offline)

Use this if Gemini quota is exhausted or Fuji AVAX/RPC is misbehaving. **Identical code**, runs on a local anvil against `deployments/local.json`, no faucets.

**Option B1 — one-shot, self-asserting (most bulletproof; great as a backstop video/run):**

```bash
./scripts/e2e-local.sh
```

This boots the whole local stack, runs **Task A (expect YES, score 100) + Task B (expect NO, ≤50)**, asserts ≥2 real x402 settlements and 2 settled tasks, prints **`E2E GREEN`**, and tears everything down on exit. Pure proof it all works.

**Option B2 — live local stack + dashboard (narratable fallback with 180s windows):**

```bash
bash scripts/stop-all.sh; rm -f server/data/oracle.db*
PROFILE=demo bash scripts/run-all.sh        # anvil + deploy + register + facilitator + server + fleet, 180s betting windows
pnpm -F @oracle/web dev                      # dashboard → http://localhost:5173/
# then drive it:
pnpm -F @oracle/agents demo -- --both        # Task A (YES) then Task B (NO)
#   or a single task:  pnpm -F @oracle/agents demo -- --task a
#   or via the server: ORACLE_SERVER=http://localhost:8402 scripts/fuji-task.sh task-a-slugify
```

`PROFILE=demo` selects the 180s betting-window stage config. Logs land in `/tmp/oracle-logs/`.

**Option B3 — UI-only scripted replay (no backend at all, never fails):** open **<http://localhost:5173/?mock=1>** — the dashboard replays a scripted Task A YES / Task B NO sequence with the full order flow + settle animation. Visuals only (no real chain), but it cannot break. Last-resort visual.

---

## 4. The spoken script (~2.5–3 min)

| # | On-screen action | What you say |
|---|---|---|
| 1 | Dashboard open at `localhost:5173`, markets list. | "ERC-8004 scores an agent's past. Nobody prices its future. ORACLE is an outcome market on whether **this** agent finishes **this** task before the deadline." |
| 2 | Open a market (UI form, or `scripts/fuji-task.sh task-a-slugify`). New market card appears. | "A client escrows a reward in USDC and posts the job. It's an open board — any worker agent can claim it." |
| 3 | Worker claims; **self-stake badge** lights up on the card. | "Here's the first mechanic. The worker can't accept without staking at least 10% of the reward on its OWN success. **Acceptance IS a bet.** Confidence becomes capital at risk — you can't fake it." |
| 4 | **Live odds line** moves as bettor-rep / skeptic / mirror place YES/NO. | "Now autonomous bettor agents price it — the believer, the skeptic, the momentum-follower. They pay over x402 for the odds and the trust feed. **The pool ratio is a live, capital-weighted price of trust.**" |
| 5 | Validator badge → score posts; **settle animation** fires; card resolves **YES**. | "The worker — a real Gemini agent — wrote the solution. The validator runs a hidden test suite and posts the score on-chain. Rule-based settlement, no human. Task A passes: **YES**, the worker gets paid." |
| 6 | Post Task B (`scripts/fuji-task.sh task-b-nextbusinessday`). Same flow → resolves **NO**, self-stake drains to the skeptic. | "Task B asks for the next business day in India. The hidden tests include regional holidays — Pongal, Onam — that aren't in the public spec. Gemini doesn't know them. It fails. **NO** — and the worker's self-stake drains to the skeptic. An authentic failure, not a script." |
| 7 | Click the Snowtrace settle tx; show the ERC-8004 write-back. | "And it's real. **Settled on-chain in USDC, written back to ERC-8004, and the calibrated Trust Tuple is resold to other agents over x402 at half a cent a query.** Forward-looking trust, as a paid data product." |

Land all three punchlines: **"acceptance IS a bet"** (beat 3) · **"the pool ratio is a live price of trust"** (beat 4) · **"settled on-chain, written back to ERC-8004, and resold over x402"** (beat 7).

---

## 5. The money shot — on-chain proof

What to click to prove it's real:

1. **The settle tx on Snowtrace.** From `scripts/fuji-task.sh` output, open `https://testnet.snowtrace.io/tx/<txHash>`. Point at the `OutcomeResolved` event on **OracleCore** ([`0xa8Cc58b1E28ee7b5B8fc870402DC1515f4fe7BAD`](https://testnet.snowtrace.io/address/0xa8Cc58b1E28ee7b5B8fc870402DC1515f4fe7BAD)).
2. **The ERC-8004 write-back.** Open the **Reputation Registry** ([`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.snowtrace.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)) → its transactions: the outcome feedback written after settlement. ValidationRegistry ([`0xC5a96DE9d445849CB5c159967A5532D2D3CBAE81`](https://testnet.snowtrace.io/address/0xC5a96DE9d445849CB5c159967A5532D2D3CBAE81)) holds the `ValidationResponded` (validator's on-chain score). Fleet agentIds 211–217 on the Identity registry ([`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.snowtrace.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e)).
3. **The YES/NO contrast.** Show Task A (YES, worker paid) next to Task B (NO, self-stake forfeited) — the same machinery, two honest outcomes.
4. **Pre-settled backstop.** If you can't get a fresh settle on stage, four markets are already settled on-chain: **#3 YES, #4 YES, #5 NO, #6 NO.** Open any of them on OracleCore in Snowtrace as live proof.

---

## 6. If it breaks — troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Worker/bettors silent; custom market never scored | **Gemini free quota exhausted** | Built-in Task A/B still work via deterministic fallback — switch to `scripts/fuji-task.sh task-a-slugify` / `task-b-nextbusinessday`. For a guaranteed run, drop to **Path B** (`./scripts/e2e-local.sh`). Custom (LLM-judged) tasks require Gemini. |
| Settle txns fail / "insufficient funds" / nothing settles | **Fuji AVAX low** (relayer burns gas every x402 settlement) | `scripts/fuji-status.sh` → check **relayer** + fleet balances → top up at <https://core.app/tools/testnet-faucet/>. If you can't fund in time, **show the pre-settled markets #3–#6** on Snowtrace, or fall to Path B. |
| Dashboard shows stale odds / outcome after a settle | **Indexer lag** (a few seconds behind chain) | Wait a beat and refresh the page; or read the chain directly with `scripts/fuji-status.sh` (latest task state + pools). |
| `FATAL: port 84xx in use` on boot | A previous stack is still running | `bash scripts/stop-all.sh`, then re-run `scripts/run-fuji.sh`. |
| Server `/healthz` DOWN in status | Server didn't come up | Check `/tmp/oracle-fuji-logs/server.log` (supervisor auto-restarts up to 50×); if a port clash, `stop-all.sh` then re-boot. |
| Fuji RPC flaky on stage | Public RPC blip | Set `FUJI_RPC_FALLBACK` (run-fuji exports it for client retry) before boot, or switch to **Path B** (anvil, no RPC). |
| Nothing works / hostile network | — | `./scripts/e2e-local.sh` (offline, self-asserting → `E2E GREEN`) or UI replay at `http://localhost:5173/?mock=1`. |

---

## 7. Reset between runs

For a clean second run (local stack and Fuji stack):

```bash
bash scripts/stop-all.sh            # kills supervisors + daemons, frees ports 8402-8405, 8545, 5173
rm -f server/data/oracle.db*        # clear the indexer DB for a fresh task list
```

`stop-all.sh` is safe and narrow — it kills the supervisor loops + their children and frees every stack port, but never touches an unrelated shell. After reset:

- **Path A:** `scripts/run-fuji.sh` then `pnpm -F @oracle/web dev`. (No redeploy — the Fuji contracts persist; fleet stays registered.)
- **Path B:** `PROFILE=demo bash scripts/run-all.sh` then `pnpm -F @oracle/web dev`.

> Note: clearing `oracle.db` resets the **off-chain** indexer view only. On-chain Fuji history (settled markets #3–#6, the markets you just ran) stays on Snowtrace forever — that's the point.

---

### Honest status

Unaudited hackathon code, **testnet only.** Settlement is guarded by `nonReentrant`, pull-payments, checks-effects-interactions, and a fuzzed solvency invariant — but it has **not** had a security audit. Do not deploy to mainnet.
