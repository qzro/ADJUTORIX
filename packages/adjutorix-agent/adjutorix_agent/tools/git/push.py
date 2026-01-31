"""
git.push

Deterministic wrapper for `git push`.

Ensures controlled pushing with explicit remote/branch handling.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional


class GitPushError(Exception):
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
        raise GitPushError(e.stderr.strip()) from e


def get_current_branch(repo_path: Optional[Path] = None) -> str:
    """
    Return current git branch.
    """
    return _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)


def push(
    repo_path: Optional[Path] = None,
    remote: str = "origin",
    branch: Optional[str] = None,
    force: bool = False,
    set_upstream: bool = False,
) -> str:
    """
    Push commits to remote.

    Args:
        repo_path: Repository path
        remote: Remote name (default: origin)
        branch: Branch name (auto-detect if None)
        force: Use --force-with-lease
        set_upstream: Set upstream tracking
    """
    if branch is None:
        branch = get_current_branch(repo_path)

    cmd = ["push", remote, branch]

    if set_upstream:
        cmd.insert(1, "--set-upstream")

    if force:
        cmd.append("--force-with-lease")

    return _run_git(cmd, cwd=repo_path)


def push_all(
    repo_path: Optional[Path] = None,
    remote: str = "origin",
) -> str:
    """
    Push all branches and tags.
    """
    return _run_git(["push", "--all", "--tags", remote], cwd=repo_path)


if __name__ == "__main__":
    import sys

    repo = Path.cwd()

    try:
        result = push(repo)
        print(result)
    except GitPushError as e:
        print(f"Push failed: {e}", file=sys.stderr)
        raise SystemExit(1)
