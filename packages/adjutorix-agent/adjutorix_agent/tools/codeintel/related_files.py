"""
codeintel.related_files

Finds files related to a given file using:
- dependency graph
- reverse dependencies
- directory proximity
- naming similarity

Used to provide minimal, relevant context to the agent.
"""

from __future__ import annotations

import os
import difflib
from pathlib import Path
from typing import List, Set, Dict

from .dependency_graph import direct_deps, reverse_deps


# -------------------------
# Helpers
# -------------------------


def _basename(path: str) -> str:
    return Path(path).stem.lower()


def _dirname(path: str) -> str:
    return str(Path(path).parent)


def _list_siblings(root: Path, file: Path) -> List[str]:
    """
    Files in same directory.
    """
    out: List[str] = []

    try:
        for p in file.parent.iterdir():
            if p.is_file() and p != file:
                out.append(str(p.relative_to(root)))
    except Exception:
        pass

    return out


def _name_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


# -------------------------
# Core Logic
# -------------------------


def find_related_files(
    workspace_root: str,
    file: str,
    *,
    max_results: int = 20,
    min_similarity: float = 0.6,
) -> List[str]:
    """
    Compute related files based on multiple signals.

    Signals:
    - Direct dependencies
    - Reverse dependencies
    - Same directory siblings
    - Similar filenames

    Returns ordered list by relevance.
    """
    root = Path(workspace_root).resolve()
    target = root / file

    if not target.exists():
        return []

    related: Dict[str, float] = {}

    # -------------------------
    # Dependency Graph
    # -------------------------

    for dep in direct_deps(workspace_root, file):
        related[dep] = related.get(dep, 0) + 3.0

    for rev in reverse_deps(workspace_root, file):
        related[rev] = related.get(rev, 0) + 2.0

    # -------------------------
    # Directory Proximity
    # -------------------------

    for sib in _list_siblings(root, target):
        related[sib] = related.get(sib, 0) + 1.5

    # -------------------------
    # Name Similarity
    # -------------------------

    base = _basename(file)

    for dirpath, _, filenames in os.walk(root):
        if ".agent" in dirpath:
            continue
        if "node_modules" in dirpath:
            continue
        if ".venv" in dirpath:
            continue

        for fname in filenames:
            p = Path(dirpath) / fname

            try:
                rel = str(p.relative_to(root))
            except Exception:
                continue

            if rel == file:
                continue

            score = _name_similarity(base, _basename(rel))

            if score >= min_similarity:
                related[rel] = related.get(rel, 0) + score

    # -------------------------
    # Rank + Trim
    # -------------------------

    ranked = sorted(
        related.items(),
        key=lambda x: x[1],
        reverse=True,
    )

    return [k for k, _ in ranked[:max_results]]


# -------------------------
# Tool Entrypoint
# -------------------------


def related_files(
    *,
    workspace_root: str,
    file: str,
    max_results: int = 20,
) -> dict:
    """
    Tool entrypoint.

    Args:
        workspace_root: repo root
        file: relative path
        max_results: limit

    Returns:
        {ok, file, related}
    """
    items = find_related_files(
        workspace_root,
        file,
        max_results=max_results,
    )

    return {
        "ok": True,
        "file": file,
        "related": items,
        "count": len(items),
    }
