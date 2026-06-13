# ORACLE on Avalanche Fuji — deployment & funding guide

Everything in `docs/DESIGN.md` §7.1 / §8.2 is verified live. This file is the
operator runbook for moving from the local anvil stack to Fuji (chainId 43113).

## 0. Prerequisites

- Foundry (`forge`, `cast`) and Node 22 + pnpm installed (`pnpm install` at repo root).
- A funded mnemonic. `.env.fuji` already holds a freshly-generated set of 10 keys
  (gitignored). Roles by derivation index:

  | idx | role | needs |
  |---|---|---|
  | 0 | deployer | AVAX (gas) |
  | 1 | client | AVAX + USDC (escrows reward) |
  | 2 | worker | AVAX + USDC (self-stake + x402 spend) |
  | 3 | validator | AVAX (posts validationResponse) |
  | 4 | bettorRep | AVAX + USDC |
  | 5 | bettorSkeptic | AVAX + USDC |
  | 6 | bettorMirror | AVAX + USDC |
  | 7 | vendor | AVAX (sells x402 input) |
  | 8 | revenue | — (just receives x402 fees) |
  | 9 | relayer | AVAX (only if self-hosting a facilitator) |

## 1. Fund the wallets

Print the addresses (no secrets leave the machine):

```bash
source .env.fuji
for r in DEPLOYER CLIENT WORKER VALIDATOR BETTORREP BETTORSKEPTIC BETTORMIRROR VENDOR REVENUE RELAYER; do
  k="FUJI_${r}_KEY"; echo "$r $(cast wallet address --private-key ${!k})"
done
```

- **AVAX gas:** Avalanche Fuji faucet → https://core.app/tools/testnet-faucet/ (or `https://faucet.avax.network`). Fund every role that needs AVAX above.
- **Test USDC:** Circle faucet → https://faucet.circle.com (select Avalanche Fuji). Send to client, worker, and the three bettors. USDC is `0x5425890298aed601595a70AB815c96711a31Bc65` (6 decimals, EIP-3009).

A few AVAX and ~50 USDC per funded role is plenty for a demo.

## 2. `[VERIFY-2]` — facilitator smoke test (Day-1 gate)

Before deploying, confirm an x402 facilitator settles a real EIP-3009 transfer on
Fuji. Try the ladder in order; the first that returns `{success:true}` wins. Set
`X402_FACILITATOR` in `.env.fuji` to the winner.

```bash
# pay yourself $0.001 USDC through a facilitator and confirm it settles
ORACLE_DEPLOYMENT=deployments/fuji.json \
X402_FACILITATOR=https://facilitator.payai.network \
pnpm -F @oracle/agents exec tsx ../scripts/x402-smoke.ts   # see note below
```

Fallback ladder (DESIGN §8.2): **1)** PayAI `facilitator.payai.network` · **2)** UltravioletaDAO · **3)** thirdweb (serverWallet mode) · **4)** self-hosted `x402-rs` with `RPC_URL_AVALANCHE_FUJI`. If all external ones reject Fuji on demo day, run the bundled `server/src/facilitator-local.ts` against Fuji with `FACILITATOR_RELAYER_KEY=$FUJI_RELAYER_KEY` — same wire protocol, you custody the relayer.

> `scripts/x402-smoke.ts` is a 20-line harness: `wrapFetchWithPayment` against a
> throwaway 402 endpoint. Stub it from `shared/src/x402-lite.ts` if not present.

## 3. `[VERIFY-3]` — canonical ValidationRegistry

Re-check `github.com/erc-8004/erc-8004-contracts` for a published canonical Fuji
ValidationRegistry address. If one exists, put it in `deployments/fuji.json`
under `contracts.validationRegistry` and **remove** the `new ValidationRegistry()`
line from `Deploy.s.sol::_deployFuji`. Otherwise the deploy self-deploys it
(unmodified reference contract), which is the documented fallback.

## 4. Deploy

```bash
source .env.fuji
cd contracts
PROFILE=fuji forge script script/Deploy.s.sol \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  --broadcast --private-key "$FUJI_DEPLOYER_KEY" --verify
# writes oracleCore + validationRegistry + deployBlock back into deployments/fuji.json
```

## 5. Register the fleet & run

```bash
source .env.fuji
export ORACLE_DEPLOYMENT=deployments/fuji.json
export ORACLE_REVENUE_WALLET=$(cast wallet address --private-key $FUJI_REVENUE_KEY)
# per-agent keys are read from FUJI_<ROLE>_KEY by lib/chain.ts overrides:
export WORKER_KEY=$FUJI_WORKER_KEY VALIDATOR_KEY=$FUJI_VALIDATOR_KEY \
       BETTOR_REP_KEY=$FUJI_BETTORREP_KEY BETTOR_SKEPTIC_KEY=$FUJI_BETTORSKEPTIC_KEY \
       BETTOR_MIRROR_KEY=$FUJI_BETTORMIRROR_KEY VENDOR_KEY=$FUJI_VENDOR_KEY \
       CLIENT_KEY=$FUJI_CLIENT_KEY

pnpm -F @oracle/agents register     # registers 6 agents, patches fuji.json, writes well-known JSONs
pnpm -F @oracle/server start &      # indexer + x402 API on :8402
pnpm -F @oracle/agents vendor &
pnpm -F @oracle/agents validator &
pnpm -F @oracle/agents bettor-rep & pnpm -F @oracle/agents bettor-skeptic & pnpm -F @oracle/agents bettor-mirror &
pnpm -F @oracle/agents worker &
pnpm -F @oracle/web dev &           # dashboard on :5173

pnpm -F @oracle/agents demo -- --both   # drive Task A (YES) then Task B (NO)
```

Watch settlement on https://testnet.snowtrace.io (OracleCore `OutcomeResolved`,
ValidationRegistry `ValidationResponded`, ReputationRegistry `giveFeedback`).

## 6. Demo-day note

The stage config (DESIGN §6.2 "demo" column: 180 s betting window) is `PROFILE=demo`
locally; on Fuji it comes from `deployments/fuji.json::params`. If RPC misbehaves
on stage, fall back to the local anvil run (`./scripts/e2e-local.sh` / the web
dashboard `?mock=1` replay) — identical code, `deployments/local.json`.
