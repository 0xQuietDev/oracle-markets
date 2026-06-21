#!/usr/bin/env bash
# One-time Fuji bring-up: deploy contracts, fund the fleet, register agents.
# Prereq: .env.fuji with FUJI_* keys, and the DEPLOYER funded with AVAX
#         (Avalanche Fuji faucet → https://core.app/tools/testnet-faucet/).
# Uses our own MockUSDC by default (FUJI_USE_MOCK_USDC=1) so no USDC faucet is
# needed — set FUJI_USE_MOCK_USDC=0 to use canonical Circle USDC instead.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; source .env.fuji; set +a
export ORACLE_DEPLOYMENT="$PWD/deployments/fuji.json"
RPC="${FUJI_RPC:-https://api.avax-test.network/ext/bc/C/rpc}"
export FUJI_USE_MOCK_USDC="${FUJI_USE_MOCK_USDC:-1}"

echo "== preflight: deployer AVAX balance =="
DEP_ADDR=$(cast wallet address --private-key "$FUJI_DEPLOYER_KEY")
BAL=$(cast balance "$DEP_ADDR" --rpc-url "$RPC")
echo "deployer $DEP_ADDR  AVAX=$(cast from-wei "$BAL")"
if [ "$BAL" = "0" ]; then
  echo "FATAL: deployer has no AVAX. Fund it: https://core.app/tools/testnet-faucet/  (address above)" >&2
  exit 1
fi

echo "== deploy (PROFILE=fuji, mockUSDC=$FUJI_USE_MOCK_USDC) =="
(cd contracts && PROFILE=fuji FUJI_USE_MOCK_USDC="$FUJI_USE_MOCK_USDC" forge script script/Deploy.s.sol \
  --rpc-url "$RPC" --broadcast --private-key "$FUJI_DEPLOYER_KEY" --slow)
grep -q '"oracleCore": "0x[1-9a-fA-F]' deployments/fuji.json || { echo "deploy did not write oracleCore" >&2; exit 1; }
echo "deployed:"; node -e 'const j=require("./deployments/fuji.json");console.log(j.contracts)'

echo "== fund fleet (AVAX gas + USDC) from deployer =="
pnpm -F @oracle/agents exec tsx src/cli/fund-fuji.ts

echo "== register agents on Fuji =="
# agent key envs the fleet reads (keyFor): map FUJI_* -> <ROLE>_KEY
export WORKER_KEY="$FUJI_WORKER_KEY" VALIDATOR_KEY="$FUJI_VALIDATOR_KEY" \
  BETTOR_REP_KEY="$FUJI_BETTORREP_KEY" BETTOR_SKEPTIC_KEY="$FUJI_BETTORSKEPTIC_KEY" \
  BETTOR_MIRROR_KEY="$FUJI_BETTORMIRROR_KEY" VENDOR_KEY="$FUJI_VENDOR_KEY" \
  CLIENT_KEY="$FUJI_CLIENT_KEY" HUMAN_KEY="$FUJI_HUMAN_KEY"
pnpm -F @oracle/agents register

echo "== Fuji bring-up complete. Start services with: scripts/run-fuji.sh =="
