from enum import Enum
from typing import Optional


class AgentState(str, Enum):
    SCAN = "SCAN"
    PLAN = "PLAN"
    PATCH = "PATCH"
    VERIFY = "VERIFY"
    REPORT = "REPORT"
    STOP = "STOP"


_ALLOWED_TRANSITIONS = {
    AgentState.SCAN: {AgentState.PLAN, AgentState.STOP},
    AgentState.PLAN: {AgentState.PATCH, AgentState.STOP},
    AgentState.PATCH: {AgentState.VERIFY, AgentState.STOP},
    AgentState.VERIFY: {AgentState.REPORT, AgentState.STOP},
    AgentState.REPORT: {AgentState.STOP, AgentState.SCAN},
    AgentState.STOP: {AgentState.SCAN},
}


class InvalidStateTransition(Exception):
    pass


class StateMachine:
    """
    Enforces SCAN → PLAN → PATCH → VERIFY → REPORT → STOP.

    Prevents skipping steps and chaotic execution.
    """

    def __init__(self) -> None:
        self._state: AgentState = AgentState.STOP
        self._job_id: Optional[str] = None

    @property
    def state(self) -> AgentState:
        return self._state

    @property
    def job_id(self) -> Optional[str]:
        return self._job_id

    def start_job(self, job_id: str) -> None:
        if self._state != AgentState.STOP:
            raise InvalidStateTransition("Job already running")

        self._job_id = job_id
        self._transition(AgentState.SCAN)

    def finish_job(self) -> None:
        self._transition(AgentState.STOP)
        self._job_id = None

    def to_scan(self) -> None:
        self._transition(AgentState.SCAN)

    def to_plan(self) -> None:
        self._transition(AgentState.PLAN)

    def to_patch(self) -> None:
        self._transition(AgentState.PATCH)

    def to_verify(self) -> None:
        self._transition(AgentState.VERIFY)

    def to_report(self) -> None:
        self._transition(AgentState.REPORT)

    def _transition(self, new_state: AgentState) -> None:
        allowed = _ALLOWED_TRANSITIONS.get(self._state, set())

        if new_state not in allowed:
            raise InvalidStateTransition(
                f"Illegal transition: {self._state} → {new_state}"
            )

        self._state = new_state

    def reset(self) -> None:
        """
        Emergency reset (crash recovery).
        """
        self._state = AgentState.STOP
        self._job_id = None
