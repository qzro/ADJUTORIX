#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "=== ADJUTORIX ONE APP INSTALL ==="

osascript -e 'quit app "Adjutorix"' 2>/dev/null || true
pkill -9 -f "Adjutorix.app" 2>/dev/null || true
sleep 1

echo "=== CLEAN BUILD OUTPUT ==="
rm -rf packages/adjutorix-app/dist packages/adjutorix-app/release .local-app
mkdir -p .local-app

echo "=== INSTALL DEPENDENCIES ==="
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

echo "=== BUILD WORKSPACE ==="
pnpm -r run build

echo "=== PACKAGE MAC APP ==="
cd packages/adjutorix-app
pnpm exec electron-builder --mac dmg --arm64 --publish never
cd "$ROOT"

APP_SRC="$(find packages/adjutorix-app/release -path '*Adjutorix.app' -type d | head -n 1)"
test -n "${APP_SRC:-}"
test -d "$APP_SRC"

echo "=== INSTALL SINGLE CANONICAL APP ==="
sudo rm -rf "/Applications/Adjutorix.app" 2>/dev/null || rm -rf "/Applications/Adjutorix.app"
sudo ditto "$APP_SRC" "/Applications/Adjutorix.app" 2>/dev/null || ditto "$APP_SRC" "/Applications/Adjutorix.app"
sudo chown -R "$USER":staff "/Applications/Adjutorix.app" 2>/dev/null || true
chmod -R u+rwX "/Applications/Adjutorix.app"
xattr -dr com.apple.quarantine "/Applications/Adjutorix.app" 2>/dev/null || true
/usr/bin/codesign --force --deep --sign - "/Applications/Adjutorix.app" >/dev/null 2>&1 || true

echo "=== REMOVE LOCAL BUILD COPIES AFTER INSTALL ==="
rm -rf packages/adjutorix-app/dist packages/adjutorix-app/release .local-app

echo "=== VERIFY SINGLE INSTALLED APP ==="
test -d "/Applications/Adjutorix.app"
find /Applications "$HOME/Applications" -maxdepth 2 -name "Adjutorix.app" -type d 2>/dev/null | sort

echo "=== OPEN APP ==="
open -n "/Applications/Adjutorix.app"

echo "ADJUTORIX_SINGLE_INSTALLED_APP_OK=true"
