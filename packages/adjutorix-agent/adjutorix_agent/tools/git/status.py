"""
git.status

Deterministic wrapper for `git status --porcelain` and `git status --branch`.

Used by the agent to understand repository state without parsing human text.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


@dataclass
class GitFileStatus:
    path: str
    index: str
    worktree: str


@dataclass
class GitStatus:
    branch: Optional[str]
    ahead: int
    behind: int
    files: List[GitFileStatus]
    is_dirty: bool


class GitStatusError(Exception):
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
        return proc.stdout
    except subprocess.CalledProcessError as e:
        raise GitStatusError(e.stderr.strip()) from e


def _parse_branch(line: str) -> tuple[Optional[str], int, int]:
    """
    Parse: ## main...origin/main [ahead 1, behind 2]
    """
    branch = None
    ahead = 0
    behind = 0

    if not line.startswith("##"):
        return branch, ahead, behind

    content = line[2:].strip()

    if "..." in content:
        branch = content.split("...")[0].strip()
    else:
        branch = content.split()[0].strip()

    if "[" in content and "]" in content:
        meta = content.split("[", 1)[1].split("]", 1)[0]
        parts = [p.strip() for p in meta.split(",")]

        for p in parts:
            if p.startswith("ahead"):
                ahead = int(p.split()[1])
            elif p.startswith("behind"):
                behind = int(p.split()[1])

    return branch, ahead, behind


def _parse_files(lines: List[str]) -> List[GitFileStatus]:
    files: List[GitFileStatus] = []

    for line in lines:
        if not line or line.startswith("##"):
            continue

        if len(line) < 3:
            continue

        index = line[0]
        worktree = line[1]
        path = line[3:].strip()

        files.append(
            GitFileStatus(
                path=path,
                index=index,
                worktree=worktree,
            )
        )

    return files


def get_status(repo_path: Optional[Path] = None) -> GitStatus:
    """
    Return structured git status.

    Uses porcelain v1 for maximum compatibility.
    """
    out = _run_git(["status", "--porcelain", "--branch"], cwd=repo_path)

    lines = [l.rstrip() for l in out.splitlines() if l.strip()]

    branch = None
    ahead = 0
    behind = 0

    if lines and lines[0].startswith("##"):
        branch, ahead, behind = _parse_branch(lines[0])

    files = _parse_files(lines)

    return GitStatus(
        branch=branch,
        ahead=ahead,
        behind=behind,
        files=files,
        is_dirty=len(files) > 0,
    )


def is_clean(repo_path: Optional[Path] = None) -> bool:
    """
    True if working tree has no changes.
    """
    status = get_status(repo_path)
    return not status.is_dirty


if __name__ == "__main__":
    s = get_status()
    print(s)
