# ADJUTORIX Execution Protocol

## Purpose

This document defines the mandatory execution protocol for all ADJUTORIX jobs.

Every task MUST follow the same deterministic lifecycle to ensure:

- Safety
- Auditability
- Reproducibility
- Predictability
- Zero hallucination drift

No component may bypass this protocol.

---

## State Machine

All jobs follow exactly:



SCAN → PLAN → PATCH → VERIFY → REPORT → STOP



Illegal transitions are rejected.

---

## State Definitions

### 1. SCAN

**Goal:** Collect verified facts.

Allowed actions:

- search
- read_file
- list_files
- index lookup
- dependency graph
- test discovery
- config inspection

Forbidden:

- write
- patch
- commit
- deploy

Outputs:

- File slices
- Index metadata
- Error traces
- Dependency maps

---

### 2. PLAN

**Goal:** Produce an executable plan.

Required structure:



Objective:
Files:
Commands:
Pass Condition:
Rollback:
Risk:



Rules:

- Must reference SCAN outputs
- Must satisfy policy
- Must fit context budget
- Must validate against schema

Invalid plans are rejected.

---

### 3. PATCH

**Goal:** Generate atomic diffs.

Allowed actions:

- diff synthesis
- patch validation
- schema validation

Rules:

- Unified diff format
- ≤ N files unless override
- No protected files without approval
- Every hunk justified

No direct file writes allowed.

---

### 4. VERIFY

**Goal:** Prove correctness.

Allowed actions:

- run tests
- run linters
- build
- typecheck
- security scans

Rules:

- Must use repo-defined commands
- Must match CI config
- Must produce logs

Failures trigger rollback.

---

### 5. REPORT

**Goal:** Persist knowledge.

Actions:

- Write summary
- Update memory
- Append decisions
- Store artifacts
- Update ledger

Artifacts:



plan.md
diff.patch
commands.log
results.log
summary.md



---

### 6. STOP

**Goal:** Clean termination.

Actions:

- Release locks
- Flush logs
- Close RPC session
- Reset context

No further execution allowed.

---

## Transition Rules

| From   | To    | Condition |
|--------|-------|-----------|
| SCAN   | PLAN  | Facts collected |
| PLAN   | PATCH | Plan validated |
| PATCH  | VERIFY| Patch applied |
| VERIFY | REPORT| All checks pass |
| REPORT | STOP  | Memory updated |

Rollback may force:



ANY → SCAN



---

## Hard Invariants

These rules are never bypassed.

### Invariant 1: No Guessing

If symbol/path/entrypoint is unknown → SCAN again.

---

### Invariant 2: No Direct Writes

All edits must be patches.

---

### Invariant 3: One Job at a Time

Only one active job per workspace.

Enforced by locks.

---

### Invariant 4: Tool Priority

Tools precede model reasoning.

---

### Invariant 5: Audit Trail

Every action is logged.

No silent execution.

---

## Failure Handling

### Planning Failure

→ Return to SCAN.

### Patch Failure

→ Regenerate PATCH.

### Verification Failure

→ Rollback → SCAN.

### System Crash

→ Recovery module resumes.

---

## Override Protocol

Overrides require:



OVERRIDE_REASON
OVERRIDE_SCOPE
OVERRIDE_DURATION



Stored in ledger.

---

## Context Budget Enforcement

Each phase enforces limits:

| Phase | Max Tokens | Max Files |
|-------|------------|-----------|
| SCAN  | 6k         | 40        |
| PLAN  | 4k         | 15        |
| PATCH | 6k         | 10        |
| VERIFY| 2k         | 5         |

Exceed → compress.

---

## Example Job



SCAN:
search("auth error")
read_file(auth.py:1-200)

PLAN:
Fix token validation
Files: auth.py
Commands: pytest auth
Pass: All tests green
Rollback: git checkout

PATCH:
unified diff

VERIFY:
pytest auth

REPORT:
summary.md written

STOP



---

## Compliance

All modules must:

- Validate state transitions
- Reject illegal actions
- Emit structured logs
- Preserve artifacts

Non-compliance is treated as a critical fault.

---

## Summary

This protocol guarantees:

- Deterministic execution
- Safe automation
- Full traceability
- Zero silent failures

Every ADJUTORIX job is governed by this lifecycle.

