"""
write_file tool

Safely writes or overwrites files inside workspace.
Supports atomic writes and path validation.
"""

from __future__ import annotations

import os
import tempfile
import shutil
from typing import Optional, Dict, Any

from adjutorix_agent.tools.registry import register_tool


MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


class WriteFileError(Exception):
    pass


def _validate_path(path: str, root: Optional[str] = None) -> str:
    """
    Validate and normalize file path.
    Prevent directory traversal.
    """

    if not path or not isinstance(path, str):
        raise WriteFileError("Invalid path")

    abs_path = os.path.abspath(path)

    if root:
        root = os.path.abspath(root)
        if not abs_path.startswith(root):
            raise WriteFileError("Path escapes workspace")

    return abs_path


def _atomic_write(path: str, content: str) -> None:
    """
    Perform atomic write using temp file + rename.
    """

    directory = os.path.dirname(path)

    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=directory)

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)

        shutil.move(tmp_path, path)

    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def write_file(
    path: str,
    content: str,
    *,
    workspace_root: Optional[str] = None,
    create_dirs: bool = True,
    overwrite: bool = True,
) -> Dict[str, Any]:
    """
    Write file content safely.

    Hard gate: direct writes are disabled. Use patch.propose then patch.accept
    then patch.apply (RPC) for governed edits. No write reaches disk without
    a recorded patch.
    """
    raise WriteFileError(
        "Direct write disabled. Use patch.propose (file_ops) then patch.accept "
        "then patch.apply for governed edits."
    )


# ----------------------------------------------------------------------
# Registration
# ----------------------------------------------------------------------

register_tool(
    name="write_file",
    handler=write_file,
    description="Write or overwrite file content atomically",
    dangerous=False,
    requires_confirmation=False,
    category="filesystem",
    timeout=5,
)
