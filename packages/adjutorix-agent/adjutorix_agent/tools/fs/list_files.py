"""
list_files tool

Lists files under workspace root with:
- glob include/exclude
- directory pruning
- max results
- safe path enforcement (no traversal outside workspace)
"""

from __future__ import annotations

import fnmatch
import os
from typing import Any, Dict, List, Optional, Tuple

from adjutorix_agent.tools.registry import register_tool


def _abspath(root: str, p: str) -> str:
    return os.path.abspath(os.path.join(root, p))


def _is_within(root: str, path: str) -> bool:
    root = os.path.abspath(root)
    path = os.path.abspath(path)
    try:
        common = os.path.commonpath([root, path])
    except ValueError:
        return False
    return common == root


def _compile_patterns(patterns: Optional[List[str]]) -> List[str]:
    if not patterns:
        return []
    out: List[str] = []
    for pat in patterns:
        if isinstance(pat, str) and pat.strip():
            out.append(pat.strip())
    return out


def _match_any(path: str, patterns: List[str]) -> bool:
    if not patterns:
        return False
    # normalize to forward slashes for consistent matching
    p = path.replace(os.sep, "/")
    return any(fnmatch.fnmatch(p, pat) for pat in patterns)


def list_files(
    *,
    workspace_root: Optional[str] = None,
    start: str = ".",
    include: Optional[List[str]] = None,
    exclude: Optional[List[str]] = None,
    exclude_dirs: Optional[List[str]] = None,
    max_results: int = 5000,
    include_dirs: bool = False,
) -> Dict[str, Any]:
    """
    List files relative to workspace_root.

    Args:
        workspace_root: workspace root path
        start: relative start folder inside workspace root
        include: glob patterns; if provided, only paths matching any are kept
        exclude: glob patterns; paths matching any are removed
        exclude_dirs: directory names (or glob patterns) to prune during walk
        max_results: max number of returned paths
        include_dirs: whether to include directories in results

    Returns:
        {
          "root": str,
          "start": str,
          "count": int,
          "truncated": bool,
          "paths": [str...]
        }
    """
    if not workspace_root:
        raise ValueError("workspace_root is required")

    root = os.path.abspath(workspace_root)
    if not os.path.isdir(root):
        raise ValueError(f"workspace_root not found: {workspace_root}")

    start_abs = _abspath(root, start)
    if not _is_within(root, start_abs):
        raise ValueError("start path escapes workspace_root")
    if not os.path.exists(start_abs):
        raise ValueError(f"start path not found: {start}")

    inc = _compile_patterns(include)
    exc = _compile_patterns(exclude)
    exc_dirs = _compile_patterns(exclude_dirs or ["**/.git/**", "**/node_modules/**", "**/.venv/**", "**/dist/**", "**/build/**"])

    out: List[str] = []
    truncated = False

    for dirpath, dirnames, filenames in os.walk(start_abs):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir_norm = "." if rel_dir == "." else rel_dir.replace(os.sep, "/")

        # prune directories
        pruned: List[str] = []
        for d in dirnames:
            rel = os.path.join(rel_dir_norm, d).replace(os.sep, "/")
            if _match_any(rel + "/", exc_dirs) or _match_any(rel + "/**", exc_dirs) or _match_any(rel, exc_dirs):
                pruned.append(d)
        for d in pruned:
            if d in dirnames:
                dirnames.remove(d)

        # include directories optionally
        if include_dirs:
            if rel_dir_norm != ".":
                if (not inc or _match_any(rel_dir_norm, inc)) and (not _match_any(rel_dir_norm, exc)):
                    out.append(rel_dir_norm)
                    if len(out) >= max_results:
                        truncated = True
                        break

        # add files
        for f in filenames:
            rel_path = os.path.join(rel_dir_norm, f).replace(os.sep, "/") if rel_dir_norm != "." else f
            if inc and not _match_any(rel_path, inc):
                continue
            if exc and _match_any(rel_path, exc):
                continue
            out.append(rel_path)
            if len(out) >= max_results:
                truncated = True
                break

        if truncated:
            break

    return {
        "root": root,
        "start": start,
        "count": len(out),
        "truncated": truncated,
        "paths": out,
    }


register_tool(
    name="list_files",
    handler=list_files,
    description="List files under workspace root with include/exclude globs and pruning",
    dangerous=False,
    requires_confirmation=False,
    category="filesystem",
    timeout=10,
)
