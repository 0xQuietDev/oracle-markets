#!/usr/bin/env bash
# Full e2e: boot stack, run Task A (expect YES/R2/100) + Task B (expect NO/R3/<=50),
# assert x402 settlements and trust tuple. Exit 0 = green.
set -euo pipefail
cd "$(dirname "$0")/.."
LOGDIR="${LOGDIR:-/tmp/oracle-logs}"
export LOGDIR

cleanup() { bash scripts/stop-all.sh >/dev/null 2>&1 || true; }
trap cleanup EXIT

bash scripts/stop-all.sh >/dev/null 2>&1 || true
bash scripts/run-all.sh

echo "== demo: Task A + Task B =="
pnpm -F @oracle/agents demo -- --both --assert 2>&1 | tee "$LOGDIR/demo.log"

echo "== post-assertions =="
SETTLES=$(grep -c 'settled .* units .* tx=0x' "$LOGDIR/facilitator.log" || true)
echo "facilitator settle hits: $SETTLES"
if [ "$SETTLES" -lt 2 ]; then echo "FAIL: expected >=2 x402 settlements"; exit 1; fi

TASKS_JSON=$(curl -sf http://localhost:8402/v1/tasks)
SETTLED=$(echo "$TASKS_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d);console.log(t.filter(x=>(x.state||x.STATE)==="Settled").length)})')
echo "settled tasks: $SETTLED"
if [ "$SETTLED" -lt 2 ]; then echo "FAIL: expected 2 settled tasks"; exit 1; fi

echo "E2E GREEN"
