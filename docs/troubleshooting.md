# ADJUTORIX Troubleshooting Guide

This document provides systematic procedures for diagnosing and fixing
failures in ADJUTORIX.

Follow the order. Do not guess.

---

## 1. Agent Does Not Start

### Symptoms

- VS Code shows "Agent unreachable"
- CLI hangs
- No response on localhost port

### Checks

1. Verify process:

bash
ps aux | grep adjutorix
`

2. Check port:

bash
lsof -i :8787


3. Inspect logs:

bash
cat runtime/logs/agent.log


---

### Fix

bash
tools/dev/run_agent.sh


If still failing:

bash
rm -rf ~/.agent/cache


Restart.

---

## 2. VS Code Extension Not Connecting

### Symptoms

* "RPC timeout"
* UI not loading
* Commands disabled

### Checks

1. Extension enabled
2. Agent running
3. Token valid

bash
cat ~/.adjutorix/token


---

### Fix

bash
tools/dev/run_extension.sh


Rebuild:

bash
cd packages/adjutorix-vscode
npm run build


---

## 3. LLM Not Responding

### Symptoms

* Infinite "thinking"
* Empty response
* Provider error

### Checks

#### Ollama

bash
ollama list
ollama ps


#### LM Studio

Check server UI.

---

### Fix

Restart runtime:

bash
ollama serve


or

bash
lmstudio server start


---

## 4. Commands Blocked by Policy

### Symptoms

* "Command denied"
* "Policy violation"

### Checks

bash
cat .agent/constraints.yaml
cat ~/.agent/global.yaml


---

### Fix

Add allowlist entry:

yaml
allowed_commands:
  - pytest
  - npm test


Restart agent.

---

## 5. Patch Rejected

### Symptoms

* "Patch gate violation"
* "Atomicity failed"

### Causes

* Too many files
* Protected file touched
* Test failure

---

### Debug

bash
cat .agent/jobs/*/diff.patch


bash
cat .agent/jobs/*/results.log


---

### Fix

Split patch.

Re-run verify.

---

## 6. Tests Failing After Patch

### Symptoms

* VERIFY stage fails
* CI mismatch

### Checks

bash
configs/ci/scripts/verify.sh


Run manually:

bash
./verify.sh


---

### Fix

Ensure:

* Same env
* Same deps
* Same flags

Re-run agent.

---

## 7. Secrets Detection Triggered

### Symptoms

* Commit blocked
* Push denied

### Checks

bash
runtime/logs/security.log


---

### Fix

Remove secret.

Rotate credential.

Re-run:

bash
git commit --amend


---

## 8. Indexing Broken

### Symptoms

* find_symbol fails
* dependency graph empty

### Checks

bash
which rg
which ctags


---

### Fix

Rebuild:

bash
tools/maintenance/rebuild_index.sh


---

## 9. Context Overflow Errors

### Symptoms

* Truncated responses
* Planner fails
* Model errors

### Checks

bash
cat .agent/memory.md


bash
cat .agent/map.json


---

### Fix

Force compaction:

bash
rm .agent/memory.md
touch .agent/memory.md


Restart agent.

---

## 10. Job Ledger Corruption

### Symptoms

* Recovery fails
* Resume blocked

### Checks

bash
ls .agent/jobs/


bash
sha256sum .agent/jobs/*/*


---

### Fix

Archive:

bash
mv .agent/jobs .agent/jobs.bak
mkdir .agent/jobs


Restart.

---

## 11. Deployment Failures

### Symptoms

* Wrangler error
* Build fails
* Rollback triggered

### Checks

bash
wrangler whoami
wrangler deploy --dry-run


---

### Fix

Re-auth:

bash
wrangler login


Verify config.

---

## 12. Agent Crash / Freeze

### Symptoms

* No response
* High CPU
* Zombie process

### Checks

bash
top
htop


bash
cat runtime/logs/crash.log


---

### Fix

Kill + restart:

bash
pkill adjutorix
tools/dev/run_agent.sh


---

## 13. Workspace Routing Errors

### Symptoms

* Wrong repo selected
* Commands run in wrong dir

### Checks

bash
cat ~/.agent/workspaces.yaml


---

### Fix

Update mapping.

Restart agent.

---

## 14. Recovery Mode

When system is unstable:

bash
adjutorix --recovery


This:

* Locks workspace
* Loads last good job
* Disables automation
* Enables manual control

---

## 15. Full Reset (Last Resort)

Deletes all runtime state.

bash
rm -rf ~/.agent
rm -rf runtime/logs/*
rm -rf .agent


Reinstall:

bash
tools/install/bootstrap.sh


---

## Diagnostic Priority Order

Always debug in this order:

1. Agent logs
2. Job ledger
3. Policy files
4. Tool output
5. Model logs

Skipping order wastes time.

---

## Reporting Bugs

Include:


agent.log
security.log
job folder
reproduction steps
OS/version
model/runtime


Without these, issues are ignored.

---

## Summary

Most failures are caused by:

* Missing dependencies
* Policy violations
* CI mismatch
* Context overflow
* Broken index

Fix root causes. Do not patch symptoms.



