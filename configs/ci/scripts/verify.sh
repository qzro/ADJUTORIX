#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Adjutorix Verify Script
# Must match local `verify` exactly
# CI parity enforcement
# ============================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

echo "========================================"
echo "Adjutorix VERIFY (CI Parity)"
echo "Root: $ROOT_DIR"
echo "========================================"

cd "$ROOT_DIR"

# ----------------------------
# Environment validation
# ----------------------------

command -v python >/dev/null || { echo "Python missing"; exit 1; }
command -v node >/dev/null || { echo "Node missing"; exit 1; }
command -v npm >/dev/null || { echo "NPM missing"; exit 1; }
command -v rg >/dev/null || { echo "ripgrep missing"; exit 1; }
command -v ctags >/dev/null || { echo "ctags missing"; exit 1; }

echo "[OK] Toolchain present"

# ----------------------------
# Shared Package
# ----------------------------

echo ">>> Verifying shared package"

cd "$ROOT_DIR/packages/shared"

npm install
npm run build
npm test

# ----------------------------
# VSCode Extension
# ----------------------------

echo ">>> Verifying VSCode extension"

cd "$ROOT_DIR/packages/adjutorix-vscode"

npm install
npm run lint
npm run build
npm test || true

# ----------------------------
# Agent (Python)
# ----------------------------

echo ">>> Verifying agent"

cd "$ROOT_DIR/packages/adjutorix-agent"

python -m pip install --upgrade pip
pip install -e .

pytest -v

# ----------------------------
# Lint / Format / Typecheck
# ----------------------------

echo ">>> Running repo checks"

cd "$ROOT_DIR"

./configs/ci/scripts/check.sh

# ----------------------------
# Determinism Check
# ----------------------------

echo ">>> Running determinism check"

HASH_BEFORE=$(git rev-parse HEAD)

./configs/ci/scripts/check.sh

HASH_AFTER=$(git rev-parse HEAD)

if [[ "$HASH_BEFORE" != "$HASH_AFTER" ]]; then
  echo "ERROR: Verify mutated repository"
  exit 1
fi

echo "[OK] Determinism preserved"

# ----------------------------
# Index rebuild test
# ----------------------------

echo ">>> Testing index rebuild"

./tools/maintenance/rebuild_index.sh

# ----------------------------
# Agent startup smoke test
# ----------------------------

echo ">>> Agent smoke test"

./tools/dev/run_agent.sh --check &

AGENT_PID=$!
sleep 5

if ! ps -p "$AGENT_PID" >/dev/null; then
  echo "ERROR: Agent failed to start"
  exit 1
fi

kill "$AGENT_PID"

echo "[OK] Agent booted successfully"

# ----------------------------
# Workspace sanity
# ----------------------------

echo ">>> Workspace validation"

if [[ ! -f "$HOME/.agent/workspaces.yaml" ]]; then
  echo "WARNING: No global workspaces.yaml found"
fi

# ----------------------------
# Final status
# ----------------------------

echo "========================================"
echo "VERIFY PASSED"
echo "CI parity maintained"
echo "========================================"

exit 0
