from pathlib import Path
from typing import List, Dict, Any

from adjutorix_agent.governance.protected_files import ProtectedFiles
from adjutorix_agent.core.taxonomy import ErrorCategory


class PatchGateError(Exception):
    pass


class PatchGate:
    """
    Enforces atomic patch rules and safety constraints.
    Prevents uncontrolled mass edits.
    """

    def __init__(
        self,
        workspace: Path,
        protected: ProtectedFiles,
        max_files: int = 10,
        max_lines: int = 500,
    ):
        self.workspace = workspace
        self.protected = protected
        self.max_files = max_files
        self.max_lines = max_lines

    # -------------------------
    # Public API
    # -------------------------

    def validate_patch(self, patch: str, meta: Dict[str, Any]) -> None:
        """
        Validate patch against governance rules.
        """

        files = self._extract_files(patch)
        lines = self._count_changed_lines(patch)

        self._check_file_limit(files)
        self._check_line_limit(lines)
        self._check_protected_files(files, meta)
        self._check_metadata(meta)

    # -------------------------
    # Internal Checks
    # -------------------------

    def _check_file_limit(self, files: List[Path]) -> None:
        if len(files) > self.max_files:
            raise PatchGateError(
                f"Patch touches too many files: {len(files)} > {self.max_files}"
            )

    def _check_line_limit(self, lines: int) -> None:
        if lines > self.max_lines:
            raise PatchGateError(
                f"Patch too large: {lines} lines > {self.max_lines}"
            )

    def _check_protected_files(
        self,
        files: List[Path],
        meta: Dict[str, Any],
    ) -> None:

        override = meta.get("override_protected", False)

        for file_path in files:
            if self.protected.is_protected(file_path):
                if not override:
                    raise PatchGateError(
                        f"Protected file modification blocked: {file_path}"
                    )

    def _check_metadata(self, meta: Dict[str, Any]) -> None:
        """
        Ensure patch metadata completeness.
        """

        required = {
            "reason",
            "expected_effect",
            "author",
        }

        missing = required - set(meta.keys())

        if missing:
            raise PatchGateError(
                f"Patch metadata missing fields: {', '.join(missing)}"
            )

    # -------------------------
    # Patch Parsing
    # -------------------------

    def _extract_files(self, patch: str) -> List[Path]:
        """
        Extract modified files from unified diff.
        """

        files: List[Path] = []

        for line in patch.splitlines():
            if line.startswith("+++ b/"):
                rel = line.replace("+++ b/", "").strip()
                files.append(self.workspace / rel)

        return files

    def _count_changed_lines(self, patch: str) -> int:
        """
        Count added/removed lines.
        """

        count = 0

        for line in patch.splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                count += 1
            elif line.startswith("-") and not line.startswith("---"):
                count += 1

        return count

    # -------------------------
    # Reporting
    # -------------------------

    def summarize(self, patch: str) -> Dict[str, Any]:
        """
        Return summary of patch impact.
        """

        files = self._extract_files(patch)
        lines = self._count_changed_lines(patch)

        return {
            "files_touched": [str(f) for f in files],
            "file_count": len(files),
            "line_changes": lines,
            "risk_level": self._risk_level(len(files), lines),
        }

    def _risk_level(self, file_count: int, line_count: int) -> str:
        """
        Heuristic risk scoring.
        """

        if file_count <= 2 and line_count <= 50:
            return "low"

        if file_count <= 5 and line_count <= 200:
            return "medium"

        return "high"
