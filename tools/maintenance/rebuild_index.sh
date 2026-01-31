#!/usr/bin/env bash
set -euo pipefail

# Rebuilds code intelligence indexes (ctags + tree-sitter where available)
# Used by ADJUTORIX for fast symbol lookup and dependency analysis.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="$ROOT_DIR/packages/adjutorix-agent"
INDEX_DIR="$AGENT_DIR/.index"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "[INDEX] $*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

need_cmd rg
need_cmd ctags

info "Root: $ROOT_DIR"
info "Agent: $AGENT_DIR"

mkdir -p "$INDEX_DIR"

cd "$ROOT_DIR" || die "Cannot enter root directory"

# Clean old index
info "Cleaning old index..."
rm -rf "$INDEX_DIR"/*
mkdir -p "$INDEX_DIR"/{ctags,files,symbols}

# Build file list (exclude junk)
info "Building file list..."
rg --files \
  --hidden \
  --follow \
  -g '!node_modules' \
  -g '!dist' \
  -g '!build' \
  -g '!.git' \
  -g '!.venv' \
  > "$INDEX_DIR/files/all_files.txt"

FILE_COUNT="$(wc -l < "$INDEX_DIR/files/all_files.txt" || echo 0)"
info "Indexed files: $FILE_COUNT"

# Generate universal ctags
info "Generating ctags..."
ctags \
  --languages=Python,JavaScript,TypeScript,JSON,YAML,Markdown \
  --fields=+n+k+s+z \
  --extras=+q \
  --recurse=no \
  -L "$INDEX_DIR/files/all_files.txt" \
  -f "$INDEX_DIR/ctags/tags"

# Extract symbol map (lightweight)
info "Extracting symbol map..."
awk '
BEGIN { FS="\t" }
!/^!/ {
  name=$1
  file=$2
  kind=$4
  print name "|" kind "|" file
}
' "$INDEX_DIR/ctags/tags" \
  | sort -u \
  > "$INDEX_DIR/symbols/symbol_map.txt"

# Build dependency hints (imports/requires)
info "Building dependency hints..."

rg -n \
  "^(import|from|require\\(|use )" \
  -g '*.py' \
  -g '*.js' \
  -g '*.ts' \
  -g '*.mjs' \
  -g '*.cjs' \
  "$ROOT_DIR" \
  > "$INDEX_DIR/symbols/dependencies.txt" || true

# Generate summary
SUMMARY="$INDEX_DIR/index.meta"

cat > "$SUMMARY" <<EOF
index_version=1
generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
root=$ROOT_DIR
files=$FILE_COUNT
ctags=$INDEX_DIR/ctags/tags
symbols=$INDEX_DIR/symbols/symbol_map.txt
deps=$INDEX_DIR/symbols/dependencies.txt
EOF

info "Index rebuilt successfully."
info "Metadata: $SUMMARY"

exit 0
