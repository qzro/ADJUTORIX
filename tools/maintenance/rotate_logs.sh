#!/usr/bin/env bash
set -euo pipefail

# Rotates ADJUTORIX runtime logs (NOT repo job ledgers).
# Keeps recent logs, compresses older ones, deletes very old.
#
# Targets:
# - ADJUTORIX/runtime/logs
# - ~/.agent/logs (optional)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_LOG_DIR="$ROOT_DIR/runtime/logs"
USER_LOG_DIR="${HOME}/.agent/logs"

KEEP_DAYS_PLAIN="${KEEP_DAYS_PLAIN:-7}"
KEEP_DAYS_GZ="${KEEP_DAYS_GZ:-30}"
MAX_TOTAL_MB="${MAX_TOTAL_MB:-500}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "[LOGROTATE] $*"
}

ensure_dir() {
  local d="$1"
  mkdir -p "$d"
}

compress_older_than() {
  local dir="$1"
  local days="$2"

  [ -d "$dir" ] || return 0

  info "Compressing .log older than ${days}d in: $dir"
  # compress plain .log older than N days into .gz
  find "$dir" -type f -name "*.log" -mtime +"$days" -print0 | while IFS= read -r -d '' f; do
    # skip if already compressed or empty
    [ -f "$f" ] || continue
    gzip -f "$f"
  done
}

delete_older_than_gz() {
  local dir="$1"
  local days="$2"

  [ -d "$dir" ] || return 0

  info "Deleting .gz older than ${days}d in: $dir"
  find "$dir" -type f -name "*.gz" -mtime +"$days" -delete
}

trim_by_size_mb() {
  local dir="$1"
  local max_mb="$2"

  [ -d "$dir" ] || return 0

  local max_bytes=$((max_mb * 1024 * 1024))
  local total_bytes
  total_bytes="$(du -sb "$dir" 2>/dev/null | awk '{print $1}' || echo 0)"

  if [ "$total_bytes" -le "$max_bytes" ]; then
    info "Size OK: $(($total_bytes / 1024 / 1024))MB <= ${max_mb}MB ($dir)"
    return 0
  fi

  info "Trimming logs by size: current $(($total_bytes / 1024 / 1024))MB > ${max_mb}MB ($dir)"
  info "Deleting oldest files until within limit..."

  # List files by oldest first (both .log and .gz), delete until under max.
  # Using stat portable-ish: mac uses -f, linux uses -c. Detect.
  local stat_opt
  if stat -c "%Y" "$dir" >/dev/null 2>&1; then
    stat_opt="-c"
  else
    stat_opt="-f"
  fi

  # Build list: epoch|path
  mapfile -t files < <(
    find "$dir" -type f \( -name "*.log" -o -name "*.gz" \) -print0 \
      | while IFS= read -r -d '' f; do
          local t
          if [ "$stat_opt" = "-c" ]; then
            t="$(stat -c "%Y" "$f" 2>/dev/null || echo 0)"
          else
            t="$(stat -f "%m" "$f" 2>/dev/null || echo 0)"
          fi
          printf "%s|%s\n" "$t" "$f"
        done \
      | sort -n
  )

  for entry in "${files[@]}"; do
    total_bytes="$(du -sb "$dir" 2>/dev/null | awk '{print $1}' || echo 0)"
    if [ "$total_bytes" -le "$max_bytes" ]; then
      info "Trim complete: $(($total_bytes / 1024 / 1024))MB <= ${max_mb}MB ($dir)"
      return 0
    fi

    local path="${entry#*|}"
    if [ -f "$path" ]; then
      info "Deleting: $path"
      rm -f "$path"
    fi
  done

  total_bytes="$(du -sb "$dir" 2>/dev/null | awk '{print $1}' || echo 0)"
  info "Final size: $(($total_bytes / 1024 / 1024))MB ($dir)"
}

rotate_dir() {
  local dir="$1"
  ensure_dir "$dir"

  compress_older_than "$dir" "$KEEP_DAYS_PLAIN"
  delete_older_than_gz "$dir" "$KEEP_DAYS_GZ"
  trim_by_size_mb "$dir" "$MAX_TOTAL_MB"
}

info "Rotating logs..."
info "Policy: KEEP_DAYS_PLAIN=$KEEP_DAYS_PLAIN KEEP_DAYS_GZ=$KEEP_DAYS_GZ MAX_TOTAL_MB=$MAX_TOTAL_MB"

rotate_dir "$RUNTIME_LOG_DIR"

# Optional user-level logs (only if exists or can be created)
ensure_dir "$USER_LOG_DIR"
rotate_dir "$USER_LOG_DIR"

info "Done."
exit 0
