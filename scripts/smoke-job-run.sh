#!/usr/bin/env bash
# Phase 2 — Smoke test job.run outside the UI (remove webview as a variable).
# Run from repo root. Pass: result has job_id; then job.status returns state.
# Usage: ./scripts/smoke-job-run.sh [job_id]
#   No arg: run job.run and print job_id.
#   With job_id: run job.status for that job.
set -euo pipefail

PORT="${ADJUTORIX_PORT:-7337}"
BASE="http://127.0.0.1:$PORT"
TOKEN="${ADJUTORIX_TOKEN:-}"
CWD="${PWD:-.}"

CURL_AUTH=()
if [ -n "$TOKEN" ]; then
  CURL_AUTH=(-H "Authorization: Bearer $TOKEN")
fi

if [ $# -eq 0 ]; then
  echo "==> job.run (expect result.job_id)"
  curl -s "${CURL_AUTH[@]}" -H "Content-Type: application/json" "$BASE/rpc" \
    -d '{"jsonrpc":"2.0","id":2,"method":"job.run","params":{"kind":"check","cwd":"'"$CWD"'","confirm":false}}' | python3 -m json.tool
  echo ""
  echo "Then: ./scripts/smoke-job-run.sh <job_id>"
else
  JOB_ID="$1"
  echo "==> job.status for $JOB_ID"
  curl -s "${CURL_AUTH[@]}" -H "Content-Type: application/json" "$BASE/rpc" \
    -d '{"jsonrpc":"2.0","id":3,"method":"job.status","params":{"id":"'"$JOB_ID"'"}}' | python3 -m json.tool
fi
