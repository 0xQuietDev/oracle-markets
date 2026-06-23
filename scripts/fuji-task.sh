#!/usr/bin/env bash
# fuji-task.sh [template] — convenience: POST /v1/control/task and print the
# returned taskId + txHash + a Snowtrace link. Default template task-a-slugify.
#
# Usage:   scripts/fuji-task.sh                 # task-a-slugify
#          scripts/fuji-task.sh task-b-nextbusinessday
# Env:     ORACLE_SERVER (default http://localhost:8402)
# chmod note: orchestrator will `chmod +x` this script.
set -euo pipefail
cd "$(dirname "$0")/.."

TEMPLATE="${1:-task-a-slugify}"
SERVER="${ORACLE_SERVER:-http://localhost:8402}"

echo "POST $SERVER/v1/control/task  template=$TEMPLATE"
RESP="$(curl -fsS --max-time 60 -X POST "$SERVER/v1/control/task" \
  -H 'content-type: application/json' \
  -d "{\"template\":\"$TEMPLATE\"}" 2>/dev/null || true)"

if [ -z "$RESP" ]; then
  echo "FATAL: no response — is the server up? (scripts/fuji-status.sh)" >&2
  exit 1
fi

# Parse + present. Non-zero exit if the server reported an error.
printf '%s' "$RESP" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try{j=JSON.parse(s)}catch(e){console.error("FATAL: unparseable response: "+s);process.exit(1)}
  if(j.error){console.error(`FATAL: ${j.error}${j.message?": "+j.message:""}`);process.exit(1)}
  const hash=j.txHash||j.tx||"";
  console.log(`ok        : ${j.ok===true}`);
  console.log(`taskId    : ${j.taskId}`);
  console.log(`txHash    : ${hash}`);
  if(j.deadline) console.log(`deadline  : ${j.deadline}`);
  if(hash) console.log(`snowtrace : https://testnet.snowtrace.io/tx/${hash}`);
});'
