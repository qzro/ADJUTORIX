# ADJUTORIX

**ADJUTORIX is an AI agent system built for controlled, deterministic, and auditable execution.**

It is not “chat with tools.” It is **tool-first orchestration** with:
- **State-machine enforced execution** (SCAN → PLAN → PATCH → VERIFY → REPORT → STOP)
- **Diff-only edits** + approvals
- **Deterministic gates** (format/lint/type/test/security) before any commit/deploy
- **Job ledger** (plan, diff, commands, outputs, summary) for replay & audit
- **Policy governance** (allowlisted commands, protected files, no-network by default)
- **Local-first LLM** (Ollama / LM Studio / llama.cpp) for **zero API spend**

---

## What “zero cost” means here

- **No subscriptions**
- **No API spend**
- Uses your **existing laptop** (local models + deterministic tools)

---

## Architecture (high level)

- **VS Code extension** (`packages/adjutorix-vscode`): UI panel + approvals + diagnostics.
- **Local agent server** (`packages/adjutorix-agent`): JSON-RPC over localhost, tool registry, governance, job ledger.
- **Shared contracts/types** (`packages/shared`): single source of truth for RPC types + JSON schemas.
- **CLI (optional)** (`packages/adjutorix-cli`): terminal interface to the same agent.
- **Repo policies**: each repo gets a `.agent/` directory (policy, constraints, memory, jobs).

---

## Core rules (non-negotiable)

1. **Tools first, model last.**
2. **Diff-only edits** (no full-file rewrites).
3. **No silent guessing** (if unsure: search/index/entrypoints first).
4. **No destructive commands** without explicit override.
5. **Protected files** require extra confirmation.
6. **Verify parity**: local `verify` must match CI.

---

## One-click setup

### 1) Clone
bash
git clone <YOUR_ADJUTORIX_REPO_URL> ADJUTORIX
cd ADJUTORIX
`

### 2) Bootstrap

bash
bash tools/install/bootstrap.sh


This installs:

* ripgrep
* ctags (optional but recommended)
* Node deps for extension/shared
* Python deps for agent
* Wrangler (optional)
* Ollama (optional)

### 3) Run the agent

bash
bash tools/dev/run_agent.sh


### 4) Run the extension (dev)

bash
bash tools/dev/run_extension.sh


---

## Using ADJUTORIX in a repo (multi-repo support)

### 1) Add repo policy scaffold

Copy the template `.agent/` into any repo you want the agent to manage:

bash  
cp -R templates/repo-agent/.agent /path/to/your-repo/


### 2) Register repos in `~/.agent/workspaces.yaml`

Example:

yaml
workspaces:
  vatfix:
    path: /path/to/VATFix
    toolchain: node
    commands:
      check: "make check"
      fix: "make fix"
      verify: "make verify"
      deploy: "make deploy"


### 3) Operate via VS Code commands

Use the command palette:

* `Agent: Check`
* `Agent: Fix`
* `Agent: Patch from plan`
* `Agent: Explain failing tests`
* `Agent: Prepare commit`
* `Agent: Deploy`

---

## Toolchain expectations (your repo)

ADJUTORIX assumes each repo exposes a small set of deterministic commands:

* `fix` (autofix)
* `check` (read-only validation)
* `verify` (CI-parity validation)
* `deploy` (optional)

You can implement them via Makefile or scripts. Templates exist in:

* `templates/makefiles/`

---

## Security posture

* **Localhost-only** agent server with token auth
* **No network by default** for tool execution
* **Secrets scanning** before commit
* **Dependency audit** hooks
* **Job sanitization** for logs + redaction

See: `docs/security.md`

---

## Docs

* `docs/architecture.md` — system design
* `docs/protocol.md` — execution protocol & state machine
* `docs/NO_MERCY_CHECKLIST.md` — **state machine · wire protocol · patch flow** (Definition of Done, Level Up roadmap)
* `docs/security.md` — governance & safety model
* `docs/troubleshooting.md` — common failures and fixes

---

## Repo layout

text
ADJUTORIX/
├─ README.md
├─ LICENSE
├─ .gitignore
├─ docs/
├─ packages/
│  ├─ shared/
│  ├─ adjutorix-vscode/
│  ├─ adjutorix-agent/
│  └─ adjutorix-cli/
├─ configs/
├─ runtime/
├─ templates/
└─ tools/


---

## License

See `LICENSE`.


::contentReference[oaicite:0]{index=0}

