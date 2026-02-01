from dataclasses import dataclass
from typing import List, Dict, Any


class ContextBudgetError(Exception):
    pass


@dataclass
class BudgetLimits:
    max_files: int = 8
    max_file_lines: int = 400
    max_total_lines: int = 2000
    max_tokens_estimate: int = 8000


class ContextBudget:
    """
    Enforces hard context limits for local LLM usage.
    Prevents prompt bloat and model collapse.
    """

    def __init__(self, limits: BudgetLimits | None = None) -> None:
        self.limits = limits or BudgetLimits()

    # -------------------------
    # Public API
    # -------------------------

    def reset(self) -> None:
        """
        Back-compat shim.
        Legacy paths call reset(); make it a safe no-op or minimal reset.
        """
        try:
            if hasattr(self, "used_tokens"):
                self.used_tokens = 0
            if hasattr(self, "messages"):
                self.messages = []
        except Exception:
            pass

    def enforce(
        self,
        files: List[Dict[str, Any]],
        memory: str = "",
        diff: str = "",
        logs: str = "",
    ) -> Dict[str, Any]:
        """
        Enforce context budget.

        files: [
            {
                "path": str,
                "content": str
            }
        ]
        """

        selected = self._limit_files(files)
        selected = self._limit_lines(selected)

        total_lines = self._count_lines(
            selected, memory, diff, logs
        )

        if total_lines > self.limits.max_total_lines:
            selected = self._shrink_to_fit(
                selected,
                memory,
                diff,
                logs,
            )

        return {
            "files": selected,
            "memory": memory,
            "diff": diff,
            "logs": logs,
            "total_lines": self._count_lines(
                selected, memory, diff, logs
            ),
        }

    # -------------------------
    # Internals
    # -------------------------

    def _limit_files(
        self, files: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:

        if len(files) <= self.limits.max_files:
            return files

        return files[: self.limits.max_files]

    def _limit_lines(
        self, files: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:

        limited: List[Dict[str, Any]] = []

        for f in files:
            lines = f["content"].splitlines()

            if len(lines) > self.limits.max_file_lines:
                lines = lines[: self.limits.max_file_lines]

            limited.append(
                {
                    "path": f["path"],
                    "content": "\n".join(lines),
                }
            )

        return limited

    def _count_lines(
        self,
        files: List[Dict[str, Any]],
        memory: str,
        diff: str,
        logs: str,
    ) -> int:

        total = 0

        for f in files:
            total += len(f["content"].splitlines())

        total += len(memory.splitlines())
        total += len(diff.splitlines())
        total += len(logs.splitlines())

        return total

    def _shrink_to_fit(
        self,
        files: List[Dict[str, Any]],
        memory: str,
        diff: str,
        logs: str,
    ) -> List[Dict[str, Any]]:
        """
        Aggressively shrink context until under budget.
        """

        current = files.copy()

        while True:
            total = self._count_lines(
                current, memory, diff, logs
            )

            if total <= self.limits.max_total_lines:
                break

            if not current:
                raise ContextBudgetError(
                    "Context too large even with no files"
                )

            # Remove largest file first
            current.sort(
                key=lambda f: len(f["content"].splitlines()),
                reverse=True,
            )

            current.pop(0)

        return current

    # -------------------------
    # Estimation (optional)
    # -------------------------

    def estimate_tokens(self, text: str) -> int:
        """
        Rough token estimator (4 chars ≈ 1 token).
        """

        return max(1, len(text) // 4)

    def validate_token_budget(self, text: str) -> None:
        est = self.estimate_tokens(text)

        if est > self.limits.max_tokens_estimate:
            raise ContextBudgetError(
                f"Estimated tokens {est} exceed limit "
                f"{self.limits.max_tokens_estimate}"
            )
