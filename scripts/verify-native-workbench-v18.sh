#!/usr/bin/env bash
set -Eeuo pipefail

APP="packages/adjutorix-app"

echo "=== V18 SOURCE CONTRACT ==="
grep -R "ADJUTORIX_NATIVE_PORTFOLIO_HOST_WORKBENCH_V18" "$APP/src/renderer/PortfolioWorkbenchV18.tsx" >/dev/null
grep -R "ADJUTORIX_NATIVE_PORTFOLIO_HOST_V18" "$APP/src/main/portfolio-workspace-v18.ts" "$APP/src/preload/preload.ts" >/dev/null
grep -R "registerPortfolioWorkspaceV18" "$APP/src/main/index.ts" >/dev/null
grep -R "adjutorix:v18:openFolder" "$APP/src/main/portfolio-workspace-v18.ts" "$APP/src/preload/preload.ts" >/dev/null
grep -R "selectRoot" "$APP/src/renderer/PortfolioWorkbenchV18.tsx" >/dev/null
grep -R "workspaces" "$APP/src/renderer/PortfolioWorkbenchV18.tsx" >/dev/null
echo "SOURCE_CONTRACT_OK=true"

echo
echo "=== BUILD ==="
pnpm --dir "$APP" run build

echo
echo "=== BUNDLE CONTRACT ==="
test -f "$APP/dist/main/index.js"
test -f "$APP/dist/main/portfolio-workspace-v18.js"
test -f "$APP/dist/preload/preload.mjs"
test -f "$APP/dist/renderer/index.html"
grep -R "ADJUTORIX_NATIVE_PORTFOLIO_HOST_WORKBENCH_V18" "$APP/dist/renderer/assets" >/dev/null
grep -R "adjutorix:v18:state" "$APP/dist/preload" >/dev/null
grep -R "adjutorix:v18:state" "$APP/dist/main" >/dev/null
echo "BUNDLE_CONTRACT_OK=true"

echo
echo "ADJUTORIX_NATIVE_PORTFOLIO_HOST_WORKBENCH_V18_GATE_PASS=true"
