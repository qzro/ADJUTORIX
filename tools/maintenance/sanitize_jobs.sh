#!/usr/bin/env bash
set -euo pipefail

# Sanitizes .agent/jobs directories:
# - Removes corrupted/incomplete jobs
# - Trims oversized logs
# - Redacts secrets
# - Optionally prunes old jobs
#
# Safe: does NOT touch active job.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Defaults (override via env)
MAX_JOB_SIZE_MB="${MAX_JOB_SIZE_MB:-50}"
MAX_LOG_SIZE_MB="${MAX_LOG_SIZE_MB:-10}"
KEEP_DAYS="${KEEP_DAYS:-90}"

GLOBAL_AGENT_DIR="${HOME}/.agent"
WORKSPACES_FILE="$GLOBAL_AGENT_DIR/workspaces.yaml"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "[SANITIZE] $*"
}

to_bytes() {
  echo $(( "$1" * 1024 * 1024 ))
}

find_repos() {
  local repos=()

  if [ -f "$WORKSPACES_FILE" ]; then
    # Extract paths from YAML (simple parser)
    mapfile -t repos < <(
      grep -E 'path:' "$WORKSPACES_FILE" \
        | awk '{print $2}' \
        | sed 's|"||g'
    )
  fi

  # Fallback: scan home dir for .agent
  if [ "${#repos[@]}" -eq 0 ]; then
    mapfile -t repos < <(
      find "$HOME" -maxdepth 4 -type d -name ".agent" 2>/dev/null \
        | sed 's|/.agent$||'
    )
  fi

  printf "%s\n" "${repos[@]}" | sort -u
}

job_dir_for_repo() {
  local repo="$1"
  echo "$repo/.agent/jobs"
}

is_active_job() {
  local dir="$1"
  [ -f "$dir/.lock" ] || [ -f "$dir/.active" ]
}

job_size_bytes() {
  du -sb "$1" 2>/dev/null | awk '{print $1}' || echo 0
}

redact_secrets() {
  local file="$1"

  sed -i.bak -E '
    s/(sk-[A-Za-z0-9]{20,})/[REDACTED_API_KEY]/g;
    s/(ghp_[A-Za-z0-9]{30,})/[REDACTED_GH_TOKEN]/g;
    s/(AIza[0-9A-Za-z\-_]{35})/[REDACTED_GOOGLE_KEY]/g;
    s/([A-Za-z0-9_]*SECRET[A-Za-z0-9_]*=).*/\1[REDACTED]/g;
    s/([A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*=).*/\1[REDACTED]/g;
  ' "$file" 2>/dev/null || true

  rm -f "${file}.bak" 2>/dev/null || true
}

sanitize_job() {
  local job="$1"

  info "Checking job: $job"

  # Skip active job
  if is_active_job "$job"; then
    info "Skipping active job: $job"
    return 0
  fi

  # Required files
  local required=(
    "plan.md"
    "diff.patch"
    "commands.log"
    "results.log"
    "summary.md"
  )

  for f in "${required[@]}"; do
    if [ ! -f "$job/$f" ]; then
      info "Corrupt job (missing $f), removing: $job"
      rm -rf "$job"
      return 0
    fi
  done

  # Redact secrets in logs
  for log in "$job"/*.log "$job"/*.md; do
    [ -f "$log" ] || continue
    redact_secrets "$log"
  done

  # Trim oversized logs
  for log in "$job"/*.log; do
    [ -f "$log" ] || continue

    local size
    size="$(du -sb "$log" | awk '{print $1}')"
    local max
    max="$(to_bytes "$MAX_LOG_SIZE_MB")"

    if [ "$size" -gt "$max" ]; then
      info "Trimming large log: $log"
      tail -c "$max" "$log" > "${log}.tmp"
      mv "${log}.tmp" "$log"
    fi
  done

  # Remove oversized job
  local job_size
  job_size="$(job_size_bytes "$job")"
  local max_job
  max_job="$(to_bytes "$MAX_JOB_SIZE_MB")"

  if [ "$job_size" -gt "$max_job" ]; then
    info "Job too large ($(("$job_size"/1024/1024))MB), removing: $job"
    rm -rf "$job"
    return 0
  fi

  # Remove old jobs
  if find "$job" -type f -mtime +"$KEEP_DAYS" | grep -q .; then
    info "Old job (>${KEEP_DAYS}d), removing: $job"
    rm -rf "$job"
    return 0
  fi

  info "Job OK: $job"
}

sanitize_repo() {
  local repo="$1"
  local jobs
  jobs="$(job_dir_for_repo "$repo")"

  [ -d "$jobs" ] || return 0

  info "Scanning jobs in: $jobs"

  find "$jobs" -mindepth 1 -maxdepth 1 -type d | while read -r job; do
    sanitize_job "$job"
  done
}

main() {
  info "Starting job sanitization"
  info "Policy:"
  info "  MAX_JOB_SIZE_MB=$MAX_JOB_SIZE_MB"
  info "  MAX_LOG_SIZE_MB=$MAX_LOG_SIZE_MB"
  info "  KEEP_DAYS=$KEEP_DAYS"

  local repos
  mapfile -t repos < <(find_repos)

  if [ "${#repos[@]}" -eq 0 ]; then
    info "No repos found"
    exit 0
  fi

  for repo in "${repos[@]}"; do
    [ -d "$repo" ] || continue
    sanitize_repo "$repo"
  done

  info "Sanitization complete"
}

main "$@"
