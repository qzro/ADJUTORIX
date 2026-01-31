#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$ROOT/tools/install/scaffold.sh"
bash "$ROOT/tools/install/bootstrap.sh"

echo ""
echo "✅ ADJUTORIX ready."
echo "Run:"
echo "  ./tools/dev/run_agent.sh"
echo "  ./tools/dev/run_extension.sh"
