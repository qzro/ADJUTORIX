#!/usr/bin/env bash
set -euo pipefail

# Builds a local VSIX for the ADJUTORIX VS Code extension (no marketplace).
# Output: packages/adjutorix-vscode/dist/adjutorix-vscode-<version>.vsix

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXT_DIR="$ROOT_DIR/packages/adjutorix-vscode"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "[RELEASE] $*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

need_cmd node
need_cmd npm

cd "$EXT_DIR" || die "Extension directory not found: $EXT_DIR"

info "Installing dependencies (npm ci)..."
npm ci

info "Building extension..."
npm run build

# Prefer local devDependency vsce if present. If not, use npx (still free).
info "Packaging VSIX..."
if [[ -x "./node_modules/.bin/vsce" ]]; then
  ./node_modules/.bin/vsce package -o dist/
else
  npx --yes vsce package -o dist/
fi

VSIX="$(ls -1 dist/*.vsix 2>/dev/null | tail -n 1 || true)"
[[ -n "${VSIX}" ]] || die "VSIX not found in dist/"

info "VSIX created: $VSIX"
echo "$VSIX"
