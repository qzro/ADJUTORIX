#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Adjutorix CHECK Script
# Read-only validation pipeline
# format / lint / type / test / security
# ============================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

echo "========================================"
echo "Adjutorix CHECK (Validation Pipeline)"
echo "Root: $ROOT_DIR"
echo "========================================"

cd "$ROOT_DIR"

FAIL=0

# ----------------------------
# Environment validation
# ----------------------------

echo ">>> Checking environment"

command -v python >/dev/null || { echo "[ERR] Python missing"; FAIL=1; }
command -v node >/dev/null || { echo "[ERR] Node missing"; FAIL=1; }
command -v npm >/dev/null || { echo "[ERR] NPM missing"; FAIL=1; }
command -v rg >/dev/null || { echo "[ERR] ripgrep missing"; FAIL=1; }
command -v ctags >/dev/null || { echo "[ERR] ctags missing"; FAIL=1; }

if [[ $FAIL -ne 0 ]]; then
  echo "[FATAL] Missing dependencies"
  exit 1
fi

echo "[OK] Toolchain present"

# ----------------------------
# Python checks
# ----------------------------

echo ">>> Python checks"

if command -v ruff >/dev/null; then
  ruff check . || FAIL=1
fi

if command -v black >/dev/null; then
  black . --check || FAIL=1
fi

if command -v isort >/dev/null; then
  isort . --check-only || FAIL=1
fi

if command -v mypy >/dev/null; then
  mypy packages/adjutorix-agent || FAIL=1
fi

# ----------------------------
# TypeScript / JS checks
# ----------------------------

echo ">>> TypeScript / JS checks"

if [[ -f "package.json" ]]; then
  npm install

  if npm run | grep -q "lint"; then
    npm run lint || FAIL=1
  fi

  if npm run | grep -q "typecheck"; then
    npm run typecheck || FAIL=1
  fi

  if npm run | grep -q "build"; then
    npm run build || FAIL=1
  fi
fi

# ----------------------------
# Shared package checks
# ----------------------------

if [[ -d "packages/shared" ]]; then
  echo ">>> Checking shared package"

  cd "$ROOT_DIR/packages/shared"

  npm install

  if npm run | grep -q "lint"; then
    npm run lint || FAIL=1
  fi

  if npm run | grep -q "typecheck"; then
    npm run typecheck || FAIL=1
  fi

  if npm run | grep -q "build"; then
    npm run build || FAIL=1
  fi

  cd "$ROOT_DIR"
fi

# ----------------------------
# VSCode extension checks
# ----------------------------

if [[ -d "packages/adjutorix-vscode" ]]; then
  echo ">>> Checking VSCode extension"

  cd "$ROOT_DIR/packages/adjutorix-vscode"

  npm install

  if npm run | grep -q "lint"; then
    npm run lint || FAIL=1
  fi

  if npm run | grep -q "build"; then
    npm run build || FAIL=1
  fi

  cd "$ROOT_DIR"
fi

# ----------------------------
# Python tests (Agent)
# ----------------------------

if [[ -d "packages/adjutorix-agent" ]]; then
  echo ">>> Running agent tests"

  cd "$ROOT_DIR/packages/adjutorix-agent"

  pytest -q || FAIL=1

  cd "$ROOT_DIR"
fi

# ----------------------------
# Secrets scan
# ----------------------------

echo ">>> Secrets scan"

if [[ -f "packages/adjutorix-agent/adjutorix_agent/tools/security/secrets_scan.py" ]]; then
  python packages/adjutorix-agent/adjutorix_agent/tools/security/secrets_scan.py . || FAIL=1
fi

# ----------------------------
# Dependency audit (best effort)
# ----------------------------

echo ">>> Dependency audit"

if command -v pip-audit >/dev/null; then
  pip-audit || FAIL=1
fi

if command -v npm >/dev/null; then
  npm audit --audit-level=high || true
fi

# ----------------------------
# Index integrity
# ----------------------------

echo ">>> Checking code index"

if [[ -x "tools/maintenance/rebuild_index.sh" ]]; then
  tools/maintenance/rebuild_index.sh --check || FAIL=1
fi

# ----------------------------
# Git status check
# ----------------------------

echo ">>> Git cleanliness check"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[ERR] Working tree not clean"
  git status --short
  FAIL=1
fi

# ----------------------------
# Result
# ----------------------------

echo "========================================"

if [[ $FAIL -eq 0 ]]; then
  echo "CHECK PASSED"
  echo "Repository is valid"
  echo "========================================"
  exit 0
else
  echo "CHECK FAILED"
  echo "One or more validations failed"
  echo "========================================"
  exit 1
fi
