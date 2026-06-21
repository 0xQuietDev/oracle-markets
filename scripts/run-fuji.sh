#!/usr/bin/env bash
# Start the ORACLE stack against Avalanche Fuji (after scripts/deploy-fuji.sh).
# Real chain, real EIP-3009 USDC settlements via our own facilitator (relayer),
# canonical ERC-8004 registries, real Gemini agents.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; source .env.fuji; [ -f .env.gemini ] && source .env.gemini; set +a
LOGDIR="${LOGDIR:-/tmp/oracle-fuji-logs}"; mkdir -p "$LOGDIR"; : > "$LOGDIR/pids"

export ORACLE_DEPLOYMENT="$PWD/deployments/fuji.json"
export TASK_REWARD_USDC="${TASK_REWARD_USDC:-10}"   # modest rewards on testnet

# per-role signer keys (keyFor reads <ROLE>_KEY)
export WORKER_KEY="$FUJI_WORKER_KEY" VALIDATOR_KEY="$FUJI_VALIDATOR_KEY" \
  BETTOR_REP_KEY="$FUJI_BETTORREP_KEY" BETTOR_SKEPTIC_KEY="$FUJI_BETTORSKEPTIC_KEY" \
  BETTOR_MIRROR_KEY="$FUJI_BETTORMIRROR_KEY" VENDOR_KEY="$FUJI_VENDOR_KEY" \
  CLIENT_KEY="$FUJI_CLIENT_KEY" HUMAN_KEY="$FUJI_HUMAN_KEY"

# x402: our own facilitator on Fuji (relayer settles real EIP-3009 transfers)
export FACILITATOR_RELAYER_KEY="$FUJI_RELAYER_KEY"
export X402_FACILITATOR="http://localhost:8405"
export ORACLE_REVENUE_WALLET="$(cast wallet address --private-key "$FUJI_REVENUE_KEY")"

start() { local name="$1"; shift; ( "$@" >"$LOGDIR/$name.log" 2>&1 ) & echo "$! $name" >> "$LOGDIR/pids"; echo "started $name (pid $!)"; }
wait_port() { for _ in $(seq "${3:-60}"); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; }; sleep 0.5; done; echo "FATAL: $2 (port $1) down — see $LOGDIR/$2.log" >&2; exit 1; }

for port in 8402 8403 8404 8405; do
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && { exec 3>&- 3<&-; echo "FATAL: port $port in use — scripts/stop-all.sh first" >&2; exit 1; }
done

echo "== ORACLE on Fuji ($(node -e 'console.log(require("./deployments/fuji.json").contracts.oracleCore)')) =="
start facilitator pnpm -F @oracle/server facilitator; wait_port 8405 facilitator
start server pnpm -F @oracle/server start; wait_port 8402 server
start vendor pnpm -F @oracle/agents vendor; wait_port 8403 vendor
start validator pnpm -F @oracle/agents validator; wait_port 8404 validator
start bettor-rep pnpm -F @oracle/agents bettor-rep
start bettor-skeptic pnpm -F @oracle/agents bettor-skeptic
start bettor-mirror pnpm -F @oracle/agents bettor-mirror
start worker pnpm -F @oracle/agents worker
sleep 2
echo "== Fuji stack up. Dashboard: pnpm -F @oracle/web dev  (logs in $LOGDIR) =="
echo "   Post a job:  curl -X POST http://localhost:8402/v1/control/task -H 'content-type: application/json' -d '{\"template\":\"task-a-slugify\"}'"
