#!/usr/bin/env bash
# Phase 1 proof — Prove the agent on the port is the correct one (protocol 1, job.run).
# Run from repo root. Pass: result.protocol == 1 and result.methods includes "job.run".
set -euo pipefail

PORT="${ADJUTORIX_PORT:-7337}"
BASE="http://127.0.0.1:$PORT"
TOKEN="${ADJUTORIX_TOKEN:-}"

CURL_AUTH=()
if [ -n "$TOKEN" ]; then
  CURL_AUTH=(-H "Authorization: Bearer $TOKEN")
fi

echo "==> Capabilities (expect protocol: 1, methods including job.run)"
curl -s "${CURL_AUTH[@]}" -H "Content-Type: application/json" "$BASE/rpc" \
  -d '{"jsonrpc":"2.0","id":1,"method":"capabilities","params":{}}' | python3 -m json.tool

echo ""
echo "If protocol is not 1 or methods does not include job.run, you are not running the updated agent."
