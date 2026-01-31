#!/usr/bin/env bash
set -euo pipefail

touch_if_missing() { [[ -f "$1" ]] || { mkdir -p "$(dirname "$1")"; printf "%s\n" "${2:-}" > "$1"; }; }

mk() { mkdir -p "$1"; }

# Root
touch_if_missing "README.md" "# ADJUTORIX"
touch_if_missing "LICENSE" ""
touch_if_missing ".gitignore" "node_modules
dist
build
__pycache__
.venv
.env
runtime/logs
*.vsix
.DS_Store
"

# docs
mk "docs/screenshots"
touch_if_missing "docs/architecture.md" ""
touch_if_missing "docs/protocol.md" ""
touch_if_missing "docs/security.md" ""
touch_if_missing "docs/troubleshooting.md" ""

# packages/shared
mk "packages/shared/src/rpc"
mk "packages/shared/src/contracts"
mk "packages/shared/test"
touch_if_missing "packages/shared/package.json" '{
  "name": "@adjutorix/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}'
touch_if_missing "packages/shared/tsconfig.json" '{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "declaration": true,
    "outDir": "dist",
    "strict": true
  },
  "include": ["src"]
}'
touch_if_missing "packages/shared/src/rpc/methods.ts" "export const RPC_METHODS = {} as const;\n"
touch_if_missing "packages/shared/src/rpc/types.ts" "export type RpcRequest = unknown;\nexport type RpcResponse = unknown;\n"
touch_if_missing "packages/shared/src/rpc/errors.ts" "export type ErrorCode = string;\n"
touch_if_missing "packages/shared/src/constants.ts" "export const DEFAULTS = {} as const;\n"
touch_if_missing "packages/shared/src/contracts/plan.schema.json" "{}\n"
touch_if_missing "packages/shared/src/contracts/toolcall.schema.json" "{}\n"
touch_if_missing "packages/shared/src/contracts/patch.schema.json" "{}\n"
touch_if_missing "packages/shared/src/contracts/policy.schema.json" "{}\n"

# packages/adjutorix-vscode
mk "packages/adjutorix-vscode/src/client"
mk "packages/adjutorix-vscode/src/ui"
mk "packages/adjutorix-vscode/src/diff"
mk "packages/adjutorix-vscode/src/diagnostics"
mk "packages/adjutorix-vscode/src/config"
mk "packages/adjutorix-vscode/src/release"
mk "packages/adjutorix-vscode/media"
mk "packages/adjutorix-vscode/test"
touch_if_missing "packages/adjutorix-vscode/.vscodeignore" "node_modules\nsrc\n**/*.map\n"
touch_if_missing "packages/adjutorix-vscode/package.json" '{
  "name": "adjutorix-vscode",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/extension.js",
  "engines": { "vscode": "^1.90.0" }
}'
touch_if_missing "packages/adjutorix-vscode/tsconfig.json" '{
  "compilerOptions": { "target": "ES2022", "module": "CommonJS", "outDir": "dist", "strict": true },
  "include": ["src"]
}'
touch_if_missing "packages/adjutorix-vscode/webpack.config.js" "module.exports = {};\n"
touch_if_missing "packages/adjutorix-vscode/src/extension.ts" "export function activate() {}\nexport function deactivate() {}\n"
touch_if_missing "packages/adjutorix-vscode/src/client/rpc.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/client/transport.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/client/types.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/ui/panel.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/ui/state.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/ui/commands.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/diff/preview.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/diff/apply.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/diagnostics/parse.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/diagnostics/publish.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/config/settings.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/config/schema.json" "{}\n"
touch_if_missing "packages/adjutorix-vscode/src/release/package.ts" ""
touch_if_missing "packages/adjutorix-vscode/src/release/publish.ts" ""

# packages/adjutorix-agent (python skeleton)
mk "packages/adjutorix-agent/adjutorix_agent/server"
mk "packages/adjutorix-agent/adjutorix_agent/core"
mk "packages/adjutorix-agent/adjutorix_agent/llm/providers"
mk "packages/adjutorix-agent/adjutorix_agent/llm/prompts"
mk "packages/adjutorix-agent/adjutorix_agent/llm/contracts"
mk "packages/adjutorix-agent/adjutorix_agent/tools/fs"
mk "packages/adjutorix-agent/adjutorix_agent/tools/codeintel"
mk "packages/adjutorix-agent/adjutorix_agent/tools/run"
mk "packages/adjutorix-agent/adjutorix_agent/tools/git"
mk "packages/adjutorix-agent/adjutorix_agent/tools/security"
mk "packages/adjutorix-agent/adjutorix_agent/tools/tests"
mk "packages/adjutorix-agent/adjutorix_agent/tools/docs"
mk "packages/adjutorix-agent/adjutorix_agent/tools/deploy"
mk "packages/adjutorix-agent/adjutorix_agent/governance"
mk "packages/adjutorix-agent/adjutorix_agent/workspace"
mk "packages/adjutorix-agent/adjutorix_agent/memory"
mk "packages/adjutorix-agent/tests"
touch_if_missing "packages/adjutorix-agent/pyproject.toml" '[project]
name = "adjutorix-agent"
version = "0.0.1"
requires-python = ">=3.10"
dependencies = ["fastapi", "uvicorn", "pydantic", "pyyaml"]
'
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/__init__.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/server/app.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/server/auth.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/server/rpc.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/state_machine.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/planner.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/executor.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/patch_gate.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/rollback.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/job_ledger.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/context_budget.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/taxonomy.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/locks.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/core/recovery.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/router.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/providers/ollama.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/providers/lmstudio.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/providers/llama_cpp.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/prompts/system.md" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/prompts/plan.md" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/prompts/patch.md" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/prompts/verify.md" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/prompts/report.md" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/contracts/plan.schema.json" "{}\n"
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/contracts/toolcall.schema.json" "{}\n"
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/llm/contracts/patch.schema.json" "{}\n"
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/registry.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/fs/read_file.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/fs/write_file.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/fs/write_patch.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/fs/list_files.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/fs/search.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/codeintel/indexer.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/codeintel/find_symbol.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/codeintel/dependency_graph.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/codeintel/related_files.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/run/run_command.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/run/parse_output.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/run/allowlist.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/git/status.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/git/diff.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/git/commit.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/git/push.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/git/checkout.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/security/secrets_scan.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/security/dep_audit.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/tests/test_targeting.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/tests/fixtures.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/docs/doc_sync.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/deploy/wrangler.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/tools/deploy/release_artifacts.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/governance/policy.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/governance/protected_files.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/governance/no_guessing.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/governance/network_guard.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/workspace/router.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/workspace/workspaces.yaml" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/workspace/repo_detect.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/memory/compactor.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/memory/memory_files.py" ""
touch_if_missing "packages/adjutorix-agent/adjutorix_agent/memory/knowledge_base.py" ""

