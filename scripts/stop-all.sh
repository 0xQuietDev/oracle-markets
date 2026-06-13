#!/usr/bin/env bash
LOGDIR="${LOGDIR:-/tmp/oracle-logs}"
if [ -f "$LOGDIR/pids" ]; then
  while read -r pid name; do
    kill "$pid" 2>/dev/null && echo "stopped $name ($pid)" || true
    pkill -P "$pid" 2>/dev/null || true
  done < "$LOGDIR/pids"
  : > "$LOGDIR/pids"
fi
pkill -x anvil 2>/dev/null || true
# NB: keep patterns narrow — they must never match an interactive shell that merely
# mentions @oracle/* on its command line.
pkill -f "tsx src/(index|facilitator-local|worker|validator|vendor|bettor-)" 2>/dev/null || true
# Belt and braces: free every stack port, killing any orphaned listener.
for port in 8402 8403 8404 8405 8545 5173; do
  fuser -k -TERM "$port/tcp" 2>/dev/null || true
done
sleep 0.5
exit 0
