#!/usr/bin/env bash
# Start the ORACLE stack against Avalanche Fuji (after scripts/deploy-fuji.sh).
# Real chain, real EIP-3009 USDC settlements via our own facilitator (relayer),
# canonical ERC-8004 registries, real Gemini agents.
#
# HARDENED FOR LIVE DEMO (WS-3): every long-running daemon runs under a
# restart-on-exit supervisor (see supervise() below) so a flaky daemon or a
# transient Fuji RPC blip does not silently end the demo. The one-shot
# deploy/fund steps are NOT supervised (they are expected to exit 0).
#
# chmod note: orchestrator will `chmod +x` this script.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; source .env.fuji; [ -f .env.gemini ] && source .env.gemini; set +a
LOGDIR="${LOGDIR:-/tmp/oracle-fuji-logs}"; mkdir -p "$LOGDIR"; : > "$LOGDIR/pids"

export ORACLE_DEPLOYMENT="$PWD/deployments/fuji.json"
export TASK_REWARD_USDC="${TASK_REWARD_USDC:-10}"   # modest rewards on testnet

# --- RPC selection -----------------------------------------------------------
# FUJI_RPC overrides the RPC used by *scripts* (cast calls in fuji-status.sh,
# fuji-task.sh, etc.). If unset we fall back to the rpcUrl baked into
# deployments/fuji.json (read here purely for the script-side default).
# FUJI_RPC_FALLBACK is an OPTIONAL secondary endpoint: if set, it is exported so
# the chain clients in agents/lib (out of WS-3 scope) can retry against it when
# the primary errors. We only make the env available here; the actual client
# retry logic lives in agents/src/lib/chain.ts.
_DEP_RPC="$(node -e 'console.log(require("./deployments/fuji.json").rpcUrl)' 2>/dev/null || true)"
export FUJI_RPC="${FUJI_RPC:-${_DEP_RPC:-https://api.avax-test.network/ext/bc/C/rpc}}"
if [ -n "${FUJI_RPC_FALLBACK:-}" ]; then
  export FUJI_RPC_FALLBACK
  echo "RPC: primary=$FUJI_RPC  fallback=$FUJI_RPC_FALLBACK"
else
  echo "RPC: primary=$FUJI_RPC  (no FUJI_RPC_FALLBACK set)"
fi

# per-role signer keys (keyFor reads <ROLE>_KEY)
export WORKER_KEY="$FUJI_WORKER_KEY" VALIDATOR_KEY="$FUJI_VALIDATOR_KEY" \
  BETTOR_REP_KEY="$FUJI_BETTORREP_KEY" BETTOR_SKEPTIC_KEY="$FUJI_BETTORSKEPTIC_KEY" \
  BETTOR_MIRROR_KEY="$FUJI_BETTORMIRROR_KEY" VENDOR_KEY="$FUJI_VENDOR_KEY" \
  CLIENT_KEY="$FUJI_CLIENT_KEY" HUMAN_KEY="$FUJI_HUMAN_KEY"

# x402: our own facilitator on Fuji (relayer settles real EIP-3009 transfers)
export FACILITATOR_RELAYER_KEY="$FUJI_RELAYER_KEY"
export X402_FACILITATOR="http://localhost:8405"
export ORACLE_REVENUE_WALLET="$(cast wallet address --private-key "$FUJI_REVENUE_KEY")"

# --- supervisor --------------------------------------------------------------
# supervise NAME CMD...   Launches CMD under a bash loop that re-launches it if
# it dies, with a short backoff and a cap (MAX_RESTARTS). Each (re)start is
# logged to the daemon's own logfile. We track the SUPERVISOR pid in
# $LOGDIR/pids (kept format: "<pid> <name>") so stop-all can kill the loop; the
# loop installs a trap so killing the supervisor also kills its current child.
MAX_RESTARTS="${MAX_RESTARTS:-50}"     # cap re-launch attempts per daemon
RESTART_BACKOFF="${RESTART_BACKOFF:-2}" # seconds between restarts

supervise() { # name cmd...
  local name="$1"; shift
  local log="$LOGDIR/$name.log"
  (
    # The supervisor runs in its own subshell. On TERM/INT we kill the whole
    # process group of the supervisor (negative pid) so the child dies too.
    child=""
    trap 'if [ -n "$child" ]; then kill "$child" 2>/dev/null; pkill -P "$child" 2>/dev/null; fi; exit 0' TERM INT
    n=0
    while :; do
      n=$((n + 1))
      printf '[supervisor] (%s) start attempt %d/%d at %s\n' \
        "$name" "$n" "$MAX_RESTARTS" "$(date -u +%FT%TZ)" >> "$log"
      "$@" >> "$log" 2>&1 &
      child=$!
      wait "$child"; rc=$?
      child=""
      printf '[supervisor] (%s) exited rc=%d after %d/%d at %s\n' \
        "$name" "$rc" "$n" "$MAX_RESTARTS" "$(date -u +%FT%TZ)" >> "$log"
      if [ "$n" -ge "$MAX_RESTARTS" ]; then
        printf '[supervisor] (%s) restart cap reached (%d); giving up\n' \
          "$name" "$MAX_RESTARTS" >> "$log"
        break
      fi
      sleep "$RESTART_BACKOFF"
    done
  ) &
  echo "$! $name" >> "$LOGDIR/pids"
  echo "started $name (supervisor pid $!)"
}

wait_port() { for _ in $(seq "${3:-60}"); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; }; sleep 0.5; done; echo "FATAL: $2 (port $1) down — see $LOGDIR/$2.log" >&2; exit 1; }

for port in 8402 8403 8404 8405; do
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && { exec 3>&- 3<&-; echo "FATAL: port $port in use — scripts/stop-all.sh first" >&2; exit 1; }
done

echo "== ORACLE on Fuji ($(node -e 'console.log(require("./deployments/fuji.json").contracts.oracleCore)')) =="
supervise facilitator pnpm -F @oracle/server facilitator; wait_port 8405 facilitator
supervise server pnpm -F @oracle/server start; wait_port 8402 server
supervise vendor pnpm -F @oracle/agents vendor; wait_port 8403 vendor
supervise validator pnpm -F @oracle/agents validator; wait_port 8404 validator
supervise bettor-rep pnpm -F @oracle/agents bettor-rep
supervise bettor-skeptic pnpm -F @oracle/agents bettor-skeptic
supervise bettor-mirror pnpm -F @oracle/agents bettor-mirror
supervise worker pnpm -F @oracle/agents worker
sleep 2
echo "== Fuji stack up (supervised; cap=$MAX_RESTARTS restarts). Dashboard: pnpm -F @oracle/web dev  (logs in $LOGDIR) =="
echo "   Status:      scripts/fuji-status.sh"
echo "   Post a job:  scripts/fuji-task.sh task-a-slugify"
