#!/usr/bin/env bash
# Phase 5 — One-command health probe when it "glitches" again.
# Run from repo root. If this fails, agent is dead or replaced. If it works, agent is fine.
set -euo pipefail

PORT="${ADJUTORIX_PORT:-7337}"
BASE="http://127.0.0.1:$PORT"
TOKEN="${ADJUTORIX_TOKEN:-}"
LAST_N_LOGS="${1:-50}"

CURL_AUTH=()
if [ -n "$TOKEN" ]; then
  CURL_AUTH=(-H "Authorization: Bearer $TOKEN")
fi

echo "==> debug.snapshot (last_n_logs=$LAST_N_LOGS)"
curl -s "${CURL_AUTH[@]}" -H "Content-Type: application/json" "$BASE/rpc" \
  -d '{"jsonrpc":"2.0","id":9,"method":"debug.snapshot","params":{"last_n_logs":'"$LAST_N_LOGS"'}}' | python3 -m json.tool
