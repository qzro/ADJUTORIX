"""
Server-side workflow state machine (v3).
Enforces Prompt → Plan → Patch → Review → Apply → Run → Result.
Agent is authoritative: invalid transitions return typed error, no side effects.
"""

from __future__ import annotations

import secrets
import time
from typing import Any, Dict, List, Optional, Tuple

# Canonical flow states (match extension v3). INTAKE/PATCH_PROPOSED removed: no transition enters them.
FLOW_STATES = (
    "IDLE",
    "PLAN_DRAFT",
    "PLAN_SELECTED",
    "REVIEW_REQUIRED",
    "APPLY_ARMED",
    "APPLIED",
    "RUNNING",
    "RESULT_READY",
    "DONE",
    "FAILED",
    "ABORTED",
)

# Error codes for typed rejection (protocol 3)
ERROR_INVALID_TRANSITION = "error.invalid_transition"
ERROR_PRECONDITION_FAILED = "error.precondition_failed"
ERROR_PERMISSION_DENIED = "error.permission_denied"
ERROR_INVALID_ARGUMENT = "error.invalid_argument"
ERROR_INTERNAL = "error.internal"


class WorkflowError(Exception):
    """Typed rejection: do not mutate state."""

    def __init__(
        self,
        code: str,
        message: str,
        detail: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}


def _random_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}_{int(time.time() * 1000):x}"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _empty_snapshot(workflow_id: Optional[str] = None) -> Dict[str, Any]:
    return {
        "workflow_id": workflow_id or _random_id("wf"),
        "state": "IDLE",
        "plans": [],
        "jobs": [],
    }


def _copy_snapshot(snap: Dict[str, Any], **overrides: Any) -> Dict[str, Any]:
    out = dict(snap)
    out.update(overrides)
    return out


# ---------------------------------------------------------------------------
# Transition table: (allowed_from, guard_fn, next_state, effects)
# Guard returns (True, None) or (False, WorkflowError)
# ---------------------------------------------------------------------------

def _guard_true() -> Tuple[bool, Optional[WorkflowError]]:
    return True, None


def _check_reset(_snap: Dict[str, Any], _intent: Dict[str, Any], _ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    return True, None


def _check_cancel(snap: Dict[str, Any], _intent: Dict[str, Any], _ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s in ("IDLE", "DONE", "FAILED", "ABORTED"):
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"workflow.cancel not allowed from {s}",
            detail={"intent_kind": "workflow.cancel", "from_state": s, "allowed_from": list(_CANCEL_FROM)},
        )
    return True, None


_CANCEL_FROM = {
    "PLAN_DRAFT", "PLAN_SELECTED", "REVIEW_REQUIRED", "APPLY_ARMED",
    "APPLIED", "RUNNING", "RESULT_READY",
}


def _check_workflow_new(snap: Dict[str, Any], intent: Dict[str, Any], _ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s not in ("IDLE", "DONE", "FAILED", "ABORTED"):
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"workflow.new not allowed from {s}",
            detail={"intent_kind": "workflow.new", "from_state": s},
        )
    prompt = (intent.get("prompt") or "").strip()
    if not prompt:
        return False, WorkflowError(ERROR_PRECONDITION_FAILED, "workflow.new requires non-empty prompt")
    return True, None


def _check_freeze_context(
    snap: Dict[str, Any], _intent: Dict[str, Any], _ctx: Dict[str, Any]
) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s not in ("PLAN_DRAFT", "PLAN_SELECTED", "REVIEW_REQUIRED", "APPLY_ARMED"):
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"workflow.freeze_context not allowed from {s}",
            detail={"intent_kind": "workflow.freeze_context", "from_state": s},
        )
    return True, None


def _check_plan_generate(snap: Dict[str, Any], _intent: Dict[str, Any], _ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s not in ("PLAN_DRAFT", "PLAN_SELECTED"):
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"plan.generate not allowed from {s}",
            detail={"intent_kind": "plan.generate", "from_state": s},
        )
    if not (snap.get("prompt") or "").strip():
        return False, WorkflowError(ERROR_PRECONDITION_FAILED, "plan.generate requires prompt")
    return True, None


def _check_plan_select(snap: Dict[str, Any], intent: Dict[str, Any], _ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s not in ("PLAN_DRAFT", "PLAN_SELECTED"):
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"plan.select not allowed from {s}",
            detail={"intent_kind": "plan.select", "from_state": s},
        )
    plan_id = intent.get("plan_id")
    plans = snap.get("plans") or []
    if not any(p.get("plan_id") == plan_id for p in plans):
        return False, WorkflowError(ERROR_INVALID_ARGUMENT, f"Unknown plan_id: {plan_id}")
    return True, None


