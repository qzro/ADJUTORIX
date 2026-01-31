"""
read_file tool

Safely reads files with optional slicing and size limits.
Used to prevent context bloat and unsafe file access.
"""

from __future__ import annotations

import os
from typing import Optional, Dict, Any

from adjutorix_agent.tools.registry import register_tool
from adjutorix_agent.core.context_budget import ContextBudgetError


MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB hard limit
MAX_LINES = 2000


class ReadFileError(Exception):
    pass


def _validate_path(path: str, root: Optional[str] = None) -> str:
    """
    Validate and normalize file path.
    Prevents directory traversal.
    """

    if not path or not isinstance(path, str):
        raise ReadFileError("Invalid path")

    abs_path = os.path.abspath(path)

    if root:
        root = os.path.abspath(root)
        if not abs_path.startswith(root):
            raise ReadFileError("Path escapes workspace")

    if not os.path.isfile(abs_path):
        raise ReadFileError(f"File not found: {path}")

    return abs_path


def _check_size(path: str) -> None:
    size = os.path.getsize(path)

    if size > MAX_FILE_SIZE:
        raise ReadFileError(
            f"File too large ({size} bytes > {MAX_FILE_SIZE})"
        )


def read_file(
    path: str,
    *,
    start_line: Optional[int] = None,
    end_line: Optional[int] = None,
    max_lines: int = MAX_LINES,
    workspace_root: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Read file content with optional line slicing.

    Args:
        path: File path
        start_line: 1-based start line (inclusive)
        end_line: 1-based end line (inclusive)
        max_lines: Maximum lines returned
        workspace_root: Optional workspace root

    Returns:
        {
            "path": str,
            "start": int,
            "end": int,
            "total_lines": int,
            "content": str
        }
    """

    abs_path = _validate_path(path, workspace_root)
    _check_size(abs_path)

    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()

    except Exception as exc:
        raise ReadFileError(f"Failed to read file: {exc}") from exc

    total = len(lines)

    # Normalize slice
    start = max((start_line or 1), 1)
    end = min((end_line or total), total)

    if start > end:
        raise ReadFileError("start_line > end_line")

    # Enforce max_lines
    if (end - start + 1) > max_lines:
        raise ContextBudgetError(
            f"Requested slice too large ({end - start + 1} lines)"
        )

    sliced = lines[start - 1 : end]

    content = "".join(sliced)

    return {
        "path": abs_path,
        "start": start,
        "end": end,
        "total_lines": total,
        "content": content,
    }


# ----------------------------------------------------------------------
# Registration
# ----------------------------------------------------------------------

register_tool(
    name="read_file",
    handler=read_file,
    description="Read file content with optional line slicing",
    dangerous=False,
    requires_confirmation=False,
    category="filesystem",
    timeout=5,
)
