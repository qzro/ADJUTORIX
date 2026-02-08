cat > configs/ci/scripts/ci_guard_only.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

./configs/ci/scripts/guard_generated_artifacts.sh
echo "OK: guard-only passed"
EOF
chmod +x configs/ci/scripts/ci_guard_only.sh
