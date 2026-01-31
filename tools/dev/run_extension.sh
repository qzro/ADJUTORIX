#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXT_DIR="$ROOT_DIR/packages/adjutorix-vscode"

die() { echo "ERROR: $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"; }

need_cmd node
need_cmd npm

if [[ ! -d "$EXT_DIR" ]]; then
  die "Extension package not found: $EXT_DIR"
fi

cd "$EXT_DIR"

# Install deps if missing
if [[ ! -d node_modules ]]; then
  echo "Installing extension dependencies..."
  npm ci
fi

# Build webview/media bundle if you add one later; keep as no-op if absent
if [[ -f package.json ]]; then
  echo "Building extension..."
  npm run build
fi

# VS Code extension development host:
# - if `code` exists (native), use it
# - otherwise try `codium` (VSCodium)
if command -v code >/dev/null 2>&1; then
  VSCODE_BIN="code"
elif command -v codium >/dev/null 2>&1; then
  VSCODE_BIN="codium"
else
  die "Neither 'code' nor 'codium' found in PATH"
fi

echo "Launching VS Code Extension Development Host..."
echo "Extension: $EXT_DIR"
echo "Using:     $VSCODE_BIN"
echo

# Open the extension folder in a dedicated window
# You still start debugging via VS Code (F5), but this makes it one command.
"$VSCODE_BIN" "$EXT_DIR" --new-window
