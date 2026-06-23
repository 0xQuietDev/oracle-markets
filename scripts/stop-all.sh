#!/usr/bin/env bash
# Stop the ORACLE stack — both the local (anvil) stack and the Fuji stack.
# Kills supervisor loops (WS-3 run-fuji.sh), their children, and frees ports.
# Narrow by design: never matches an interactive shell that merely mentions
# @oracle/* on its command line, never kills unrelated processes.
# chmod note: orchestrator will `chmod +x` this script.

# Stop every daemon tracked in a pids file. For the Fuji stack the tracked pid
# is the *supervisor loop*; TERM-ing it fires the supervisor's trap which kills
# the current child too. We also pkill -P as belt-and-braces for the local
# stack (where the tracked pid is the daemon itself, parent of e.g. tsx).
stop_pidfile() { # logdir
  local logdir="$1" pidfile="$1/pids"
  [ -f "$pidfile" ] || return 0
  # First pass: TERM supervisors/daemons + their direct children.
  while read -r pid name; do
    [ -n "${pid:-}" ] || continue
    pkill -P "$pid" 2>/dev/null || true   # children (tsx under pnpm, child under supervisor)
    kill "$pid" 2>/dev/null && echo "stopped $name ($pid)" || true
  done < "$pidfile"
  sleep 0.5
  # Second pass: KILL anything that ignored TERM (supervisor loop re-spawned a
  # child between the pkill and the kill, etc.).
  while read -r pid name; do
    [ -n "${pid:-}" ] || continue
    pkill -9 -P "$pid" 2>/dev/null || true
    kill -9 "$pid" 2>/dev/null || true
  done < "$pidfile"
  : > "$pidfile"
}

# Local (anvil) stack and Fuji stack default log dirs (+ any caller-supplied one).
stop_pidfile "${LOGDIR:-/tmp/oracle-logs}"
stop_pidfile "/tmp/oracle-logs"
stop_pidfile "/tmp/oracle-fuji-logs"

pkill -x anvil 2>/dev/null || true
# NB: keep patterns narrow — they must never match an interactive shell that merely
# mentions @oracle/* on its command line.
pkill -f "tsx src/(index|facilitator-local|worker|validator|vendor|bettor-)" 2>/dev/null || true
# Belt and braces: free every stack port, killing any orphaned listener.
# 8402 server, 8403 vendor, 8404 validator, 8405 facilitator, 8545 anvil, 5173 web.
for port in 8402 8403 8404 8405 8545 5173; do
  fuser -k -TERM "$port/tcp" 2>/dev/null || true
done
sleep 0.5
exit 0
