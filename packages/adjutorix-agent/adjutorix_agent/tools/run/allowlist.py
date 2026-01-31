"""
run.allowlist

Central allowlist/denylist policy for commands the agent is permitted to execute.

Philosophy:
- Default deny.
- Only allow explicit, known-safe developer tooling commands.
- No shell pipelines, redirection, or compound commands by default.
- No network tools by default (curl/wget/git clone/etc.) unless policy explicitly enables.

This file provides deterministic checks used by run_command.py and governance guards.
"""

from __future__ import annotations

import os
import re
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class AllowDecision:
    allowed: bool
    reason: str


# Block common destructive / exfil patterns even if user tries to sneak via arguments.
_DENY_TOKENS = {
    "rm",
    "del",
    "mkfs",
    "dd",
    "shutdown",
    "reboot",
    "poweroff",
    "format",
    "diskpart",
    "reg",
    "sc",
    "netsh",
}

# Shell meta characters imply running through shell. We deny by default.
_SHELL_META = re.compile(r"[;&|`$><]|\$\(|\)\s*;")

# Common network / remote execution tools. Denied by default unless policy enables.
_NETWORK_TOOLS = {
    "curl",
    "wget",
    "powershell",
    "pwsh",
    "Invoke-WebRequest",
    "Invoke-Expression",
    "ssh",
    "scp",
    "sftp",
    "nc",
    "netcat",
}


def _is_windows() -> bool:
    return os.name == "nt"


def _base_cmd(token: str) -> str:
    # normalize "python3" -> "python3", "C:\\Python\\python.exe" -> "python"
    name = Path(token).name
    name = name.lower()
    if name.endswith(".exe"):
        name = name[:-4]
    return name


def _contains_shell_meta(cmd: str) -> bool:
    return bool(_SHELL_META.search(cmd))


def _normalize_args(argv: Sequence[str]) -> List[str]:
    return [a.strip() for a in argv if a.strip()]


def default_allowlist() -> Dict[str, List[str]]:
    """
    Base allowlist. Keys are executable basenames; values are allowed subcommands/patterns.

    This is intentionally conservative. Extend via repo policy if needed.
    """
    return {
        # Python
        "python": [],
        "python3": [],
        "pip": [],
        "pip3": [],
        "poetry": ["run", "install", "update", "lock", "check"],
        "uv": ["pip", "sync", "lock", "run"],
        "pytest": [],
        "ruff": [],
        "mypy": [],
        "pyright": [],
        "black": [],
        "isort": [],
        "pre-commit": ["run", "install", "uninstall"],
        # Node
        "node": [],
        "npm": ["run", "test", "ci", "install"],
        "pnpm": ["run", "test", "install"],
        "yarn": ["run", "test", "install"],
        "npx": [],
        "tsc": [],
        "eslint": [],
        "vitest": [],
        "jest": [],
        # Git (note: still non-network in practice; push uses remote)
        "git": ["status", "diff", "add", "commit", "checkout", "restore", "reset", "rev-parse", "log", "show", "fetch", "push", "pull"],
        "gh": ["pr", "repo", "issue", "auth"],
        # Build systems
        "make": [],
        "cmake": [],
        "cargo": ["build", "test", "check", "fmt", "clippy"],
        "go": ["test", "build", "fmt", "vet"],
        # Cloudflare
        "wrangler": ["deploy", "dev", "rollback", "tail", "whoami", "login", "logout"],
        # Utilities
        "rg": [],
        "ripgrep": [],
        "ctags": [],
        "tree": [],
    }


def decision_for_command(
    *,
    cmd: str,
    argv: Sequence[str],
    allow_network: bool = False,
    allow_shell: bool = False,
    allowlist: Optional[Dict[str, List[str]]] = None,
) -> AllowDecision:
    """
    Determine whether a command is allowed.

    Inputs:
      - cmd: original command string (for meta char detection)
      - argv: parsed argv vector (first item is executable)
      - allow_network: permit network tools (still blocked if dangerous tokens present)
      - allow_shell: permit shell meta characters (not recommended)
      - allowlist: override allowlist map

    Returns AllowDecision.
    """
    allowlist = allowlist or default_allowlist()
    argv_n = _normalize_args(argv)
    if not argv_n:
        return AllowDecision(False, "empty command")

    if not allow_shell and _contains_shell_meta(cmd):
        return AllowDecision(False, "shell meta characters are not allowed")

    exe = _base_cmd(argv_n[0])

    # Deny dangerous executables outright.
    if exe in _DENY_TOKENS:
        return AllowDecision(False, f"executable '{exe}' is denied")

    # Deny network tools by default.
    if (exe in _NETWORK_TOOLS) and not allow_network:
        return AllowDecision(False, f"network tool '{exe}' is denied by default")

    # Default deny if not explicitly allowed.
    if exe not in allowlist:
        return AllowDecision(False, f"executable '{exe}' not in allowlist")

    # If allowlist has subcommands restrictions, enforce them.
    allowed_sub = allowlist.get(exe, [])
    if allowed_sub:
        # subcommand is usually argv[1] if present
        sub = _base_cmd(argv_n[1]) if len(argv_n) > 1 else ""
        if sub not in [s.lower() for s in allowed_sub]:
            return AllowDecision(False, f"subcommand '{sub}' not allowed for '{exe}'")

    # Additional anti-patterns: piping remote scripts, etc.
    joined = " ".join(argv_n).lower()
    if "curl" in joined and "| sh" in joined:
        return AllowDecision(False, "pipe to shell is denied")
    if "wget" in joined and "| sh" in joined:
        return AllowDecision(False, "pipe to shell is denied")

    # Windows: block obvious PowerShell execution flags even if allow_network enabled.
    if exe in {"powershell", "pwsh"} and re.search(r"\b(-enc|-encodedcommand|-command)\b", joined):
        return AllowDecision(False, "powershell encoded/command execution is denied")

    return AllowDecision(True, "allowed")


def split_command(cmd: str) -> List[str]:
    """
    Split a command string into argv safely (no shell). If parsing fails, returns [].
    """
    try:
        return shlex.split(cmd, posix=not _is_windows())
    except Exception:
        return []
