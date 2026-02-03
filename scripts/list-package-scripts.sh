#!/usr/bin/env bash
# Phase A — Prove which package actually has scripts (no guessing).
# Run from repo root. Expected: packages/adjutorix-vscode has build, test, lint.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== ROOT scripts =="
if [ -f package.json ]; then
  python3 -c "import json,sys; d=json.load(sys.stdin); print(list((d.get('scripts') or {}).keys()))" < package.json
else
  echo "(no package.json at root)"
fi

echo ""
echo "== VSCODE package scripts =="
if [ -f packages/adjutorix-vscode/package.json ]; then
  python3 -c "import json,sys; d=json.load(sys.stdin); print(list((d.get('scripts') or {}).keys()))" < packages/adjutorix-vscode/package.json
else
  echo "(packages/adjutorix-vscode/package.json not found)"
fi
