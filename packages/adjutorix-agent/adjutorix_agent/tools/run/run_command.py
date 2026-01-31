"""
run.run_command

Sandboxed process runner.

Hard rules:
- Enforces allowlist/denylist from governance policy.
- Default: no network tools unless explicitly allowed by policy.
- Captures stdout/stderr, return code, duration.
- Supports cwd within workspace root only.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .allowlist import CommandPolicy, load_command_policy, is_command_allowed


@dataclass
class RunResult:
    ok: bool
    returncode: int
    stdout: str
    stderr: str
    duration_ms: int
    command: List[str]
    cwd: str


def _normalize_cmd(cmd: str | List[str]) -> List[str]:
    if isinstance(cmd, list):
        return [str(x) for x in cmd]
    # shlex split supports quoted strings
    return shlex.split(cmd)


def _safe_cwd(workspace_root: str, cwd: Optional[str]) -> str:
    root = Path(workspace_root).resolve()
    if not cwd:
        return str(root)

    candidate = (root / cwd).resolve()
    # enforce inside root
    if root == candidate or root in candidate.parents:
        return str(candidate)

    # fallback to root if invalid
    return str(root)


def _truncate(s: str, limit: int) -> str:
    if len(s) <= limit:
        return s
    return s[:limit] + "\n...[truncated]...\n"


def run_command(
    *,
    workspace_root: str,
    command: str | List[str],
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    timeout_s: int = 1200,
    max_output_chars: int = 200_000,
    policy_path: Optional[str] = None,
) -> dict:
    """
    Tool entrypoint.

    Args:
        workspace_root: repo root
        command: string or argv list
        cwd: working directory relative to workspace_root
        env: environment overrides
        timeout_s: max seconds
        max_output_chars: truncate stdout/stderr to this limit
        policy_path: optional explicit policy yaml path (repo .agent/policy.yaml)

    Returns:
        dict with ok/returncode/stdout/stderr/duration_ms + metadata
    """
    argv = _normalize_cmd(command)
    root = Path(workspace_root).resolve()
    safe_cwd = _safe_cwd(workspace_root, cwd)

    # Load policy + enforce allowlist
    policy: CommandPolicy = load_command_policy(
        workspace_root=str(root),
        policy_path=policy_path,
    )

    allowed, reason = is_command_allowed(policy, argv)
    if not allowed:
        return {
            "ok": False,
            "error": {
                "type": "POLICY_DENY",
                "message": "Command blocked by policy.",
                "reason": reason,
                "command": argv,
            },
        }

    # Prepare env: start from current process env to support toolchains
    proc_env = os.environ.copy()
    if env:
        # Do not allow overriding PATH in a dangerous way; keep simple guard
        for k, v in env.items():
            if k.upper() == "PATH":
                continue
            proc_env[str(k)] = str(v)

    start = time.time()
    try:
        p = subprocess.run(
            argv,
            cwd=safe_cwd,
            env=proc_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_s,
            check=False,
        )
        duration_ms = int((time.time() - start) * 1000)

        stdout = _truncate(p.stdout or "", max_output_chars)
        stderr = _truncate(p.stderr or "", max_output_chars)

        return {
            "ok": (p.returncode == 0),
            "returncode": p.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "duration_ms": duration_ms,
            "command": argv,
            "cwd": safe_cwd,
        }

    except subprocess.TimeoutExpired as e:
        duration_ms = int((time.time() - start) * 1000)
        out = (e.stdout or "") if isinstance(e.stdout, str) else ""
        err = (e.stderr or "") if isinstance(e.stderr, str) else ""
        return {
            "ok": False,
            "error": {
                "type": "TIMEOUT",
                "message": "Command timed out.",
                "timeout_s": timeout_s,
                "command": argv,
            },
            "returncode": 124,
            "stdout": _truncate(out, max_output_chars),
            "stderr": _truncate(err, max_output_chars),
            "duration_ms": duration_ms,
            "command": argv,
            "cwd": safe_cwd,
        }

    except FileNotFoundError:
        duration_ms = int((time.time() - start) * 1000)
        return {
            "ok": False,
            "error": {
                "type": "NOT_FOUND",
                "message": "Executable not found.",
                "command": argv,
            },
            "returncode": 127,
            "stdout": "",
            "stderr": "",
            "duration_ms": duration_ms,
            "command": argv,
            "cwd": safe_cwd,
        }

    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        return {
            "ok": False,
            "error": {
                "type": "RUN_ERROR",
                "message": str(e),
                "command": argv,
            },
            "returncode": 1,
            "stdout": "",
            "stderr": "",
            "duration_ms": duration_ms,
            "command": argv,
            "cwd": safe_cwd,
        }
