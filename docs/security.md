# ADJUTORIX Security Model

## Purpose

This document defines the mandatory security architecture of ADJUTORIX.

The system is designed under **Zero-Trust Local Automation**:

- Assume tools can fail
- Assume models can hallucinate
- Assume users can make mistakes
- Prevent irreversible damage

Security is enforced by code, not policy.

---

## Threat Model

### In-Scope Threats

| Category | Description |
|----------|-------------|
| Hallucination | Model invents paths/symbols |
| Destructive Commands | rm, overwrite, mass delete |
| Secret Leakage | API keys, tokens, creds |
| Supply Chain | Malicious deps |
| Privilege Escalation | Network/system abuse |
| Repo Corruption | Invalid patches |
| Credential Theft | Git/Cloudflare misuse |

### Out-of-Scope

- Physical access
- Kernel-level compromise
- OS rootkits

---

## Trust Boundaries



User → VSCode → Agent → Tools → OS



Each boundary is sandboxed.

No component is trusted fully.

---

## Authentication & Access

### Local Authentication

- Agent binds to 127.0.0.1 only
- Token-based handshake
- Per-session token rotation

File: `server/auth.py`



~/.adjutorix/token



Permissions: 600

---

### No Remote Access

By default:

- No external HTTP
- No cloud callbacks
- No remote execution

Network disabled unless overridden.

---

## Sandbox Enforcement

### Command Allowlist

Only registered commands may execute.

Defined in:



.agent/constraints.yaml
~/.agent/global.yaml



Enforced by:



tools/run/allowlist.py



---

### Blocked Operations

Always denied:



rm -rf /
dd if=
mkfs
curl | sh
wget | sh
chmod 777
chown -R



Unless explicit OVERRIDE.

---

## Protected Files System

Critical files are locked:

Examples:



.env
*.pem
*.key
.github/workflows/*
infra/*
deploy/*
billing/*



Rules:

- Read: allowed
- Write: confirmation + override
- Patch: double validation

File: `governance/protected_files.py`

---

## Secrets Detection

### Pre-Commit

Secrets scanned before commit:

- API keys
- JWT tokens
- OAuth secrets
- Cloud creds
- Private keys

File: `security/secrets_scan.py`

Patterns updated centrally.

---

### Runtime Scan

Before push/deploy:



secrets_scan → git push



If detected → block.

---

## Dependency Security

### Lockfile Validation

Rules:

- lockfile required
- no floating versions
- no git+ssh deps

File: `security/dep_audit.py`

---

### Vulnerability Scan

Where available:

- pip audit
- npm audit
- osv database

Fail → block deploy.

---

## Network Guard

Module: `governance/network_guard.py`

Rules:

Default:



DENY ALL



Allowed:

- localhost
- model runtimes
- git remotes (optional)

Everything else blocked.

---

## Patch Security

### Patch Gate

All diffs validated:

- file count
- line count
- protected files
- atomicity

File: `core/patch_gate.py`

---

### Integrity Check

Before apply:



hash(original)
apply patch
hash(new)
verify diff matches



Prevents tampering.

---

## Rollback Guarantees

Every mutation has:

- Pre-state snapshot
- Reverse patch
- Git restore point

File: `core/rollback.py`

No untracked destructive change allowed.

---

## Job Ledger Security

Job records are immutable.

Location:



.agent/jobs/



Rules:

- Append-only
- SHA256 checksums
- Timestamped

Tampering invalidates chain.

---

## Context Injection Defense

Models cannot:

- See full repo
- Modify memory directly
- Bypass compactor

All context passes through:



core/context_budget.py
memory/compactor.py



---

## Privilege Separation

| Component | Privilege |
|-----------|-----------|
| VSCode | User |
| Agent | User |
| Tools | Restricted |
| Models | No FS access |

No elevated privileges.

No sudo.

---

## Override System

Overrides require:



OVERRIDE_REASON
OVERRIDE_SCOPE
OVERRIDE_EXPIRY
USER_CONFIRMATION



Logged permanently.

---

## Audit Logging

All security events logged:



runtime/logs/security.log



Includes:

- blocked commands
- secret detections
- override use
- failed auth
- policy violations

---

## Incident Response

### Detection

Triggered by:

- secret leak
- policy violation
- crash
- corruption

---

### Response

1. Freeze agent
2. Lock workspace
3. Preserve artifacts
4. Notify user
5. Require manual reset

---

## Secure Defaults

| Feature | Default |
|---------|----------|
| Network | Disabled |
| Overrides | Off |
| Protected Files | On |
| Secrets Scan | On |
| CI Parity | Enforced |
| Multi-job | Disabled |

---

## Backup Strategy

Critical data:



.agent/
runtime/logs/
configs/



Recommended: encrypted backup.

---

## Compliance

All modules must:

- Pass sandbox checks
- Respect protected files
- Emit audit logs
- Validate patches

Violation = Critical Fault.

---

## Summary

ADJUTORIX security guarantees:

- No silent destruction
- No secret leakage
- No uncontrolled execution
- Full traceability
- Deterministic rollback

Security is enforced by architecture, not trust.

