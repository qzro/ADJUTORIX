"""
git.commit

Deterministic wrapper for `git commit`.

Ensures commits follow policy and are created only when changes exist.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional


class GitCommitError(Exception):
    pass


def _run_git(args: list[str], cwd: Optional[Path] = None) -> str:
    try:
        proc = subprocess.run(
            ["git"] + args,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        return proc.stdout.strip()
    except subprocess.CalledProcessError as e:
        raise GitCommitError(e.stderr.strip()) from e


def has_staged_changes(repo_path: Optional[Path] = None) -> bool:
    """
    Check if there are staged changes to commit.
    """
    out = _run_git(["diff", "--cached", "--name-only"], cwd=repo_path)
    return bool(out.strip())


def stage_all(repo_path: Optional[Path] = None) -> None:
    """
    Stage all modified and new files.
    """
    _run_git(["add", "-A"], cwd=repo_path)


def commit(
    message: str,
    repo_path: Optional[Path] = None,
    signoff: bool = False,
) -> str:
    """
    Create a git commit with the given message.

    Args:
        message: Commit message
        repo_path: Repository path
        signoff: Add --signoff if True
    """
    if not message.strip():
        raise GitCommitError("Commit message cannot be empty")

    if not has_staged_changes(repo_path):
        raise GitCommitError("No staged changes to commit")

    cmd = ["commit", "-m", message]

    if signoff:
        cmd.append("--signoff")

    return _run_git(cmd, cwd=repo_path)


def auto_commit(
    message: str,
    repo_path: Optional[Path] = None,
) -> str:
    """
    Stage all changes and commit in one step.
    """
    stage_all(repo_path)
    return commit(message, repo_path)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Usage: commit.py <message>")

    msg = sys.argv[1]
    print(auto_commit(msg))
