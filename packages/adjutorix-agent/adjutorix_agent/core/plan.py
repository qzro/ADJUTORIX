"""
Canonical Plan object: goal, constraints, ordered steps.
Plans as programs; steps as opcodes; workflow as VM; ledger as execution trace.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

PlanAction = Literal["patch", "run", "verify", "deploy"]

# For validate_plan (avoids circular import with workflow)
ERROR_INVALID_ARGUMENT = "error.invalid_argument"
ERROR_PRECONDITION_FAILED = "error.precondition_failed"


class PlanError(Exception):
    """Invalid plan structure or constraints."""

    def __init__(self, code: str, message: str, detail: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}


def plan_step(
    step_id: str,
    action: PlanAction,
    tool: Optional[str] = None,
    inputs: Optional[Dict[str, Any]] = None,
    outputs: Optional[Dict[str, Any]] = None,
    risk: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a plan step dict. Exactly one effect per step."""
    return {
        "step_id": step_id,
        "action": action,
        "tool": tool,
        "inputs": inputs or {},
        "outputs": outputs or {},
        "risk": risk,
    }


def plan(
    plan_id: str,
    goal: str,
    steps: List[Dict[str, Any]],
    constraints: Optional[Dict[str, Any]] = None,
    expected_artifacts: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, Any]:
    """Build a plan dict. steps ordered; each step maps to exactly one engine effect."""
    return {
        "plan_id": plan_id,
        "goal": goal,
        "constraints": constraints or {},
        "steps": list(steps),
        "expected_artifacts": expected_artifacts or {},
    }


def validate_plan(plan: Dict[str, Any]) -> None:
    """
    Validate plan structure. Raises PlanError if invalid.
    - plan.steps required and non-empty
    - each step.action in (patch, run, verify, deploy)
    - deploy step must be last if present
    """
    if not plan.get("steps"):
        raise PlanError(ERROR_INVALID_ARGUMENT, "plan.steps required")
    for step in plan["steps"]:
        action = step.get("action")
        if action not in ("patch", "run", "verify", "deploy"):
            raise PlanError(ERROR_INVALID_ARGUMENT, f"Invalid step action: {action}")
    deploys = [s for s in plan["steps"] if s.get("action") == "deploy"]
    if deploys and plan["steps"][-1].get("action") != "deploy":
        raise PlanError(
            ERROR_PRECONDITION_FAILED,
            "deploy step must be last",
        )
