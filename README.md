# ADJUTORIX

ADJUTORIX is a governed mutation, ledger, replay, and verification workspace built as a multi-package monorepo.

## Repository Layout

- `packages/adjutorix-agent` — execution, governance, ledger, replay, storage, verification
- `packages/adjutorix-app` — desktop application surface
- `packages/adjutorix-cli` — command-line operator surface
- `packages/orchestrator` — startup, shutdown, capability, dependency, and runtime guard orchestration
- `packages/shared` — canonical cross-package contracts, invariants, runtime types, and protocol surface
- `scripts` — operator entrypoints
- `tests` — repository-level contract, invariant, replay, recovery, performance, and end-to-end coverage
- `configs` — policy, CI, contracts, runtime, and tooling configuration

## Core Operating Rules

- no invisible mutation
- no direct write bypass around governed flows
- no unverifiable claim of state
- no replay ambiguity
- no renderer authority over protected mutation paths

## Primary Operator Commands

```bash
bash ./scripts/check.sh
bash ./scripts/smoke.sh
bash ./scripts/verify.sh
bash ./scripts/build.sh
bash ./scripts/doctor.sh
````

## Workspace Commands

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run check
pnpm run verify
```

## Packaging

```bash
bash ./scripts/package-macos.sh
```


## License

This repository is licensed under the GNU Affero General Public License v3.0 only.

SPDX-License-Identifier: AGPL-3.0-only

Copyright (C) 2026 qzro / Midia Kiasat.

See [LICENSE](LICENSE), [COPYRIGHT.md](COPYRIGHT.md), and [.reuse/dep5](.reuse/dep5).\n\n## Copyright and License Boundary\n\nCopyright (C) 2026 qzro / Midia Kiasat.\n\nThis repository is licensed under the GNU Affero General Public License v3.0 only.\n\nSPDX-License-Identifier: AGPL-3.0-only\n\nAll copyright notices, attribution records, provenance records, repository-level legal notices, and authorship markers must be preserved. No repository surface may imply that the work is licensed under any license other than AGPL-3.0-only unless a later explicit governance act changes the license boundary.\n\n