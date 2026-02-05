# ADJUTORIX — No Mercy Checklist (State Machine · Wire Protocol · Patch Flow)

This is the **complete checklist** for turning ADJUTORIX from "toy UI" into a **real governed execution system**.

**Non‑negotiable core:**  
**Prompt → Plan → Patch → Review → Apply → Run → Result**

ADJUTORIX "levels up" only when this flow is enforced by:

1. a **state machine** (hard transitions, no ambiguity)
2. a **wire protocol** (typed envelopes, versioned)
3. a **ledger** (everything replayable)
4. a **patch gate** (no disk mutation without review + apply)

---

## 0) Definition of Done (DoD)

✅ A user can start from an empty workspace and:

* send a prompt
* receive a plan with explicit steps
* generate a patch (no disk mutation)
* review patch with diff + file ops
* accept patch
* apply patch (mutates disk)
* run job(s)
* see streaming logs + final result
* replay the whole session deterministically from the ledger

✅ The UI is not "buttons"; it is a **rendered projection of state**.

✅ Every state transition is validated server-side (agent).

---

## 1) State Machine (the real "LEVEL UP")

### 1.1 Canonical States

You must implement these states **in the agent** and mirror them in UI.

**Session / Flow State:**

* `idle`
* `prompt_received`
* `planning`
* `plan_ready`
* `patch_generating`
* `patch_proposed`
* `patch_reviewing`
* `patch_accepted`
* `patch_rejected`
* `patch_applying`
* `patch_applied`
* `running`
* `result_ready`
* `error`

**Engine Connectivity State:**

* `disconnected`
* `connecting`
* `connected`
* `failed`

### 1.2 Allowed Transitions (hard rules)

Implement a transition table. If a client requests an invalid transition → reject with typed error.

**Core flow transitions:**

* `idle → prompt_received`
* `prompt_received → planning`
* `planning → plan_ready`
* `plan_ready → patch_generating` (only if plan includes patch step)
* `patch_generating → patch_proposed`
* `patch_proposed → patch_reviewing`
* `patch_reviewing → patch_accepted | patch_rejected`
* `patch_accepted → patch_applying`
* `patch_applying → patch_applied`
* `patch_applied → running`
* `running → result_ready`
* `* → error` (any state)
* `error → idle` (explicit reset)

### 1.3 Invariants (if violated, system is fake)

* You cannot call `apply` unless `patch_accepted`.
* You cannot call `run` unless `patch_applied` OR run is a pure read-only job.
* You cannot produce a patch without a plan that references it.
* Every patch has: id, base_rev/base_sha, file ops, summary, provenance (which plan step generated it).
* Every job has: id, kind, cwd, inputs, exit code, logs, artifact refs.

---

## 2) Wire Protocol (versioned envelopes)

### 2.1 Single canonical envelope

Everything across RPC must be wrapped:

**Envelope fields (required):**

* `type` (event / response / error)
* `protocol` (int)
* `trace_id` (string)
* `ts_ms` (number)
* `session_id` (string)
* `state` (current flow state)
* `payload` (typed by `type`)

### 2.2 Required message types

You need these message families:

**Connectivity / capabilities**

* `ping`
* `capabilities`
* `authority`

**Chat / planning**

* `prompt.submit`
* `plan.create`
* `plan.result`

**Patch lifecycle**

* `patch.propose`
* `patch.list`
* `patch.get`
* `patch.review` (server emits review metadata)
* `patch.accept`
* `patch.reject`
* `patch.apply`
* `patch.applied`

**Job lifecycle**

* `job.run`
* `job.started`
* `job.logs`
* `job.status`
* `job.finished`

**Ledger**

* `ledger.append` (server internal)
* `ledger.tail`
* `ledger.replay`

**Errors**

* `error.invalid_transition`
* `error.protocol_mismatch`
* `error.method_not_found`
* `error.permission_denied`
* `error.base_mismatch`

### 2.3 Protocol rules

* Protocol version mismatch must be fatal and explicit.
* UI must not "guess" behavior; it must render server-provided `state` + `allowed_actions`.

---

## 3) Authority & Policy (who can mutate what)

### 3.1 Authority response must include

* `writes_allowed: boolean`
* `writes_note: string` (why)
* `actions_allowed: string[]` (server truth)
* `sandbox_enforced: boolean`
* `ledger_state: string`
* `pending_patches: number`
* `pending_jobs: number`
* `allowed_transitions: string[]` OR `allowed_actions: string[]`

### 3.2 Hard policy gates

* In **External** mode: apply is disabled, deploy disabled.
* In **Managed** mode: apply allowed only if agent ownership is `managed`.
* In **Auto/Planner** mode: nothing mutates disk; can only propose.

---

## 4) Patch System (not "diff text"; real file ops)

### 4.1 Patch format: file operations

Each patch is a deterministic set of ops:

