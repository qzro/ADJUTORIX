# ADJUTORIX v0.2.0 — Local Governed Operator Cockpit

## Status

ADJUTORIX v0.2.0 local governed operator cockpit is complete.

## Canonical merge

- Repository: qzro/ADJUTORIX
- PR: #84
- Merge method: squash
- Main SHA: b39a7736809d94e79bdcd445071e2c55401c585b
- Tag: adjutorix-local-operator-cockpit-v0.2.0

## Product lock

The default app surface is now the local governed operator cockpit.

Operator loop:

```text
REPO INTAKE
TRUST CLASSIFICATION
INTENT PLAN OBJECT
PATCH CUSTODY OBJECT
VERIFICATION GATE OBJECT
VERIFY RECEIPT OBJECT
APPLY GATE OBJECT
APPLY RECEIPT OBJECT
ROLLBACK GATE OBJECT
ROLLBACK RECEIPT OBJECT
ROLLBACK COMPLETE
```

## Proof

```text
ADJUTORIX_PR84_MERGED=true
ADJUTORIX_MAIN_SHA=b39a7736809d94e79bdcd445071e2c55401c585b
ADJUTORIX_MAIN_ROOT_VERIFY_PASS=true
ADJUTORIX_MAIN_REAL_ROOT_SMOKE_PASS=true
ADJUTORIX_MAIN_APP_PACKAGE_PASS=true
ADJUTORIX_LOCAL_OPERATOR_COCKPIT_TAG=adjutorix-local-operator-cockpit-v0.2.0
ADJUTORIX_V020_LOCAL_GOVERNED_OPERATOR_COCKPIT_COMPLETE=true
```

## Boundary

This release makes unsafe local code mutation unable to enter silently through the default app surface.
