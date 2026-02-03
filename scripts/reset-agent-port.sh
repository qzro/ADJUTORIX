#!/usr/bin/env bash
# Phase 0 — Hard reset the agent port (eliminate split-brain).
# Run from repo root. Pass condition: last lsof shows nothing.
set -euo pipefail

PORT="${ADJUTORIX_PORT:-7337}"

echo "==> Who owns port $PORT?"
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true

echo "==> Kill anything on $PORT (force)."
PIDS=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)
if [ -n "${PIDS:-}" ]; then
  echo "Killing: $PIDS"
  kill -9 $PIDS || true
fi

echo "==> Confirm port is free."
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true
echo "OK: port $PORT is clean."
