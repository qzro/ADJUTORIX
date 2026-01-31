"""
git.diff

Deterministic wrapper for `git diff` and `git diff --cached`.

Provides structured access to diffs for patch review and validation.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional


class GitDiffError(Exception):
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
        return proc.stdout
    except subprocess.CalledProcessError as e:
        raise GitDiffError(e.stderr.strip()) from e


def get_worktree_diff(repo_path: Optional[Path] = None) -> str:
    """
    Return unified diff for unstaged changes.
    """
    return _run_git(["diff"], cwd=repo_path)


def get_staged_diff(repo_path: Optional[Path] = None) -> str:
    """
    Return unified diff for staged changes.
    """
    return _run_git(["diff", "--cached"], cwd=repo_path)


def get_full_diff(repo_path: Optional[Path] = None) -> str:
    """
    Return unified diff for staged + unstaged changes.
    """
    unstaged = get_worktree_diff(repo_path)
    staged = get_staged_diff(repo_path)

    if staged and unstaged:
        return staged + "\n" + unstaged

    return staged or unstaged or ""


def has_changes(repo_path: Optional[Path] = None) -> bool:
    """
    True if there are any diffs.
    """
    diff = get_full_diff(repo_path)
    return bool(diff.strip())


if __name__ == "__main__":
    print(get_full_diff())
