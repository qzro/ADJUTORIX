#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="$ROOT_DIR/packages/adjutorix-agent"
VENV_DIR="$ROOT_DIR/.venv"

# -------- helpers --------

die() { echo "ERROR: $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

# -------- checks --------

need_cmd python3

if [[ ! -d "$AGENT_DIR" ]]; then
  die "Agent package not found: $AGENT_DIR"
fi

# -------- venv --------

if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating venv: $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python -m pip install -U pip setuptools wheel >/dev/null

# Install agent editable if needed
if ! python -c "import adjutorix_agent" >/dev/null 2>&1; then
  echo "Installing adjutorix-agent (editable)..."
  (cd "$AGENT_DIR" && pip install -e .)
fi

# -------- runtime config --------

HOST="${ADJUTORIX_HOST:-127.0.0.1}"
PORT="${ADJUTORIX_PORT:-7337}"
LOG_DIR="${ADJUTORIX_LOG_DIR:-$ROOT_DIR/runtime/logs}"
PROFILE="${ADJUTORIX_PROFILE:-$ROOT_DIR/runtime/profiles/ollama.yaml}"

mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/agent.$(date +%Y%m%d_%H%M%S).log"

echo "=============================="
echo "ADJUTORIX Agent Runner"
echo "Root:   $ROOT_DIR"
echo "Host:   $HOST"
echo "Port:   $PORT"
echo "Profile:$PROFILE"
echo "Log:    $LOG_FILE"
echo "=============================="
echo

export ADJUTORIX_HOST="$HOST"
export ADJUTORIX_PORT="$PORT"
export ADJUTORIX_PROFILE="$PROFILE"
export ADJUTORIX_ROOT="$ROOT_DIR"

# -------- port in use --------

if lsof -i ":$PORT" -t >/dev/null 2>&1; then
  echo "Port $PORT is in use. Stopping existing process..."
  lsof -i ":$PORT" -t | xargs kill 2>/dev/null || true
  sleep 1
fi

# -------- run --------

cd "$AGENT_DIR"

# Prefer console logs + file capture
python -m adjutorix_agent.server.app \
  --host "$HOST" \
  --port "$PORT" \
  --profile "$PROFILE" \
  2>&1 | tee "$LOG_FILE"
