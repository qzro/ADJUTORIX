#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSX="$ROOT_DIR/packages/adjutorix-app/src/renderer/RevolutionWorkbench.tsx"
CSS="$ROOT_DIR/packages/adjutorix-app/src/renderer/native-workbench.css"
DIST="$ROOT_DIR/packages/adjutorix-app/dist/renderer"

fail() {
  echo "ADJUTORIX_NATIVE_WORKBENCH_V10_GATE_FAIL=$1" >&2
  exit 1
}

echo "=== V10 SOURCE CONTRACT ==="
grep -q 'ADJUTORIX_NATIVE_IDE_WORKBENCH_V10' "$TSX" || fail missing_v10_marker
grep -q 'MAX_EDITOR_BYTES' "$TSX" || fail missing_max_editor_bytes
grep -q 'entryIsOpenableSource' "$TSX" || fail missing_openable_source_classifier
grep -q 'classifyOpenRejection' "$TSX" || fail missing_open_rejection_classifier
grep -q 'isExpectedReadRejection' "$TSX" || fail missing_expected_read_rejection_quiet_path
grep -q 'workspace_file_read_' "$TSX" || fail missing_workspace_read_rejection_terms
grep -q 'directory/binary/large-file rejection' "$TSX" || fail missing_human_capability_copy
echo "SOURCE_CONTRACT_OK=true"

echo
echo "=== V10 CSS CONTRACT ==="
grep -q 'V10: real IDE safety surface' "$CSS" || fail missing_v10_css
grep -q 'not-allowed' "$CSS" || fail missing_disabled_visual_contract
echo "CSS_CONTRACT_OK=true"

echo
echo "=== V10 BUNDLE CONTRACT ==="
test -d "$DIST/assets" || fail missing_renderer_assets
grep -R 'ADJUTORIX_NATIVE_IDE_WORKBENCH_V10' "$DIST/assets" >/dev/null || fail bundle_missing_v10_marker
grep -R 'MAX_EDITOR_BYTES' "$DIST/assets" >/dev/null || fail bundle_missing_safe_size_guard
grep -R 'binary_or_artifact' "$DIST/assets" >/dev/null || fail bundle_missing_binary_artifact_guard
echo "BUNDLE_CONTRACT_OK=true"

echo
echo "ADJUTORIX_NATIVE_WORKBENCH_V10_GATE_PASS=true"
