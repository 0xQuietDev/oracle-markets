#!/usr/bin/env bash
# Start ONLY the agent fleet against Fuji (server is assumed already running on
# :8402). Each daemon is launched detached (nohup) and staggered to avoid a
# memory/RPC spike from booting 7 Mastra/Gemini processes at once. Exits fast.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; source .env.fuji; [ -f .env.gemini ] && source .env.gemini; set +a
LOG="${LOGDIR:-/tmp/oracle-fuji-logs}"; mkdir -p "$LOG"

export ORACLE_DEPLOYMENT="$PWD/deployments/fuji.json"
export TASK_REWARD_USDC="${TASK_REWARD_USDC:-10}"
export WORKER_KEY="$FUJI_WORKER_KEY" VALIDATOR_KEY="$FUJI_VALIDATOR_KEY" \
  BETTOR_REP_KEY="$FUJI_BETTORREP_KEY" BETTOR_SKEPTIC_KEY="$FUJI_BETTORSKEPTIC_KEY" \
  BETTOR_MIRROR_KEY="$FUJI_BETTORMIRROR_KEY" VENDOR_KEY="$FUJI_VENDOR_KEY" \
  CLIENT_KEY="$FUJI_CLIENT_KEY" HUMAN_KEY="$FUJI_HUMAN_KEY"
export FACILITATOR_RELAYER_KEY="$FUJI_RELAYER_KEY" X402_FACILITATOR="http://localhost:8405"
export ORACLE_REVENUE_WALLET="$(cast wallet address --private-key "$FUJI_REVENUE_KEY")"

launch() { # name pkg script
  nohup pnpm -F "$2" "$3" >"$LOG/$1.log" 2>&1 &
  echo "$! $1" >> "$LOG/pids"
  echo "started $1 (pid $!)"
  disown || true
}

echo "== Fuji agents (server must be up on :8402) =="
launch facilitator   @oracle/server facilitator; sleep 4
launch vendor        @oracle/agents vendor;       sleep 3
launch validator     @oracle/agents validator;    sleep 3
launch bettor-rep    @oracle/agents bettor-rep;   sleep 3
launch bettor-skeptic @oracle/agents bettor-skeptic; sleep 3
launch bettor-mirror @oracle/agents bettor-mirror; sleep 3
launch worker        @oracle/agents worker
echo "== fleet launched; logs in $LOG =="
