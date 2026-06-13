#!/usr/bin/env bash
# Boots the full local ORACLE stack on anvil. PROFILE=e2e|local|demo (default e2e).
# Logs to $LOGDIR (default /tmp/oracle-logs). PIDs to $LOGDIR/pids.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
export PATH="$HOME/.foundry/bin:$PATH"
PROFILE="${PROFILE:-e2e}"
LOGDIR="${LOGDIR:-/tmp/oracle-logs}"
mkdir -p "$LOGDIR"
: > "$LOGDIR/pids"

ANVIL0_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
REVENUE_WALLET=0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f   # anvil 8

start() { # name cmd...
  local name="$1"; shift
  ( "$@" >"$LOGDIR/$name.log" 2>&1 ) &
  echo "$! $name" >> "$LOGDIR/pids"
  echo "started $name (pid $!)"
}

wait_port() { # port name [tries]
  local tries="${3:-60}"
  for _ in $(seq "$tries"); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then exec 3>&- 3<&-; return 0; fi
    sleep 0.5
  done
  echo "FATAL: $2 (port $1) never came up — see $LOGDIR/$2.log" >&2
  exit 1
}

echo "== anvil =="
for port in 8545 8402 8403 8404 8405; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "FATAL: port $port already in use — run scripts/stop-all.sh first" >&2
    exit 1
  fi
done
start anvil anvil --block-time 1 --silent
wait_port 8545 anvil

echo "== deploy (PROFILE=$PROFILE) =="
(cd contracts && PROFILE="$PROFILE" forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast --private-key "$ANVIL0_KEY" \
  >"$LOGDIR/deploy.log" 2>&1)
grep -q '"oracleCore": "0x' deployments/local.json

echo "== register agents =="
pnpm -F @oracle/agents register >"$LOGDIR/register.log" 2>&1

echo "== services =="
start facilitator pnpm -F @oracle/server facilitator
wait_port 8405 facilitator
ORACLE_REVENUE_WALLET="$REVENUE_WALLET" start server pnpm -F @oracle/server start
wait_port 8402 server
start vendor pnpm -F @oracle/agents vendor
wait_port 8403 vendor
start validator pnpm -F @oracle/agents validator
wait_port 8404 validator
start bettor-rep pnpm -F @oracle/agents bettor-rep
start bettor-skeptic pnpm -F @oracle/agents bettor-skeptic
start bettor-mirror pnpm -F @oracle/agents bettor-mirror
start worker pnpm -F @oracle/agents worker
sleep 2

echo "== stack up; logs in $LOGDIR =="
