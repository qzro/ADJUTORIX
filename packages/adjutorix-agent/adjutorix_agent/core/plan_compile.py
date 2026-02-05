"""
Step → Effect compilation. One plan step maps to exactly one workflow effect.
Pure and deterministic: same step → same effect → replayable.
"""

from __future__ import annotations

from typing import Any, Dict



def compile_step_to_effect(step: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compile a plan step to a workflow effect. Raises ValueError for unknown action.
    """
    action = step.get("action")
    if action not in ("patch", "run", "verify", "deploy"):
        raise ValueError(f"Unknown step action: {action}")

    step_id = step.get("step_id", "")
    inputs = step.get("inputs") or {}

    if action == "patch":
        return {
            "type": "patch_generate",
            "source_step": step_id,
        }

    if action == "run":
        return {
            "type": "job_run",
            "kind": inputs.get("kind", "check"),
            "cwd": inputs.get("cwd"),
            "confirm": False,
            "source_step": step_id,
        }

    if action == "verify":
        return {
            "type": "job_run",
            "kind": "verify",
            "cwd": inputs.get("cwd"),
            "confirm": False,
            "source_step": step_id,
        }

    if action == "deploy":
        return {
            "type": "job_run",
            "kind": "deploy",
            "cwd": inputs.get("cwd"),
            "confirm": True,
            "source_step": step_id,
        }

    raise ValueError(f"Unknown step action: {action}")
