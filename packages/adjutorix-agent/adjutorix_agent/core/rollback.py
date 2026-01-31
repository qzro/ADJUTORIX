import subprocess
from pathlib import Path
from typing import List, Optional


class RollbackError(Exception):
    pass


class RollbackManager:
    """
    Handles deterministic rollback of failed jobs using git
    and stored patch artifacts.
    """

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace

    # -------------------------
    # Public API
    # -------------------------

    def rollback_files(self, files: List[str]) -> None:
        """
        Restore specific files from HEAD.
        """

        if not files:
            return

        cmd = ["git", "checkout", "--"] + files
        self._run(cmd)

    def rollback_hard(self) -> None:
        """
        Reset entire workspace to HEAD.
        """

        cmd = ["git", "reset", "--hard", "HEAD"]
        self._run(cmd)

    def rollback_with_patch(self, reverse_patch: Path) -> None:
        """
        Apply reverse patch to undo changes.
        """

        if not reverse_patch.exists():
            raise RollbackError(f"Reverse patch not found: {reverse_patch}")

        cmd = ["git", "apply", str(reverse_patch)]
        self._run(cmd)

    def snapshot(self, label: str) -> None:
        """
        Create lightweight snapshot using git stash.
        """

        cmd = ["git", "stash", "push", "-u", "-m", f"adjutorix:{label}"]
        self._run(cmd)

    def restore_snapshot(self, label: Optional[str] = None) -> None:
        """
        Restore snapshot created by snapshot().
        """

        stash_ref = self._find_stash(label)

        if not stash_ref:
            raise RollbackError("No matching snapshot found")

        cmd = ["git", "stash", "pop", stash_ref]
        self._run(cmd)

    # -------------------------
    # Internal Helpers
    # -------------------------

    def _find_stash(self, label: Optional[str]) -> Optional[str]:
        """
        Locate stash entry by label.
        """

        cmd = ["git", "stash", "list"]
        output = self._run(cmd, capture=True)

        for line in output.splitlines():
            if "adjutorix:" in line:
                if not label or label in line:
                    return line.split(":")[0]

        return None

    def _run(
        self,
        cmd: List[str],
        capture: bool = False,
    ) -> Optional[str]:

        try:
            result = subprocess.run(
                cmd,
                cwd=self.workspace,
                check=True,
                text=True,
                capture_output=capture,
            )

            if capture:
                return result.stdout

            return None

        except subprocess.CalledProcessError as e:
            raise RollbackError(
                f"Command failed: {' '.join(cmd)}\n{e.stderr}"
            ) from e
