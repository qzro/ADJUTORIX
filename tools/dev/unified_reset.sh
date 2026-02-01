#!/usr/bin/env bash
# COMPLETE UNIFIED RESET + BUILD (FINAL VERSION)
# One procedure. Run once. No branching. No retries.
# Result: ONE unified ADJUTORIX, clean state, VS Code fully enabled, Cursor safely inert.
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXT_DIR="$ROOT_DIR/packages/adjutorix-vscode"

echo "=== 0. Close everything ==="
pkill -f "Code"   || true
pkill -f "Cursor" || true
sleep 1

echo "=== 1. Nuclear clean (VS Code + Cursor + caches) ==="
# VS Code
rm -rf ~/.vscode/extensions/adjutorix*
rm -rf ~/Library/Application\ Support/Code/User/globalStorage/adjutorix*
rm -rf ~/Library/Application\ Support/Code/User/workspaceStorage/*adjutorix*
rm -rf ~/Library/Application\ Support/Code/CachedExtensionVSIXs/*adjutorix*

# Cursor
rm -rf ~/.cursor
rm -rf ~/Library/Application\ Support/Cursor
rm -rf ~/Library/Caches/Cursor
rm -rf ~/Library/Preferences/com.todesktop.*cursor*.plist

# Optional hard cache
rm -rf ~/Library/Saved\ Application\ State/*Cursor*
rm -rf ~/Library/Saved\ Application\ State/*Code*

echo "CLEAN COMPLETE"

echo "=== 2. Single source of truth (unified build) ==="
if [[ ! -d "$EXT_DIR" ]]; then
  echo "ERROR: Extension dir not found: $EXT_DIR" >&2
  exit 1
fi
cd "$EXT_DIR"
rm -rf dist
npm install
npm run build
echo "BUILD COMPLETE"

echo ""
echo "=== 4. Install once (dev mode) – run ONE of these from repo root ==="
echo "  Repo root: $ROOT_DIR"
echo ""
echo "  On macOS (use REAL VS Code, not Cursor):"
echo "  /Applications/Visual\\ Studio\\ Code.app/Contents/Resources/app/bin/code --extensionDevelopmentPath=packages/adjutorix-vscode"
echo ""
echo "  Or from repo root after:  cd $ROOT_DIR"
echo "  /Applications/Visual\\ Studio\\ Code.app/Contents/Resources/app/bin/code --extensionDevelopmentPath=packages/adjutorix-vscode"
echo ""
echo "  Do NOT use plain 'code' if you have Cursor – it may open Cursor."
echo ""
echo "=== 5. Verify in VS Code: Command Palette → Adjutorix: Show Sidebar ==="
echo "=== In Cursor: extension may appear; no commands, no sidebar, no activation. CORRECT. ==="
