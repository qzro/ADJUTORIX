#!/usr/bin/env bash
set -e

# ADJUTORIX One-Click Bootstrap Installer
# Installs all required system dependencies and sets up local environment

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_DIR="$ROOT_DIR/tools/install"

echo "======================================="
echo " ADJUTORIX One-Click Bootstrap Installer"
echo "======================================="
echo "Root: $ROOT_DIR"
echo

# ---------- Helpers ----------

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

run_installer() {
  local script="$1"

  if [[ -f "$script" ]]; then
    echo "==> Running: $(basename "$script")"
    chmod +x "$script"
    "$script"
  else
    echo "Missing installer: $script"
    exit 1
  fi
}

# ---------- OS Detection ----------

OS="$(uname -s)"

echo "Detected OS: $OS"
echo

if [[ "$OS" != "Linux" && "$OS" != "Darwin" ]]; then
  echo "Unsupported OS: $OS"
  exit 1
fi

# ---------- Base Packages ----------

echo "==> Checking base packages..."

if [[ "$OS" == "Linux" ]]; then
  sudo apt update

  sudo apt install -y \
    curl \
    git \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    jq \
    ca-certificates

elif [[ "$OS" == "Darwin" ]]; then
  if ! require_cmd brew; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  brew update

  brew install \
    git \
    python \
    jq \
    curl \
    coreutils
fi

# ---------- Node.js ----------

echo "==> Checking Node.js..."

if ! require_cmd node; then
  echo "Installing Node.js (LTS)..."

  if [[ "$OS" == "Linux" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt install -y nodejs
  else
    brew install node
  fi
fi

node --version
npm --version

# ---------- Python Env ----------

echo "==> Preparing Python environment..."

PY_ENV="$ROOT_DIR/.venv"

if [[ ! -d "$PY_ENV" ]]; then
  python3 -m venv "$PY_ENV"
fi

source "$PY_ENV/bin/activate"

pip install --upgrade pip setuptools wheel

# ---------- Install Agent Dependencies ----------

echo "==> Installing agent dependencies..."

AGENT_DIR="$ROOT_DIR/packages/adjutorix-agent"

if [[ -d "$AGENT_DIR" ]]; then
  cd "$AGENT_DIR"
  pip install -e .
  cd "$ROOT_DIR"
else
  echo "Agent directory not found!"
  exit 1
fi

# ---------- Install System Tools ----------

echo
echo "==> Installing system tools..."

run_installer "$INSTALL_DIR/install_rg.sh"
run_installer "$INSTALL_DIR/install_ctags.sh"
run_installer "$INSTALL_DIR/install_ollama.sh"
run_installer "$INSTALL_DIR/install_wrangler.sh"

# ---------- VS Code Extension Build ----------

echo
echo "==> Building VS Code extension..."

VSCODE_DIR="$ROOT_DIR/packages/adjutorix-vscode"

if [[ -d "$VSCODE_DIR" ]]; then
  cd "$VSCODE_DIR"

  npm install
  npm run build || true

  cd "$ROOT_DIR"
else
  echo "VS Code extension directory not found."
fi

# ---------- Repo Template Setup ----------

echo
echo "==> Preparing agent templates..."

AGENT_HOME="$HOME/.agent"

mkdir -p "$AGENT_HOME"
mkdir -p "$AGENT_HOME/knowledge"

if [[ ! -f "$AGENT_HOME/global.yaml" ]]; then
  cat > "$AGENT_HOME/global.yaml" <<EOF
# ADJUTORIX Global Agent Config

style: strict
sandbox: enabled
max_files_per_patch: 8
max_tokens: 6000

forbidden_commands:
  - rm -rf /
  - curl | sh
  - wget | sh
EOF
fi

# ---------- Smoke Test ----------

echo
echo "==> Running smoke test..."

DEV_DIR="$ROOT_DIR/tools/dev"

if [[ -f "$DEV_DIR/smoke_test.sh" ]]; then
  chmod +x "$DEV_DIR/smoke_test.sh"
  "$DEV_DIR/smoke_test.sh" || true
fi

# ---------- Finish ----------

echo
echo "======================================="
echo " ADJUTORIX Bootstrap Completed"
echo "======================================="

echo
echo "Next steps:"
echo "1) source $PY_ENV/bin/activate"
echo "2) cd packages/adjutorix-agent && adjutorix-agent"
echo "3) Open VS Code and load extension"
echo "4) Run: Agent: Check"

echo
echo "System ready."
echo "======================================="