* `write { path, base_sha, new_content_b64 }`
* `delete { path, base_sha }`
* `rename { from, to, base_sha }`

### 4.2 Review requirements

The review payload must include:

* per-file base mismatch detection
* per-op summaries
* ability to show unified diff (derived) when text
* binary markers when not diffable

### 4.3 Accept / Reject

* `accept` locks patch to a specific base_rev
* `reject` must record rationale

### 4.4 Apply semantics

* apply is atomic (either all ops apply or none)
* conflict reporting: list conflict files + reasons
* on success: emit `patch.applied` + update ledger

---

## 5) Plan System (Plan is not a paragraph)

### 5.1 Plan schema

* `goal`
* `constraints` (policy, sandbox, time)
* `steps[]`: { `id`, `action`, `tool`, `inputs`, `outputs`, `risk` }
* `expected_artifacts` (patch ids, job ids)

### 5.2 Plan must map to operations

Every step must map to exactly one of:

* propose patch
* run job
* verify
* deploy

If a step cannot map → invalid plan.

---

## 6) Job System (streaming + terminal truth)

### 6.1 Job API requirements

* `job.run(kind, cwd, confirm, inputs)` → `{ job_id }`
* `job.logs(id, since_seq)` → `{ lines[], next_seq, done }`
* `job.status(id)` → `{ state, summary, report, exit_code }`

### 6.2 Job states

* `queued`
* `running`
* `success`
* `failed`
* `canceled`
* `aborted`

### 6.3 UI invariants

* UI must not pollute transcript with logs; logs have a dedicated stream view.
* transcript is for human narrative + decisions.

---

## 7) Ledger (the reason ADJUTORIX exists)

### 7.1 Ledger entries

Every event recorded as:

* `seq`
* `trace_id`
* `type`
* `state_before`
* `state_after`
* `payload_hash`
* `payload`

### 7.2 Replay

* `ledger.replay(session_id)` must reproduce patches + job commands deterministically.
* if replay diverges, it's a bug, not "expected".

---

## 8) UI Surface (stop being a toy)

### 8.1 UI must render state, not features

The UI is a projection of:

* connectivity state
* flow state
* allowed actions
* pending artifacts

### 8.2 Required UI sections

* **Flow timeline**: Prompt → Plan → Patch → Review → Apply → Run → Result (active step highlighted)
* **Plan panel**: structured steps + buttons only for allowed next actions
* **Patch queue**: proposed/accepted/applied with review modal
* **Job runner**: running job(s) + logs stream + terminal status
* **Result panel**: report summary + artifacts
* **Ledger panel**: last N events + replay button (read-only unless managed)

### 8.3 Buttons are derived

No hard-coded "Check/Fix/Verify/Deploy" as primary navigation.  
Those are *actions* that appear only when allowed by state + authority.

---

## 9) Engine/Extension Integration (the real failure source)

### 9.1 Non-negotiable contracts

* Extension must not claim "managed" if ownership isn't `managed`.
* Agent must not accept "apply" unless ownership+mode allow it.
* `capabilities` must enumerate methods and protocol.

### 9.2 Readiness gating

* No postMessage before webview is ready.
* No status lies: UI must show FAILED if server says failed.

---

## 10) Test Matrix (prove it works)

### 10.1 Unit tests

* transition table validation
* patch base mismatch detection
* apply atomicity
* job state machine

### 10.2 Integration tests

* prompt→plan→patch→accept→apply→run end-to-end
* restart agent mid-flow and recover from ledger
* protocol mismatch handling

### 10.3 UX tests

* user cannot click themselves into an illegal state
* every error gives next actionable move (retry, reset, inspect)

---

## 11) "Kill the bullshit" Removal Checklist

Delete or demote anything that violates state-driven UI:

* hard-coded primary actions as the product
* chat pretending it can act without passing through plan/patch gates
* any direct disk mutation path that bypasses patch.apply
* any UI that can show success without verified server ack

---

## 12) Immediate Next Patch List (highest ROI)

1. **Add server-defined `flow_state` + `allowed_actions`** to `status` (or a new `session.status`).
2. **Refactor UI to render a Flow Timeline** and show only allowed next actions.
3. **Make Plan structured** (steps array), stop using text-only.
4. **Patch lifecycle must be first-class**: propose/review/accept/apply.
5. **Job runner view**: streaming logs + terminal state.
6. **Ledger tail panel**: last 50 events + replay.

---

## 13) What "LEVEL UP" means (in one line)

**LEVEL UP = Replace "buttons + chat" with a state machine + protocol that forces Prompt → Plan → Patch → Review → Apply → Run → Result, recorded in a ledger, replayable, and policy-gated.**

---

## Current alignment (tracking)

Use this section to tick what exists and what’s missing. Update as you implement.

