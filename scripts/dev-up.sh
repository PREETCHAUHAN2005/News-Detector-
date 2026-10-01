#!/usr/bin/env bash
# dev-up.sh — reliably bring the Next.js dev server back up in the flaky 4GB-cgroup sandbox.
# Usage: bash scripts/dev-up.sh [max_tries]
# Protocol: restart detached → curl-warm routes → verify health (retry up to N times).
cd /home/z/my-project
TRIES=${1:-4}
rm -f /tmp/dev-exit.log
for i in $(seq 1 "$TRIES"); do
  if curl -s -m 3 -o /dev/null http://localhost:3000/api/health 2>/dev/null; then
    echo "[dev-up] already healthy"; exit 0
  fi
  setsid bash -c 'bun run dev >> /home/z/my-project/dev.log 2>&1; echo "exit=$?" >> /tmp/dev-exit.log' < /dev/null &
  sleep 9
  # warm the common routes so Turbopack compiles settle before any browser hit
  for p in "/api/health" "/api/auth/session" "/api/analyses?pageSize=1" "/api/analytics?days=7" "/api/appeals" "/api/audit?pageSize=1" "/api/sources" "/api/model-card" "/"; do
    curl -s -m 25 -o /dev/null "http://localhost:3000$p" 2>/dev/null
  done
  if curl -s -m 3 -o /dev/null http://localhost:3000/api/health 2>/dev/null; then
    echo "[dev-up] healthy after try $i"; exit 0
  fi
  echo "[dev-up] try $i failed$(cat /tmp/dev-exit.log 2>/dev/null | tr '\n' ' ')"
  rm -f /tmp/dev-exit.log
done
echo "[dev-up] FAILED after $TRIES tries" >&2
exit 1
