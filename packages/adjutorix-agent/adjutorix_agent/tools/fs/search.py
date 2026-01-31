"""
search tool (ripgrep wrapper)

Fast code search within a workspace root using ripgrep (`rg`).

Design goals:
- Deterministic output for tools-first agent workflows
- Safe path enforcement (no traversal outside workspace_root)
- No network, no shell pipelines
- Structured results (file, line, col, text)

Requires: `rg` installed on PATH.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from adjutorix_agent.tools.registry import register_tool


@dataclass(frozen=True)
class Match:
    path: str
    line: int
    col: int
    text: str


def _is_within(root: str, path: str) -> bool:
    root = os.path.abspath(root)
    path = os.path.abspath(path)
    try:
        return os.path.commonpath([root, path]) == root
    except ValueError:
        return False


def _normalize_rel(root: str, abs_path: str) -> str:
    rel = os.path.relpath(abs_path, root)
    return rel.replace(os.sep, "/")


_RG_VIMGREP_RE = re.compile(r"^(?P<file>.*?):(?P<line>\d+):(?P<col>\d+):(?P<text>.*)$")


def search(
    *,
    workspace_root: Optional[str] = None,
    query: str,
    start: str = ".",
    glob: Optional[List[str]] = None,
    ignore_glob: Optional[List[str]] = None,
    case_sensitive: bool = False,
    regex: bool = True,
    max_results: int = 200,
    max_files: int = 50,
    context: int = 0,
) -> Dict[str, Any]:
    """
    Search for `query` inside workspace using ripgrep.

    Args:
        workspace_root: required
        query: regex (default) or literal (regex=False)
        start: relative search root inside workspace_root
        glob: list of include globs passed to rg --glob
        ignore_glob: list of exclude globs passed to rg --glob !pattern
        case_sensitive: if False, use -i
        regex: if False, use --fixed-string
        max_results: cap matches returned (post-filter)
        max_files: cap unique files returned (post-filter)
        context: number of context lines (0 returns only matching line)

    Returns:
        {
          "query": str,
          "count": int,
          "truncated": bool,
          "files": int,
          "matches": [{"path","line","col","text"}...]
        }
    """
    if not workspace_root:
        raise ValueError("workspace_root is required")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query is required")

    root = os.path.abspath(workspace_root)
    start_abs = os.path.abspath(os.path.join(root, start))
    if not _is_within(root, start_abs):
        raise ValueError("start path escapes workspace_root")
    if not os.path.isdir(start_abs):
        raise ValueError(f"start not found: {start}")

    cmd: List[str] = ["rg", "--vimgrep", "--no-heading", "--color", "never", "--hidden"]

    # sane default excludes; respect .gitignore by default
    cmd += ["--glob", "!.git/**", "--glob", "!node_modules/**", "--glob", "!.venv/**", "--glob", "!dist/**", "--glob", "!build/**"]

    if glob:
        for g in glob:
            if isinstance(g, str) and g.strip():
                cmd += ["--glob", g.strip()]
    if ignore_glob:
        for g in ignore_glob:
            if isinstance(g, str) and g.strip():
                pat = g.strip()
                if not pat.startswith("!"):
                    pat = "!" + pat
                cmd += ["--glob", pat]

    if not case_sensitive:
        cmd.append("-i")
    if not regex:
        cmd.append("--fixed-strings")

    if context and context > 0:
        cmd += ["-C", str(int(context))]

    cmd.append(query)
    cmd.append(start_abs)

    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    except FileNotFoundError as e:
        raise RuntimeError("ripgrep (rg) is not installed or not on PATH") from e

    # rg returns 0 if matches, 1 if no matches, >1 on error
    if proc.returncode not in (0, 1):
        err = (proc.stderr or "").strip()
        raise RuntimeError(f"rg failed (code {proc.returncode}): {err[:500]}")

    matches: List[Match] = []
    truncated = False
    seen_files: List[str] = []

    for line in proc.stdout.splitlines():
        m = _RG_VIMGREP_RE.match(line)
        if not m:
            # When context is enabled, rg still emits vimgrep lines for matches,
            # but may include separator lines depending on version. Ignore unknown.
            continue

        abs_file = m.group("file")
        if not _is_within(root, abs_file):
            continue

        rel_file = _normalize_rel(root, abs_file)
        ln = int(m.group("line"))
        col = int(m.group("col"))
        text = m.group("text")

        if rel_file not in seen_files:
            seen_files.append(rel_file)
            if len(seen_files) > max_files:
                truncated = True
                break

        matches.append(Match(path=rel_file, line=ln, col=col, text=text))
        if len(matches) >= max_results:
            truncated = True
            break

    return {
        "query": query,
        "count": len(matches),
        "truncated": truncated,
        "files": len(set(m.path for m in matches)),
        "matches": [m.__dict__ for m in matches],
    }


register_tool(
    name="search",
    handler=search,
    description="Search workspace using ripgrep (rg) returning structured match results",
    dangerous=False,
    requires_confirmation=False,
    category="filesystem",
    timeout=20,
)
