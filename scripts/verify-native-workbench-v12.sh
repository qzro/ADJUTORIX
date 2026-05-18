#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT_DIR/packages/adjutorix-app/src/renderer/CommandCenterWorkbench.tsx"
MAIN="$ROOT_DIR/packages/adjutorix-app/src/renderer/main.tsx"
CSS="$ROOT_DIR/packages/adjutorix-app/src/renderer/native-workbench.css"

echo "=== V12 SOURCE CONTRACT ==="
grep -q 'ADJUTORIX_NATIVE_COMMAND_CENTER_WORKBENCH_V12' "$SRC"
grep -q 'COMMAND_BRIDGES' "$SRC"
grep -q 'executeNativeCommand' "$SRC"
grep -q 'normalizeCommand' "$SRC"
grep -q 'workspace.readFile' "$SRC"
grep -q 'writeAgentContext' "$SRC"
grep -q 'parseProblems' "$SRC"
grep -q 'makePatch' "$SRC"
grep -q 'CommandCenterWorkbench' "$MAIN"
grep -q 'ax-palette' "$CSS"
echo "SOURCE_CONTRACT_OK=true"

echo
echo "=== V12 BUILD CONTRACT ==="
pnpm --dir "$ROOT_DIR/packages/adjutorix-app" run build >/tmp/adjutorix-v12-build.log 2>&1 || {
  cat /tmp/adjutorix-v12-build.log
  echo "BUILD_CONTRACT_OK=false"
  exit 1
}
cat /tmp/adjutorix-v12-build.log | tail -60
test -f "$ROOT_DIR/packages/adjutorix-app/dist/main/index.js"
test -f "$ROOT_DIR/packages/adjutorix-app/dist/preload/preload.mjs"
test -f "$ROOT_DIR/packages/adjutorix-app/dist/renderer/index.html"
echo "BUILD_CONTRACT_OK=true"

echo
echo "=== V12 BUNDLE CONTRACT ==="
grep -R "ADJUTORIX_NATIVE_COMMAND_CENTER_WORKBENCH_V12" "$ROOT_DIR/packages/adjutorix-app/dist/renderer/assets" >/dev/null
grep -R "executeNativeCommand" "$ROOT_DIR/packages/adjutorix-app/dist/renderer/assets" >/dev/null || true
if grep -R '"Run a command. This workbench uses the native shell bridge."' "$ROOT_DIR/packages/adjutorix-app/dist/renderer/assets" >/dev/null; then
  echo "V12_GATE_FAIL=old_ready_terminal_surface_still_present"
  exit 1
fi
echo "BUNDLE_CONTRACT_OK=true"
echo "ADJUTORIX_NATIVE_COMMAND_CENTER_WORKBENCH_V12_GATE_PASS=true"