| Area | Status | Where / Notes |
|------|--------|----------------|
| **Ledger (SQLite)** | ✅ | `sqlite_ledger.py`: jobs + patches + file_revs; migrations; recovery |
| **Patch RPC** | ✅ | `patch.propose`, `patch.list`, `patch.get`, `patch.accept`, `patch.reject`, `patch.apply` in `rpc.py` |
| **Patch apply gate** | ✅ | Preflight (base_sha vs file_revs/disk), atomic per-file, path traversal hardened |
| **Job RPC** | ✅ | `job.run`, `job.status`, `job.logs`, `job.list_recent` |
| **Authority** | ✅ | `rpc_authority` / `authority` returns writes_allowed, actions_allowed, ledger_state, pending_* |
| **Capabilities** | ✅ | Protocol version + methods; UI checks job.run |
| **Engine connectivity state** | ✅ | Extension: disconnected/connecting/connected/failed; sticky FAILED + retry |
| **Readiness gating** | ✅ | `webviewReady` + `pendingWebviewMsgs` + flush on `ready` |
| **Chat envelope** | ✅ | `chat` returns intent (no_action, propose_patch, propose_job); no acting without plan |
| **v3 wire protocol** | ✅ | protocol 3: hello/ready/intent/event/ack; seq/ack + ring buffer; single delivery path |
| **Workflow state machine (extension)** | ✅ | WorkflowStore + handleIntent; IDLE→…→DONE/FAILED; review→arm→typed APPLY→apply |
| **Workflow rail UI** | ✅ | WORKFLOW panel: state, prompt, plans, patch, review, result; buttons gated by snapshot |
| **Intent dedupe + replay** | ✅ | intent_id seen/mark; event ring (200); resendFrom on ready |
| **Jobs in workflow** | ✅ | upsertJob on start/terminal; job logs as event(log scope:job); snapshot.jobs |
| **Auto-verify after apply** | ✅ | apply.confirm → patch.apply → run verify → RESULT_READY from verify result |
| **Deploy gate** | ✅ | run.request(deploy) only if result.regression === "pass" |
| **Flow state machine (server)** | ✅ | `core/workflow.py`: FlowState, TRANSITIONS dict, apply_intent; `allowed_intents_from_transitions(state)`; `workflow.get` / `workflow.intent` RPC; patch.apply and job.run(deploy) gated by state/authority |
| **Plan structured** | ⚠️ | `core/plan.py` + `core/plan_compile.py` + `validate_plan`; steps[] schema; planner still returns text; plan execution cursor not wired |
| **Ledger tail / replay** | ✅ | `workflow_events` table; `ledger.tail`, `ledger.replay` RPC; workflow intents append to session event log |
| **patch.review / patch.applied** | ⚠️ | Review is get+include_review; no server-emitted `patch.applied` event |
| **Error types** | ⚠️ | RpcError codes exist; WorkflowError with error.invalid_transition etc. |
| **writes_allowed configurable** | ✅ | `ADJUTORIX_WRITES_ALLOWED=1` enables apply path; `ADJUTORIX_DEPLOY_ALLOWED=1` adds deploy to actions_allowed |
| **run.request from PLAN_SELECTED** | ✅ | Only read-only kinds (check, verify); fix/deploy require APPLIED+ |
| **Honest state space** | ✅ | INTAKE, PATCH_PROPOSED removed from FLOW_STATES (no transition enters them) |

**Legend:** ✅ done | ⚠️ partial | ❌ not started

**Exact server-side transition table:** Implemented in `core/workflow.py`: `TRANSITIONS` dict (state → intent.kind → {guard, next, effects}); `allowed_intents(state)` = `allowed_intents_from_transitions(state)`. No INTAKE/PATCH_PROPOSED; run.request from PLAN_SELECTED is read-only (check/verify) only.

**Corrective moves applied:**

1. **writes_allowed** — No longer hardcoded False. `rpc_authority()` reads `ADJUTORIX_WRITES_ALLOWED` and `ADJUTORIX_DEPLOY_ALLOWED`; apply path is executable when enabled.
2. **Unreachable states** — INTAKE and PATCH_PROPOSED removed from `FLOW_STATES` and `_CANCEL_FROM`; `allowed_intents` derived from `TRANSITIONS[state].keys()` (no phantom states).
3. **Single apply gate** — Apply remains only via `workflow.intent(kind=apply.confirm)`; `rpc_patch_apply` when called with workflow_session_id + consent_token checks same preconditions (APPLY_ARMED, token, writes_allowed).
4. **run.request invariant** — From PLAN_SELECTED only check/verify allowed; fix/deploy require APPLIED (or RESULT_READY/DONE).

**Still missing (final kills):**

1. ~~**Server-side transition table**~~ — ✅ Done: canonical `TRANSITIONS` in `workflow.py`; `allowed_intents_from_transitions(state)`.
2. **Plan execution cursor** — Wire plan.generate to structured plan; advance by `plan_cursor` + `next_plan_effect`; UI from allowed_intents.
3. **Ledger replay UI panel** — RPCs exist; user-visible tail + replay panel in extension.
