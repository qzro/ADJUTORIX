#!/usr/bin/env bash
set -euo pipefail

echo "=== ADJUTORIX ONE APP INSTALL ==="

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT/packages/adjutorix-app"
INSTALL_PATH="/Applications/Adjutorix.app"

cd "$ROOT"

echo "=== STOP RUNNING APP ==="
osascript -e 'tell application "Adjutorix" to quit' >/dev/null 2>&1 || true
pkill -f "Adjutorix" >/dev/null 2>&1 || true
sleep 1

echo "=== CLEAN BUILD OUTPUT ==="
rm -rf "$APP_DIR/dist" "$APP_DIR/release"

echo "=== INSTALL DEPENDENCIES ==="
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

echo "=== BUILD WORKSPACE ==="
pnpm -r --if-present run build

cd "$APP_DIR"

echo "=== VERIFY RENDERER ENTRY ==="
if [[ ! -f dist/renderer/index.html && -f dist/renderer/index.html/index.html ]]; then
  mkdir -p dist/renderer.__normalized
  cp -R dist/renderer/index.html/* dist/renderer.__normalized/
  rm -rf dist/renderer
  mv dist/renderer.__normalized dist/renderer
fi
test -f dist/main/index.js
test -f dist/renderer/index.html
echo "RENDERER_ENTRY_READY=$APP_DIR/dist/renderer/index.html"

echo "=== PACKAGE MAC APP ==="
pnpm exec electron-builder --mac dmg --arm64 --publish never

BUILT_APP="$(find "$APP_DIR/release" -type d -name 'Adjutorix.app' -print -quit)"
if [[ -z "$BUILT_APP" ]]; then
  echo "ADJUTORIX_BUILT_APP_MISSING=true"
  find "$APP_DIR/release" -maxdepth 4 -print || true
  exit 1
fi

echo "=== INSTALL SINGLE CANONICAL APP ==="
osascript -e 'tell application "Adjutorix" to quit' >/dev/null 2>&1 || true
pkill -f "Adjutorix" >/dev/null 2>&1 || true
sleep 1

sudo rm -rf "$INSTALL_PATH"
sudo ditto "$BUILT_APP" "$INSTALL_PATH"
sudo chown -R root:wheel "$INSTALL_PATH" || true
sudo chmod -R a+rX "$INSTALL_PATH" || true
sudo xattr -dr com.apple.quarantine "$INSTALL_PATH" >/dev/null 2>&1 || true
codesign --force --deep --sign - "$INSTALL_PATH" >/dev/null 2>&1 || true

echo "=== REMOVE LOCAL BUILD COPIES AFTER INSTALL ==="
rm -rf "$APP_DIR/release/mac" "$APP_DIR/release/mac-arm64"

echo "=== VERIFY SINGLE INSTALLED APP ==="
test -d "$INSTALL_PATH"
find /Applications -maxdepth 1 -name 'Adjutorix*.app' -print

RESOURCES_DIR="$INSTALL_PATH/Contents/Resources"
if [[ -f "$RESOURCES_DIR/app.asar" ]]; then
  echo "INSTALLED_STANDARD_ASAR_APP=true"
elif [[ -f "$RESOURCES_DIR/app/dist/main/index.js" && -f "$RESOURCES_DIR/app/dist/renderer/index.html" ]]; then
  echo "INSTALLED_EXPANDED_APP=true"
else
  echo "INSTALLED_APP_RESOURCES_INVALID=true"
  find "$RESOURCES_DIR" -maxdepth 5 -type f | sort | head -200
  exit 1
fi

if [[ "${ADJUTORIX_NO_OPEN:-0}" != "1" ]]; then
  echo "=== OPEN APP ==="
  open "$INSTALL_PATH"
fi

echo "ADJUTORIX_SINGLE_INSTALLED_APP_OK=true"