def _check_patch_generate(snap: Dict[str, Any], _intent: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s != "PLAN_SELECTED":
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"patch.generate not allowed from {s} (strict: only PLAN_SELECTED)",
            detail={"intent_kind": "patch.generate", "from_state": s},
        )
    if not snap.get("selected_plan_id"):
        return False, WorkflowError(ERROR_PRECONDITION_FAILED, "patch.generate requires selected_plan_id")
    return True, None


def _check_patch_review_complete(snap: Dict[str, Any], intent: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s != "REVIEW_REQUIRED":
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"patch.review_complete not allowed from {s}",
            detail={"intent_kind": "patch.review_complete", "from_state": s},
        )
    if not snap.get("patch"):
        return False, WorkflowError(ERROR_PRECONDITION_FAILED, "patch.review_complete requires patch")
    review = intent.get("review")
    if not isinstance(review, dict):
        return False, WorkflowError(ERROR_INVALID_ARGUMENT, "patch.review_complete requires review object")
    approved = review.get("approved")
    if approved and not ctx.get("authority", {}).get("writes_allowed"):
        return False, WorkflowError(
            ERROR_PERMISSION_DENIED,
            "Review approved but writes not allowed; cannot advance to APPLY_ARMED",
        )
    return True, None


def _check_apply_arm(snap: Dict[str, Any], _intent: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s not in ("REVIEW_REQUIRED", "APPLY_ARMED"):
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"apply.arm not allowed from {s}",
            detail={"intent_kind": "apply.arm", "from_state": s},
        )
    if not (snap.get("review") or {}).get("approved"):
        return False, WorkflowError(ERROR_PRECONDITION_FAILED, "apply.arm requires review.approved")
    if not snap.get("patch"):
        return False, WorkflowError(ERROR_PRECONDITION_FAILED, "apply.arm requires patch")
    if not ctx.get("authority", {}).get("writes_allowed"):
        return False, WorkflowError(ERROR_PERMISSION_DENIED, "apply.arm requires writes_allowed")
    return True, None


def _check_apply_confirm(snap: Dict[str, Any], intent: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s != "APPLY_ARMED":
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"apply.confirm not allowed from {s}",
            detail={"intent_kind": "apply.confirm", "from_state": s, "allowed_from": ["APPLY_ARMED"]},
        )
    token = intent.get("consent_token")
    armed = snap.get("armed") or {}
    if armed.get("consent_token") != token:
        return False, WorkflowError(ERROR_PERMISSION_DENIED, "Bad consent token")
    if not snap.get("patch", {}).get("patch_id"):
        return False, WorkflowError(ERROR_PRECONDITION_FAILED, "No patch_id to apply")
    if not ctx.get("authority", {}).get("writes_allowed"):
        return False, WorkflowError(ERROR_PERMISSION_DENIED, "apply.confirm requires writes_allowed")
    return True, None


# Read-only run kinds: allowed from PLAN_SELECTED (no patch applied yet).
_READ_ONLY_RUN_KINDS = ("check", "verify")
# Mutating kinds require APPLIED (patch applied) or later.
_MUTATING_RUN_KINDS = ("fix", "deploy")


def _check_run_request(snap: Dict[str, Any], intent: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    allowed = ("PLAN_SELECTED", "APPLIED", "RESULT_READY", "DONE")
    if s not in allowed:
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"run.request not allowed from {s}",
            detail={"intent_kind": "run.request", "from_state": s, "allowed_from": list(allowed)},
        )
    kind = intent.get("kind_run") or "check"
    # From PLAN_SELECTED only read-only kinds (check, verify). Mutating kinds require APPLIED+.
    if s == "PLAN_SELECTED" and kind in _MUTATING_RUN_KINDS:
        return False, WorkflowError(
            ERROR_PRECONDITION_FAILED,
            f"run.request kind '{kind}' not allowed from PLAN_SELECTED (read-only check/verify only until patch applied)",
            detail={"intent_kind": "run.request", "from_state": s, "allowed_kinds": list(_READ_ONLY_RUN_KINDS)},
        )
    if kind == "deploy":
        actions = (ctx.get("authority") or {}).get("actions_allowed") or []
        if "deploy" not in actions:
            return False, WorkflowError(ERROR_PERMISSION_DENIED, "deploy not in actions_allowed")
        if (snap.get("result") or {}).get("regression") != "pass":
            return False, WorkflowError(
                ERROR_PRECONDITION_FAILED,
                "Deploy blocked: no passing verify result (result.regression must be 'pass')",
            )
    return True, None


