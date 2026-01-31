from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class RepoInfo:
    """Detected repository metadata for routing and toolchain selection."""
    root: Path
    name: str
    toolchain: str  # python|node|mono|unknown


class RepoDetectError(RuntimeError):
    pass


def _is_git_repo(path: Path) -> bool:
    return (path / ".git").exists() or (path / ".git").is_dir()


def _find_repo_root(start: Path) -> Optional[Path]:
    """Walk upward until a git repo root is found, else None."""
    p = start.resolve()
    for parent in [p, *p.parents]:
        if _is_git_repo(parent):
            return parent
    return None


def _detect_toolchain(repo_root: Path) -> str:
    """
    Heuristic toolchain detection.

    Order matters:
      - mono: both python and node may exist in monorepos; "mono" when both present or explicit markers exist.
      - python: pyproject/requirements
      - node: package.json
    """
    has_pyproject = (repo_root / "pyproject.toml").exists()
    has_requirements = (repo_root / "requirements.txt").exists()
    has_node = (repo_root / "package.json").exists()
    has_pnpm = (repo_root / "pnpm-lock.yaml").exists()
    has_yarn = (repo_root / "yarn.lock").exists()
    has_nx = (repo_root / "nx.json").exists()
    has_turbo = (repo_root / "turbo.json").exists()

    pythonish = has_pyproject or has_requirements
    nodeish = has_node or has_pnpm or has_yarn
    monorepoish = has_nx or has_turbo

    if (pythonish and nodeish) or monorepoish:
        return "mono"
    if pythonish:
        return "python"
    if nodeish:
        return "node"
    return "unknown"


def detect_repo(start_path: str | os.PathLike[str]) -> RepoInfo:
    """
    Detect the repo root, name, and toolchain from a starting path.

    Raises:
      RepoDetectError if no git repo root is found.
    """
    start = Path(start_path).expanduser()
    root = _find_repo_root(start)
    if root is None:
        raise RepoDetectError(f"No git repository found upward from: {start}")

    name = root.name
    toolchain = _detect_toolchain(root)
    return RepoInfo(root=root, name=name, toolchain=toolchain)


def detect_repo_or_none(start_path: str | os.PathLike[str]) -> Optional[RepoInfo]:
    """Non-throwing variant."""
    try:
        return detect_repo(start_path)
    except RepoDetectError:
        return None
