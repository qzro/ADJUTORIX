# ADJUTORIX Architecture

## Overview

ADJUTORIX is a fully local, zero-subscription, AI-assisted development platform.
It combines:

- A VS Code extension (UI + control layer)
- A local agent server (governance + execution)
- Local LLM runtimes (Ollama / LM Studio / llama.cpp)
- Deterministic tooling
- Policy-driven automation

No cloud APIs. No external compute dependency.

All reasoning and execution happens on the user machine.

---

## High-Level Components



┌───────────────┐
│   VS Code UI  │
│  (Extension)  │
└───────┬───────┘
│ JSON-RPC
▼
┌────────────────────┐
│   Agent Server     │
│ (State + Policy)   │
└───────┬────────────┘
│
├── Tools Layer
├── Git / FS / Tests
├── Index / Memory
▼
┌────────────────────┐
│   LLM Runtime      │
│ (Ollama / LM / CPP)│
└────────────────────┘



---

## Core Design Principles

### 1. Tool-First Execution

All tasks are grounded in tools:

- Search
- Read
- Index
- Test
- Lint
- Build
- Git

The model is used only for:

- Planning
- Reasoning
- Patch synthesis

This minimizes hallucination.

---

### 2. Deterministic Governance

Every operation is constrained by:

- Policy files
- Allowlists
- State machine
- Patch gates
- Context budgets

No unrestricted execution is allowed.

---

### 3. Diff-Based Editing

All code changes are:

- Unified diffs
- Previewed
- Approved
- Applied atomically

No raw file overwrites.

---

### 4. Local-Only Security

- No outbound network by default
- Localhost-only server
- Token-based local auth
- Secrets scanning
- Protected file locks

---

## Layered Architecture

### 1. Presentation Layer (VS Code)

Location:


packages/adjutorix-vscode/



Responsibilities:

- Chat panel
- Job viewer
- Diff preview
- Diagnostics
- Command binding

No business logic.

---

### 2. Communication Layer (RPC)

Location:


packages/shared/src/rpc



Responsibilities:

- Typed RPC methods
- Error contracts
- Request validation
- Versioning

Ensures client/server compatibility.

---

### 3. Control Layer (Agent Core)

Location:


packages/adjutorix-agent/adjutorix_agent/core



Responsibilities:

- State machine
- Planning validation
- Execution orchestration
- Rollback
- Recovery
- Ledger

This is the system brain.

---

### 4. Tool Layer

Location:


packages/adjutorix-agent/adjutorix_agent/tools



Responsibilities:

- File system access
- Code intelligence
- Git integration
- Test execution
- Deployment
- Security scans

Tools are deterministic and sandboxed.

---

### 5. Intelligence Layer (LLM)

Location:


packages/adjutorix-agent/adjutorix_agent/llm



Responsibilities:

- Prompt templates
- Model routing
- Provider adapters
- Schema enforcement

Models never execute commands.

---

### 6. Memory Layer

Location:


packages/adjutorix-agent/adjutorix_agent/memory



Responsibilities:

- Session compaction
- Knowledge base
- Repo memory
- Decision tracking

Prevents context bloat.

---

## Execution Flow



User → VS Code → RPC → Agent → Tools/LLM → Agent → VS Code



Detailed flow:

1. User issues command
2. Extension sends RPC request
3. Agent enters SCAN state
4. Tools gather facts
5. PLAN generated and validated
6. PATCH created
7. VERIFY runs
8. REPORT written
9. Memory updated
10. UI refreshed

---

## State Machine

All jobs follow:



SCAN → PLAN → PATCH → VERIFY → REPORT → STOP



Enforced by:



core/state_machine.py



Illegal transitions are rejected.

---

## Governance Model

Policies are layered:



Global (~/.agent/global.yaml)
↓
Repo (.agent/constraints.yaml)
↓
Runtime Overrides



Enforced by:

- policy.py
- network_guard.py
- protected_files.py
- patch_gate.py

---

## Storage Layout

### Per-Repository



.agent/
policy.yaml
constraints.yaml
memory.md
decisions.log
map.json
jobs/



### Global



~/.agent/
knowledge/
cache/
profiles/



---

## Fault Tolerance

### Crash Recovery

- Jobs persisted
- State snapshots
- Auto-resume

Handled by:



core/recovery.py



---

### Rollback

All patches are reversible via:

- Git reset
- Reverse patch
- Ledger replay

Handled by:



core/rollback.py



---

## Scaling Characteristics

### Horizontal

- Multiple repos
- Workspace router
- Independent ledgers

### Vertical

- Model routing
- Context budgeting
- Index caching

---

## Security Boundaries

| Layer | Boundary |
|-------|----------|
| UI | No FS access |
| Agent | Policy-enforced |
| Tools | Allowlisted |
| LLM | Read-only |
| Network | Denied |

---

## Extension Points

ADJUTORIX supports:

- Custom tools
- Custom prompts
- New providers
- New policies
- New CI backends

All via plugin folders.

---

## Non-Goals

ADJUTORIX explicitly does NOT:

- Provide cloud inference
- Store user code remotely
- Perform autonomous pushes
- Execute unsafe commands
- Bypass repo governance

---

## Summary

ADJUTORIX is designed as:

- A local-first
- Policy-driven
- Tool-grounded
- Auditable
- Recoverable
- Professional-grade

development agent platform.

Its architecture prioritizes:

> Stability over speed  
> Determinism over magic  
> Control over automation
