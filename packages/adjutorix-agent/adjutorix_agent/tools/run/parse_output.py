"""
run.parse_output

Parse stdout/stderr text from tools into structured diagnostics that VS Code can surface
(file:line:col, severity, message).

Supports common formats:
- Python tracebacks (best-effort)
- Node/TS/ESLint-style: path:line:col message
- Rust-like: --> path:line:col
- Generic "path:line" patterns

This tool is deterministic and never executes code.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class Diagnostic:
    file: str
    line: int
    col: int
    severity: str  # "error" | "warning" | "info"
    message: str
    source: str  # tool name or "unknown"


_RE_FILE_LINE_COL = re.compile(
    r"""
    (?P<file>
        (?:[A-Za-z]:[\\/])?      # optional Windows drive
        [^\s:]+                  # path-ish token
        (?:[/\\][^\s:]+)*        # more segments
        \.(?:py|ts|tsx|js|jsx|mjs|cjs|rs|go|java|kt|cpp|c|h|cs|php|rb|swift|scala|sql|yaml|yml|toml|json)
    )
    :
    (?P<line>\d+)
    (?:
      :
      (?P<col>\d+)
    )?
    (?:
      \s*[-:]\s*
      (?P<msg>.*)
    )?
    """,
    re.VERBOSE,
)

_RE_RUST_ARROW = re.compile(r"-->\s+(?P<file>.+?):(?P<line>\d+):(?P<col>\d+)")

_RE_PY_TRACE = re.compile(r'File\s+"(?P<file>[^"]+)",\s+line\s+(?P<line>\d+)')


def _norm_path(workspace_root: str, p: str) -> str:
    """
    Normalize to a workspace-relative path if possible, otherwise absolute normalized.
    """
    try:
        root = Path(workspace_root).resolve()
        path = Path(p).expanduser()
        if not path.is_absolute():
            path = (root / path).resolve()
        else:
            path = path.resolve()

        try:
            rel = path.relative_to(root)
            return str(rel).replace("\\", "/")
        except Exception:
            return str(path).replace("\\", "/")
    except Exception:
        return p.replace("\\", "/")


def _dedupe(diags: List[Diagnostic]) -> List[Diagnostic]:
    seen = set()
    out: List[Diagnostic] = []
    for d in diags:
        key = (d.file, d.line, d.col, d.severity, d.message, d.source)
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


def _severity_from_text(text: str) -> str:
    t = text.lower()
    if "warning" in t:
        return "warning"
    if "error" in t or "failed" in t or "exception" in t or "traceback" in t:
        return "error"
    return "info"


def parse_output(
    *,
    workspace_root: str,
    stdout: str = "",
    stderr: str = "",
    source: str = "unknown",
    max_items: int = 500,
) -> Dict[str, Any]:
    """
    Tool entrypoint.

    Returns:
      {
        "diagnostics": [
           {"file": "...", "line": 12, "col": 1, "severity": "error", "message": "...", "source": "..."},
           ...
        ],
        "summary": {"errors": n, "warnings": m, "info": k}
      }
    """
    text = "\n".join([stdout or "", stderr or ""]).strip()
    if not text:
        return {"diagnostics": [], "summary": {"errors": 0, "warnings": 0, "info": 0}}

    diags: List[Diagnostic] = []

    # 1) Rust arrow format
    for m in _RE_RUST_ARROW.finditer(text):
        file_ = _norm_path(workspace_root, m.group("file").strip())
        line = int(m.group("line"))
        col = int(m.group("col"))
        diags.append(
            Diagnostic(
                file=file_,
                line=max(1, line),
                col=max(1, col),
                severity="error",
                message="Rust compiler diagnostic",
                source=source,
            )
        )
        if len(diags) >= max_items:
            break

    # 2) Python traceback lines
    if len(diags) < max_items and ("Traceback" in text or "traceback" in text):
        for m in _RE_PY_TRACE.finditer(text):
            file_ = _norm_path(workspace_root, m.group("file").strip())
            line = int(m.group("line"))
            diags.append(
                Diagnostic(
                    file=file_,
                    line=max(1, line),
                    col=1,
                    severity="error",
                    message="Python traceback location",
                    source=source,
                )
            )
            if len(diags) >= max_items:
                break

    # 3) Generic file:line:col patterns (eslint/tsc/pytest-like)
    if len(diags) < max_items:
        for m in _RE_FILE_LINE_COL.finditer(text):
            file_ = _norm_path(workspace_root, m.group("file").strip())
            line = int(m.group("line"))
            col = int(m.group("col") or "1")
            msg = (m.group("msg") or "").strip()
            sev = _severity_from_text(msg or text)
            if not msg:
                msg = "Diagnostic"
            diags.append(
                Diagnostic(
                    file=file_,
                    line=max(1, line),
                    col=max(1, col),
                    severity=sev,
                    message=msg[:5000],
                    source=source,
                )
            )
            if len(diags) >= max_items:
                break

    diags = _dedupe(diags)

    summary = {"errors": 0, "warnings": 0, "info": 0}
    for d in diags:
        if d.severity == "error":
            summary["errors"] += 1
        elif d.severity == "warning":
            summary["warnings"] += 1
        else:
            summary["info"] += 1

    return {
        "diagnostics": [
            {
                "file": d.file,
                "line": d.line,
                "col": d.col,
                "severity": d.severity,
                "message": d.message,
                "source": d.source,
            }
            for d in diags
        ],
        "summary": summary,
    }
