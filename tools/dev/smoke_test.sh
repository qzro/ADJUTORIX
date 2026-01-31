#!/usr/bin/env bash
set -euo pipefail

# ADJUTORIX Smoke Test
# Verifies that core components start and basic workflows work.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="$ROOT_DIR/packages/adjutorix-agent"
EXT_DIR="$ROOT_DIR/packages/adjutorix-vscode"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "[SMOKE] $*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

info "Checking required commands..."
need_cmd python3
need_cmd node
need_cmd npm
need_cmd git

# -----------------------------
# Agent Test
# -----------------------------

info "Testing agent startup..."

cd "$AGENT_DIR" || die "Agent directory not found"

if [[ ! -d .venv ]]; then
  info "Creating virtual environment..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

pip install -q --upgrade pip
pip install -q -e . || die "Failed to install agent"

info "Starting agent (background)..."

python -m adjutorix_agent.server.app >/tmp/adjutorix_agent.log 2>&1 &
AGENT_PID=$!

sleep 3

if ! kill -0 "$AGENT_PID" >/dev/null 2>&1; then
  cat /tmp/adjutorix_agent.log || true
  die "Agent failed to start"
fi

info "Agent running (PID=$AGENT_PID)"

# -----------------------------
# Extension Test
# -----------------------------

info "Testing VS Code extension build..."

cd "$EXT_DIR" || die "Extension directory not found"

if [[ ! -d node_modules ]]; then
  info "Installing extension dependencies..."
  npm ci
fi

npm run build >/tmp/adjutorix_ext_build.log 2>&1 || {
  cat /tmp/adjutorix_ext_build.log
  die "Extension build failed"
}

info "Extension build OK"

# -----------------------------
# RPC Connectivity Test
# -----------------------------

info "Testing agent HTTP endpoint..."

curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1 || {
  cat /tmp/adjutorix_agent.log || true
  die "Agent health endpoint not responding"
}

info "Agent health check OK"

# -----------------------------
# Cleanup
# -----------------------------

info "Stopping agent..."

kill "$AGENT_PID" >/dev/null 2>&1 || true
wait "$AGENT_PID" 2>/dev/null || true

deactivate || true

info "Smoke test PASSED"

echo
echo "---------------------------------------"
echo "ADJUTORIX environment is functional."
echo "---------------------------------------"
