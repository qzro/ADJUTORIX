"""
network_guard

Prevents unauthorized network access by the agent.

Default policy:
- No outbound network access
- No curl/wget/pip/npm install
- No remote script execution
- No external API calls

Only explicitly allowlisted commands may use network.
"""

from __future__ import annotations

import re
from typing import List, Pattern


# Commands that imply network usage
BLOCKED_PATTERNS: List[Pattern[str]] = [
    re.compile(r"\bcurl\b"),
    re.compile(r"\bwget\b"),
    re.compile(r"\bhttp(s)?://"),
    re.compile(r"\bgit\s+clone\b"),
    re.compile(r"\bnpm\s+install\b"),
    re.compile(r"\bpip\s+install\b"),
    re.compile(r"\byarn\s+add\b"),
    re.compile(r"\bapt(-get)?\s+install\b"),
    re.compile(r"\bbrew\s+install\b"),
    re.compile(r"\bssh\b"),
    re.compile(r"\bscp\b"),
    re.compile(r"\brsync\b"),
]


# Allowed network commands (exact match prefixes)
ALLOWLIST_PREFIXES = (
    "git push",
    "git fetch",
    "git pull",
    "wrangler deploy",
    "gh pr",
)


class NetworkViolation(Exception):
    pass


class NetworkGuard:
    """
    Enforces offline-first execution.

    Blocks commands that attempt external network access
    unless explicitly allowlisted.
    """

    def __init__(self) -> None:
        self._enabled: bool = True

    def enable(self) -> None:
        self._enabled = True

    def disable(self) -> None:
        self._enabled = False

    def is_allowed(self, command: str) -> bool:
        """
        Check if command is explicitly allowed.
        """
        cmd = command.strip().lower()

        for prefix in ALLOWLIST_PREFIXES:
            if cmd.startswith(prefix):
                return True

        return False

    def _matches_blocked(self, command: str) -> bool:
        """
        Check if command matches blocked patterns.
        """
        for pattern in BLOCKED_PATTERNS:
            if pattern.search(command):
                return True
        return False

    def validate(self, command: str) -> None:
        """
        Validate command before execution.
        Raises NetworkViolation if blocked.
        """
        if not self._enabled:
            return

        cmd = command.strip()

        if self.is_allowed(cmd):
            return

        if self._matches_blocked(cmd):
            raise NetworkViolation(
                f"Network access blocked by policy:\n{cmd}\n\n"
                "Use explicit OVERRIDE to allow."
            )

    # Integration helper ----------------------------------------

    def guard_command(self, command: str, override: bool = False) -> None:
        """
        Main entrypoint used by executor.

        If override=True, bypass protection.
        """
        if override:
            return

        self.validate(command)
