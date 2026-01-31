import os
import json
import glob
import logging
from typing import Optional, Dict, Any, List

from .job_ledger import JobLedger
from .state_machine import AgentState


logger = logging.getLogger("adjutorix.recovery")


class RecoveryError(Exception):
    pass


class CrashRecoveryManager:
    """
    Handles crash recovery using job ledger state.

    Restores last known valid state and decides:
    - resume
    - rollback
    - abort
    """

    def __init__(self, workspace_root: str) -> None:
        self.workspace_root = workspace_root
        self.jobs_dir = os.path.join(
            workspace_root,
            ".agent",
            "jobs",
        )

    # -------------------------
    # Public API
    # -------------------------

    def find_interrupted_job(self) -> Optional[str]:
        """
        Find most recent unfinished job directory.
        """

        if not os.path.exists(self.jobs_dir):
            return None

        jobs = sorted(
            glob.glob(os.path.join(self.jobs_dir, "*")),
            reverse=True,
        )

        for job_path in jobs:
            if self._is_incomplete(job_path):
                return job_path

        return None

    def recover(self) -> Optional[Dict[str, Any]]:
        """
        Main recovery entrypoint.

        Returns recovery plan or None.
        """

        job_path = self.find_interrupted_job()

        if not job_path:
            logger.info("No interrupted jobs found")
            return None

        logger.warning("Interrupted job found: %s", job_path)

        ledger = JobLedger.from_path(job_path)

        state = self._load_last_state(job_path)

        if not state:
            raise RecoveryError("Corrupted job state")

        decision = self._decide_action(state)

        return {
            "job_path": job_path,
            "job_id": ledger.job_id,
            "last_state": state,
            "action": decision,
        }

    def resume(self, job_path: str) -> Dict[str, Any]:
        """
        Load state needed to resume execution.
        """

        state = self._load_last_state(job_path)

        if not state:
            raise RecoveryError("Cannot resume: missing state")

        context = self._load_context(job_path)

        return {
            "state": state,
            "context": context,
        }

    def abort(self, job_path: str) -> None:
        """
        Mark job as aborted.
        """

        marker = os.path.join(job_path, "ABORTED")

        with open(marker, "w") as f:
            f.write("aborted\n")

        logger.warning("Job aborted: %s", job_path)

    def cleanup(self, job_path: str) -> None:
        """
        Remove recovery flags after success.
        """

        for name in ("INTERRUPTED", "ABORTED"):
            path = os.path.join(job_path, name)

            if os.path.exists(path):
                os.remove(path)

    # -------------------------
    # Internals
    # -------------------------

    def _is_incomplete(self, job_path: str) -> bool:
        """
        Check if job lacks completion marker.
        """

        done = os.path.join(job_path, "DONE")

        return not os.path.exists(done)

    def _load_last_state(self, job_path: str) -> Optional[str]:
        """
        Read last state from state.log
        """

        state_file = os.path.join(job_path, "state.log")

        if not os.path.exists(state_file):
            return None

        try:
            with open(state_file, "r") as f:
                lines = [l.strip() for l in f.readlines() if l.strip()]

            if not lines:
                return None

            return lines[-1]

        except Exception as e:
            logger.error("Failed reading state.log: %s", e)
            return None

    def _load_context(self, job_path: str) -> Dict[str, Any]:
        """
        Load stored execution context if present.
        """

        ctx_file = os.path.join(job_path, "context.json")

        if not os.path.exists(ctx_file):
            return {}

        try:
            with open(ctx_file, "r") as f:
                return json.load(f)
        except Exception:
            return {}

    def _decide_action(self, state: str) -> str:
        """
        Decide recovery action based on last state.
        """

        try:
            agent_state = AgentState(state)
        except Exception:
            return "abort"

        if agent_state in (
            AgentState.SCAN,
            AgentState.PLAN,
        ):
            return "resume"

        if agent_state in (
            AgentState.PATCH,
            AgentState.VERIFY,
        ):
            return "rollback"

        if agent_state == AgentState.REPORT:
            return "finalize"

        return "abort"


# -------------------------
# Utilities
# -------------------------


def mark_interrupted(job_path: str) -> None:
    """
    Mark job as interrupted (on crash/signal).
    """

    marker = os.path.join(job_path, "INTERRUPTED")

    try:
        with open(marker, "w") as f:
            f.write("interrupted\n")
    except Exception:
        pass


def mark_done(job_path: str) -> None:
    """
    Mark job as completed.
    """

    marker = os.path.join(job_path, "DONE")

    try:
        with open(marker, "w") as f:
            f.write("done\n")
    except Exception:
        pass
