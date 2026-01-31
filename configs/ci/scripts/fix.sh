#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Adjutorix Fix Script
# Autofix pipeline (format/lint/imports/etc.)
# ============================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

echo "========================================"
echo "Adjutorix FIX (Autofix Pipeline)"
echo "Root: $ROOT_DIR"
echo "========================================"

cd "$ROOT_DIR"

# ----------------------------
# Environment validation
# ----------------------------

command -v python >/dev/null || { echo "Python missing"; exit 1; }
command -v node >/dev/null || { echo "Node missing"; exit 1; }
command -v npm >/dev/null || { echo "NPM missing"; exit 1; }

echo "[OK] Toolchain present"

# ----------------------------
# Python autofix
# ----------------------------

echo ">>> Python formatting / lint fixing"

if command -v ruff >/dev/null; then
  ruff check . --fix
  ruff format .
fi

if command -v black >/dev/null; then
  black .
fi

if command -v isort >/dev/null; then
  isort .
fi

# ----------------------------
# TypeScript / JS autofix
# ----------------------------

echo ">>> TypeScript / JS autofix"

if [[ -f "package.json" ]]; then
  npm install

  if npm run | grep -q "lint:fix"; then
    npm run lint:fix
  elif npm run | grep -q "lint"; then
    npm run lint -- --fix || true
  fi

  if npm run | grep -q "format"; then
    npm run format || true
  fi
fi

# ----------------------------
# Shared package
# ----------------------------

if [[ -d "packages/shared" ]]; then
  echo ">>> Fixing shared package"

  cd "$ROOT_DIR/packages/shared"

  npm install

  if npm run | grep -q "lint:fix"; then
    npm run lint:fix
  fi

  cd "$ROOT_DIR"
fi

# ----------------------------
# VSCode extension
# ----------------------------

if [[ -d "packages/adjutorix-vscode" ]]; then
  echo ">>> Fixing VSCode extension"

  cd "$ROOT_DIR/packages/adjutorix-vscode"

  npm install

  if npm run | grep -q "lint:fix"; then
    npm run lint:fix
  fi

  cd "$ROOT_DIR"
fi

# ----------------------------
# Remove dead files
# ----------------------------

echo ">>> Cleaning caches / artifacts"

find . -type d -name "__pycache__" -exec rm -rf {} +
find . -type f -name "*.pyc" -delete
find . -type d -name ".pytest_cache" -exec rm -rf {} +

# ----------------------------
# Normalize line endings
# ----------------------------

echo ">>> Normalizing line endings"

find . -type f \
  \( -name "*.py" -o -name "*.ts" -o -name "*.js" -o -name "*.sh" -o -name "*.json" \) \
  -exec sed -i.bak 's/\r$//' {} +

find . -name "*.bak" -delete

# ----------------------------
# Summary
# ----------------------------

echo "========================================"
echo "FIX COMPLETE"
echo "All autofixers executed"
echo "========================================"

exit 0
