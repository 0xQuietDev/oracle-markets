#!/usr/bin/env bash
# fuji-status.sh — concise live status of the ORACLE stack on Avalanche Fuji.
# Safe to run anytime: every probe is best-effort and never aborts the script,
# so it works whether or not the stack is up. Reads addresses/keys from
# .env.fuji. Honors FUJI_RPC override (else deployments/fuji.json rpcUrl).
#
# Prints: deployer/fleet AVAX balances (cast), current Fuji block,
#         server /healthz, /v1/control availability+canBet, latest task.
# chmod note: orchestrator will `chmod +x` this script.
set -uo pipefail   # NOT -e: probes must not kill the report
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; source .env.fuji 2>/dev/null || true; set +a

RPC="${FUJI_RPC:-$(node -e 'console.log(require("./deployments/fuji.json").rpcUrl)' 2>/dev/null || echo https://api.avax-test.network/ext/bc/C/rpc)}"
SERVER="${ORACLE_SERVER:-http://localhost:8402}"

addr_of() { cast wallet address --private-key "$1" 2>/dev/null || echo "?"; }
bal_of()  { # private-key-env-name label
  local key="${!1:-}" label="$2" a
  [ -n "$key" ] || { printf '  %-12s (no %s in .env.fuji)\n' "$label" "$1"; return; }
  a="$(addr_of "$key")"
  local wei avax
  wei="$(cast balance "$a" --rpc-url "$RPC" 2>/dev/null || echo "")"
  if [ -n "$wei" ]; then
    avax="$(cast from-wei "$wei" 2>/dev/null || echo "$wei")"
    printf '  %-12s %s  %s AVAX\n' "$label" "$a" "$avax"
  else
    printf '  %-12s %s  (balance unavailable — RPC?)\n' "$label" "$a"
  fi
}

echo "== ORACLE / Fuji status =="
echo "RPC:    $RPC"
echo "Server: $SERVER"

echo
echo "-- chain --"
BLOCK="$(cast block-number --rpc-url "$RPC" 2>/dev/null || echo "")"
if [ -n "$BLOCK" ]; then echo "  block: $BLOCK"; else echo "  block: (RPC unreachable)"; fi

echo
echo "-- AVAX balances --"
bal_of FUJI_DEPLOYER_KEY      deployer
bal_of FUJI_RELAYER_KEY       relayer
bal_of FUJI_WORKER_KEY        worker
bal_of FUJI_VALIDATOR_KEY     validator
bal_of FUJI_VENDOR_KEY        vendor
bal_of FUJI_BETTORREP_KEY     bettor-rep
bal_of FUJI_BETTORSKEPTIC_KEY bettor-skp
bal_of FUJI_BETTORMIRROR_KEY  bettor-mir
bal_of FUJI_CLIENT_KEY        client
bal_of FUJI_HUMAN_KEY         human
bal_of FUJI_REVENUE_KEY       revenue

echo
echo "-- server --"
HEALTH="$(curl -fsS --max-time 5 "$SERVER/healthz" 2>/dev/null || echo "")"
if [ -n "$HEALTH" ]; then
  echo "  /healthz: $HEALTH"
else
  echo "  /healthz: DOWN (no response from $SERVER)"
fi

CONTROL="$(curl -fsS --max-time 5 "$SERVER/v1/control" 2>/dev/null || echo "")"
if [ -n "$CONTROL" ]; then
  printf '  /v1/control: '
  printf '%s' "$CONTROL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let j=JSON.parse(s);console.log(`available=${j.available} canBet=${j.canBet}`+(j.reason?` reason=${j.reason}`:"")+` templates=${(j.templates||[]).map(t=>t.template).join(",")}`)}catch(e){console.log("(unparseable)")}});' 2>/dev/null || echo "(unparseable)"
else
  echo "  /v1/control: unavailable"
fi

echo
echo "-- latest task --"
TASKS="$(curl -fsS --max-time 5 "$SERVER/v1/tasks" 2>/dev/null || echo "")"
if [ -n "$TASKS" ]; then
  printf '%s' "$TASKS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let a=JSON.parse(s);if(!Array.isArray(a)||!a.length){console.log("  (no tasks yet)");return}let t=a[a.length-1];console.log(`  taskId=${t.taskId} state=${t.state} yesPool=${t.yesPool} noPool=${t.noPool}`);console.log(`  (${a.length} task(s) total)`)}catch(e){console.log("  (unparseable tasks response)")}});' 2>/dev/null || echo "  (unparseable tasks response)"
else
  echo "  (server unavailable)"
fi
echo
