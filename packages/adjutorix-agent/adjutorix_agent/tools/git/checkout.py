"""
git.checkout

Deterministic wrapper for `git checkout` / `git switch`.

Used for safe branch switching and file rollback.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional, List


class GitCheckoutError(Exception):
    pass


def _run_git(args: List[str], cwd: Optional[Path] = None) -> str:
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
        raise GitCheckoutError(e.stderr.strip()) from e


def checkout_branch(
    branch: str,
    repo_path: Optional[Path] = None,
    create: bool = False,
) -> str:
    """
    Checkout or switch to a branch.

    Args:
        branch: Branch name
        repo_path: Repository path
        create: Create branch if not exists
    """
    if create:
        cmd = ["checkout", "-b", branch]
    else:
        cmd = ["checkout", branch]

    return _run_git(cmd, cwd=repo_path)


def switch_branch(
    branch: str,
    repo_path: Optional[Path] = None,
    create: bool = False,
) -> str:
    """
    Switch branch using `git switch`.

    Preferred modern alternative to checkout.
    """
    cmd = ["switch"]

    if create:
        cmd.append("-c")

    cmd.append(branch)

    return _run_git(cmd, cwd=repo_path)


def checkout_files(
    files: List[str],
    repo_path: Optional[Path] = None,
    ref: str = "HEAD",
) -> str:
    """
    Restore specific files from a ref.

    Args:
        files: List of file paths
        repo_path: Repository path
        ref: Git reference (default: HEAD)
    """
    if not files:
        raise GitCheckoutError("No files specified for checkout")

    cmd = ["checkout", ref, "--"] + files
    return _run_git(cmd, cwd=repo_path)


def restore_all(repo_path: Optional[Path] = None) -> str:
    """
    Discard all local changes (safe wrapper).

    Equivalent to: git checkout -- .
    """
    return _run_git(["checkout", "--", "."], cwd=repo_path)


def checkout_commit(
    commit: str,
    repo_path: Optional[Path] = None,
    detached: bool = True,
) -> str:
    """
    Checkout a specific commit.

    Args:
        commit: Commit hash
        detached: Allow detached HEAD (default: True)
    """
    if not detached:
        raise GitCheckoutError("Non-detached commit checkout not supported")

    return _run_git(["checkout", commit], cwd=repo_path)


if __name__ == "__main__":
    import sys

    repo = Path.cwd()

    try:
        if len(sys.argv) > 1:
            print(checkout_branch(sys.argv[1], repo))
        else:
            print("Usage: checkout.py <branch>")
    except GitCheckoutError as e:
        print(f"Checkout failed: {e}", file=sys.stderr)
        raise SystemExit(1)