# packages/adjutorix-cli
mk "packages/adjutorix-cli/adjutorix_cli"
touch_if_missing "packages/adjutorix-cli/pyproject.toml" '[project]
name = "adjutorix-cli"
version = "0.0.1"
requires-python = ">=3.10"
dependencies = []
'
touch_if_missing "packages/adjutorix-cli/adjutorix_cli/main.py" ""

# configs
mk "configs/vscode"
mk "configs/hooks"
mk "configs/ci/scripts"
touch_if_missing "configs/vscode/tasks.json" "{}\n"
touch_if_missing "configs/vscode/keybindings.json" "[]\n"
touch_if_missing "configs/vscode/settings.json" "{}\n"
touch_if_missing "configs/hooks/pre-commit.yaml" ""
touch_if_missing "configs/hooks/commit-msg" ""
touch_if_missing "configs/ci/github-actions.yml" ""
touch_if_missing "configs/ci/scripts/verify.sh" "#!/usr/bin/env bash\nset -euo pipefail\n"
touch_if_missing "configs/ci/scripts/fix.sh" "#!/usr/bin/env bash\nset -euo pipefail\n"
touch_if_missing "configs/ci/scripts/check.sh" "#!/usr/bin/env bash\nset -euo pipefail\n"

# runtime
mk "runtime/models"
mk "runtime/profiles"
mk "runtime/logs"
touch_if_missing "runtime/models/fast.json" "{}\n"
touch_if_missing "runtime/models/strong.json" "{}\n"
touch_if_missing "runtime/profiles/ollama.yaml" ""
touch_if_missing "runtime/profiles/lmstudio.yaml" ""
touch_if_missing "runtime/profiles/llama_cpp.yaml" ""

# templates
mk "templates/repo-agent/.agent/jobs"
mk "templates/makefiles"
touch_if_missing "templates/repo-agent/.agent/policy.yaml" ""
touch_if_missing "templates/repo-agent/.agent/constraints.yaml" ""
touch_if_missing "templates/repo-agent/.agent/memory.md" ""
touch_if_missing "templates/repo-agent/.agent/decisions.log" ""
touch_if_missing "templates/repo-agent/.agent/map.json" "{}\n"
touch_if_missing "templates/makefiles/python.Makefile" ""
touch_if_missing "templates/makefiles/node.Makefile" ""
touch_if_missing "templates/makefiles/mono.Makefile" ""

# tools
mk "tools/install"
mk "tools/dev"
mk "tools/maintenance"
touch_if_missing "tools/dev/run_agent.sh" "#!/usr/bin/env bash\nset -euo pipefail\npython -m adjutorix_agent.server.app\n"
touch_if_missing "tools/dev/run_extension.sh" "#!/usr/bin/env bash\nset -euo pipefail\necho \"Run VS Code extension via VS Code: F5 (Extension Development Host)\"\n"
touch_if_missing "tools/dev/smoke_test.sh" "#!/usr/bin/env bash\nset -euo pipefail\necho \"smoke\" \n"
touch_if_missing "tools/dev/release_extension.sh" "#!/usr/bin/env bash\nset -euo pipefail\necho \"build vsix\" \n"
touch_if_missing "tools/maintenance/rebuild_index.sh" "#!/usr/bin/env bash\nset -euo pipefail\n"
touch_if_missing "tools/maintenance/rotate_logs.sh" "#!/usr/bin/env bash\nset -euo pipefail\n"
touch_if_missing "tools/maintenance/sanitize_jobs.sh" "#!/usr/bin/env bash\nset -euo pipefail\n"

chmod +x setup.sh || true
chmod +x tools/dev/*.sh || true
chmod +x tools/maintenance/*.sh || true
chmod +x configs/ci/scripts/*.sh || true

echo "✅ Scaffold done."