def _check_result_ack(snap: Dict[str, Any], _intent: Dict[str, Any], _ctx: Dict[str, Any]) -> Tuple[bool, Optional[WorkflowError]]:
    s = snap.get("state")
    if s != "RESULT_READY":
        return False, WorkflowError(
            ERROR_INVALID_TRANSITION,
            f"result.ack not allowed from {s}",
            detail={"intent_kind": "result.ack", "from_state": s},
        )
    return True, None


# ---------------------------------------------------------------------------
# apply_intent: returns (new_snapshot, effects) or raises WorkflowError
# ---------------------------------------------------------------------------

def apply_intent(
    snapshot: Dict[str, Any],
    intent: Dict[str, Any],
    context: Dict[str, Any],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Apply one client intent. Returns (new_snapshot, effects).
    Effects are executed by the RPC layer (ledger append, patch.apply, job.run).
    Raises WorkflowError on invalid transition (no state change).
    """
    kind = intent.get("kind")
    if not kind:
        raise WorkflowError(ERROR_INVALID_ARGUMENT, "intent.kind required")

    effects: List[Dict[str, Any]] = []
    snap = dict(snapshot)

    if kind == "workflow.reset":
        ok, err = _check_reset(snap, intent, context)
        if err:
            raise err
        new_id = _random_id("wf")
        new_snap = _empty_snapshot(workflow_id=new_id)
        effects.append({"type": "ledger_append", "event": "workflow.reset"})
        return new_snap, effects

    if kind == "workflow.cancel":
        ok, err = _check_cancel(snap, intent, context)
        if err:
            raise err
        new_snap = _copy_snapshot(snap, state="ABORTED")
        effects.append({"type": "ledger_append", "event": "workflow.cancel"})
        return new_snap, effects

    if kind == "workflow.new":
        ok, err = _check_workflow_new(snap, intent, context)
        if err:
            raise err
        prompt = (intent.get("prompt") or "").strip()
        cwd = (intent.get("cwd") or "").strip() or context.get("cwd", "")
        new_id = _random_id("wf")
        new_snap = _copy_snapshot(
            _empty_snapshot(workflow_id=new_id),
            state="PLAN_DRAFT",
            prompt=prompt,
            context_snapshot={"id": _random_id("ctx"), "cwd": cwd},
        )
        effects.append({"type": "ledger_append", "event": "workflow.new"})
        return new_snap, effects

    if kind == "workflow.freeze_context":
        ok, err = _check_freeze_context(snap, intent, context)
        if err:
            raise err
        cwd = context.get("cwd", "") or (snap.get("context_snapshot") or {}).get("cwd", "")
        ctx_snap = dict(snap.get("context_snapshot") or {"id": _random_id("ctx"), "cwd": cwd})
        ctx_snap["cwd"] = cwd
        new_snap = _copy_snapshot(snap, context_snapshot=ctx_snap)
        effects.append({"type": "ledger_append", "event": "workflow.freeze_context"})
        return new_snap, effects

    if kind == "plan.generate":
        ok, err = _check_plan_generate(snap, intent, context)
        if err:
            raise err
        new_snap = _copy_snapshot(snap, state="PLAN_DRAFT", selected_plan_id=None)
        effects.append({"type": "ledger_append", "event": "plan.generate"})
        effects.append({"type": "plan_generate", "n": intent.get("n", 3)})  # RPC layer invokes planner
        return new_snap, effects

    if kind == "plan.select":
        ok, err = _check_plan_select(snap, intent, context)
        if err:
            raise err
        plan_id = intent.get("plan_id")
        success_criteria = intent.get("success_criteria") or snap.get("success_criteria")
        new_snap = _copy_snapshot(
            snap,
            state="PLAN_SELECTED",
            selected_plan_id=plan_id,
            success_criteria=success_criteria,
        )
        effects.append({"type": "ledger_append", "event": "plan.select"})
        return new_snap, effects

    if kind == "patch.generate":
        ok, err = _check_patch_generate(snap, intent, context)
        if err:
            raise err
        new_snap = _copy_snapshot(
            snap,
            state="REVIEW_REQUIRED",
            review=None,
            armed=None,
            result=None,
        )
        effects.append({"type": "ledger_append", "event": "patch.generate"})
        effects.append({"type": "patch_generate"})  # RPC layer runs fix / patch.propose
        return new_snap, effects

    if kind == "patch.review_complete":
        ok, err = _check_patch_review_complete(snap, intent, context)
        if err:
            raise err
        review = intent.get("review") or {}
        approved = review.get("approved") is True
        if approved and context.get("authority", {}).get("writes_allowed"):
            new_snap = _copy_snapshot(snap, state="APPLY_ARMED", review=review)
        else:
            new_snap = _copy_snapshot(snap, state="REVIEW_REQUIRED", review=review)
        effects.append({"type": "ledger_append", "event": "patch.review_complete"})
        return new_snap, effects

    if kind == "apply.arm":
        ok, err = _check_apply_arm(snap, intent, context)
        if err:
            raise err
        token = _random_id("consent")
        new_snap = _copy_snapshot(
            snap,
            state="APPLY_ARMED",
            armed={"consent_token": token, "armed_at_ms": _now_ms()},
        )
        effects.append({"type": "ledger_append", "event": "apply.arm"})
        return new_snap, effects

    if kind == "apply.confirm":
        ok, err = _check_apply_confirm(snap, intent, context)
        if err:
            raise err
        patch_id = (snap.get("patch") or {}).get("patch_id")
        new_snap = _copy_snapshot(
            snap,
            state="APPLIED",
            patch={**(snap.get("patch") or {}), "status": "applied"},
            armed=None,
        )
        effects.append({"type": "ledger_append", "event": "apply.confirm"})
        effects.append({"type": "patch_apply", "patch_id": patch_id})
        effects.append({"type": "ledger_append", "event": "patch.applied"})
        return new_snap, effects

    if kind == "run.request":
        ok, err = _check_run_request(snap, intent, context)
        if err:
            raise err
        kind_run = intent.get("kind_run") or "check"
        action = "check" if kind_run == "custom" else kind_run
        new_snap = _copy_snapshot(snap, state="RUNNING")
        effects.append({"type": "ledger_append", "event": "run.request"})
        effects.append({
            "type": "job_run",
            "kind": action,
            "cwd": context.get("cwd", ""),
            "confirm": intent.get("confirm") or (action == "deploy"),
        })
        return new_snap, effects

    if kind == "result.ack":
        ok, err = _check_result_ack(snap, intent, context)
        if err:
            raise err
        new_snap = _copy_snapshot(snap, state="DONE")
        effects.append({"type": "ledger_append", "event": "result.ack"})
        return new_snap, effects

    raise WorkflowError(ERROR_INVALID_ARGUMENT, f"Unknown intent kind: {kind}")


# ---------------------------------------------------------------------------
# Canonical transition table: state -> intent.kind -> {guard, next, effects}
# Single source of truth; allowed_intents derived from TRANSITIONS[state].keys()
# ---------------------------------------------------------------------------

def _next_patch_review_complete(
    snap: Dict[str, Any], intent: Dict[str, Any], ctx: Dict[str, Any]
) -> str:
    """If review.approved and writes_allowed => APPLY_ARMED else REVIEW_REQUIRED."""
    review = intent.get("review") or {}
    if review.get("approved") is True and (ctx.get("authority") or {}).get("writes_allowed"):
        return "APPLY_ARMED"
    return "REVIEW_REQUIRED"


def _next_run_request(
    _snap: Dict[str, Any], _intent: Dict[str, Any], _ctx: Dict[str, Any]
) -> str:
    return "RUNNING"


# Type: (state -> intent_kind -> transition spec). "next" may be str or callable(snap,intent,ctx)->str.
TRANSITIONS: Dict[str, Dict[str, Dict[str, Any]]] = {
    "IDLE": {
        "workflow.new": {"guard": _check_workflow_new, "next": "PLAN_DRAFT", "effects": [{"type": "ledger_append", "event": "workflow.new"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "DONE": {
        "workflow.new": {"guard": _check_workflow_new, "next": "PLAN_DRAFT", "effects": [{"type": "ledger_append", "event": "workflow.new"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "FAILED": {
        "workflow.new": {"guard": _check_workflow_new, "next": "PLAN_DRAFT", "effects": [{"type": "ledger_append", "event": "workflow.new"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "ABORTED": {
        "workflow.new": {"guard": _check_workflow_new, "next": "PLAN_DRAFT", "effects": [{"type": "ledger_append", "event": "workflow.new"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "PLAN_DRAFT": {
        "workflow.cancel": {"guard": _check_cancel, "next": "ABORTED", "effects": [{"type": "ledger_append", "event": "workflow.cancel"}]},
        "workflow.freeze_context": {"guard": _check_freeze_context, "next": "PLAN_DRAFT", "effects": [{"type": "ledger_append", "event": "workflow.freeze_context"}]},
        "plan.generate": {"guard": _check_plan_generate, "next": "PLAN_DRAFT", "effects": [{"type": "ledger_append", "event": "plan.generate"}, {"type": "plan_generate", "n": "intent.n|3"}]},
        "plan.select": {"guard": _check_plan_select, "next": "PLAN_SELECTED", "effects": [{"type": "ledger_append", "event": "plan.select"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "PLAN_SELECTED": {
        "workflow.cancel": {"guard": _check_cancel, "next": "ABORTED", "effects": [{"type": "ledger_append", "event": "workflow.cancel"}]},
        "workflow.freeze_context": {"guard": _check_freeze_context, "next": "PLAN_SELECTED", "effects": [{"type": "ledger_append", "event": "workflow.freeze_context"}]},
        "plan.generate": {"guard": _check_plan_generate, "next": "PLAN_DRAFT", "effects": [{"type": "ledger_append", "event": "plan.generate"}, {"type": "plan_generate", "n": "intent.n|3"}]},
        "plan.select": {"guard": _check_plan_select, "next": "PLAN_SELECTED", "effects": [{"type": "ledger_append", "event": "plan.select"}]},
        "patch.generate": {"guard": _check_patch_generate, "next": "REVIEW_REQUIRED", "effects": [{"type": "ledger_append", "event": "patch.generate"}, {"type": "patch_generate"}]},
        "run.request": {"guard": _check_run_request, "next": _next_run_request, "effects": [{"type": "ledger_append", "event": "run.request"}, {"type": "job_run"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "REVIEW_REQUIRED": {
        "workflow.cancel": {"guard": _check_cancel, "next": "ABORTED", "effects": [{"type": "ledger_append", "event": "workflow.cancel"}]},
        "workflow.freeze_context": {"guard": _check_freeze_context, "next": "REVIEW_REQUIRED", "effects": [{"type": "ledger_append", "event": "workflow.freeze_context"}]},
        "patch.review_complete": {"guard": _check_patch_review_complete, "next": _next_patch_review_complete, "effects": [{"type": "ledger_append", "event": "patch.review_complete"}]},
        "apply.arm": {"guard": _check_apply_arm, "next": "APPLY_ARMED", "effects": [{"type": "ledger_append", "event": "apply.arm"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "APPLY_ARMED": {
        "workflow.cancel": {"guard": _check_cancel, "next": "ABORTED", "effects": [{"type": "ledger_append", "event": "workflow.cancel"}]},
        "workflow.freeze_context": {"guard": _check_freeze_context, "next": "APPLY_ARMED", "effects": [{"type": "ledger_append", "event": "workflow.freeze_context"}]},
        "apply.arm": {"guard": _check_apply_arm, "next": "APPLY_ARMED", "effects": [{"type": "ledger_append", "event": "apply.arm"}]},
        "apply.confirm": {"guard": _check_apply_confirm, "next": "APPLIED", "effects": [{"type": "ledger_append", "event": "apply.confirm"}, {"type": "patch_apply", "patch_id": "snap.patch.patch_id"}, {"type": "ledger_append", "event": "patch.applied"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "APPLIED": {
        "workflow.cancel": {"guard": _check_cancel, "next": "ABORTED", "effects": [{"type": "ledger_append", "event": "workflow.cancel"}]},
        "run.request": {"guard": _check_run_request, "next": _next_run_request, "effects": [{"type": "ledger_append", "event": "run.request"}, {"type": "job_run"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "RUNNING": {
        "workflow.cancel": {"guard": _check_cancel, "next": "ABORTED", "effects": [{"type": "ledger_append", "event": "workflow.cancel"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
    "RESULT_READY": {
        "workflow.cancel": {"guard": _check_cancel, "next": "ABORTED", "effects": [{"type": "ledger_append", "event": "workflow.cancel"}]},
        "result.ack": {"guard": _check_result_ack, "next": "DONE", "effects": [{"type": "ledger_append", "event": "result.ack"}]},
        "run.request": {"guard": _check_run_request, "next": _next_run_request, "effects": [{"type": "ledger_append", "event": "run.request"}, {"type": "job_run"}]},
        "workflow.reset": {"guard": _check_reset, "next": "IDLE", "effects": [{"type": "ledger_append", "event": "workflow.reset"}]},
    },
}


def allowed_intents_from_transitions(state: str) -> List[str]:
    """Return intent kinds allowed from state (derived from canonical TRANSITIONS)."""
    return sorted((TRANSITIONS.get(state) or {}).keys())


def allowed_intents(state: str, authority: Dict[str, Any]) -> List[str]:
    """Return list of intent kinds allowed from this state (for UI). Derived from TRANSITIONS."""
    return allowed_intents_from_transitions(state)
