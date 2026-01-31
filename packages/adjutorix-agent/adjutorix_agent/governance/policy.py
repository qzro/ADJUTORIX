"""
policy

Loads and merges:
- global policy (~/.agent/global.yaml)
- workspace router config (~/.agent/workspaces.yaml) [optional for routing]
- repo policy (.agent/policy.yaml)
- repo constraints (.agent/constraints.yaml)

Provides a single normalized Policy object used by:
- tool registry (allow/deny)
- run_command sandbox
- protected files guard
- network guard
- patch gate limits
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import yaml


def _read_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Invalid YAML root (expected mapping): {path}")
    return data


def _deep_merge(base: Dict[str, Any], overlay: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in overlay.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _expand_user(path: str) -> Path:
    return Path(os.path.expanduser(path)).resolve()


@dataclass(frozen=True)
class Policy:
    repo_root: str

    # Command sandbox
    allowed_commands: Tuple[str, ...] = ()
    blocked_commands: Tuple[str, ...] = ()
    allow_network: bool = False

    # Patch/edit constraints
    max_files_per_patch: int = 8
    max_patch_bytes: int = 300_000

    # Context budget
    max_files_per_prompt: int = 8
    max_slice_bytes: int = 18_000
    max_total_context_bytes: int = 80_000

    # Protected files
    protected_globs: Tuple[str, ...] = (
        ".github/workflows/**",
        "**/infra/**",
        "**/terraform/**",
        "**/*.tf",
        "**/*.pem",
        "**/*.key",
        "**/.env",
        "**/.env.*",
        "**/secrets/**",
    )

    # Ignore globs (for listing/indexing)
    ignore_globs: Tuple[str, ...] = (
        "**/.git/**",
        "**/.venv/**",
        "**/venv/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/__pycache__/**",
        "**/.pytest_cache/**",
        "**/.mypy_cache/**",
        "**/.ruff_cache/**",
        "**/.cache/**",
    )

    # Tooling commands per repo (for tasks)
    commands: Dict[str, str] = field(default_factory=dict)

    # Secrets patterns
    secrets_patterns: Tuple[str, ...] = (
        "AKIA[0-9A-Z]{16}",               # AWS access key id
        "-----BEGIN(.*)PRIVATE KEY-----", # private key block
        "ghp_[A-Za-z0-9]{36,}",           # GitHub token
        "xox[baprs]-[A-Za-z0-9-]{10,}",   # Slack tokens
        "sk-[A-Za-z0-9]{20,}",            # OpenAI-like key pattern
    )


@dataclass(frozen=True)
class LoadedPolicy:
    policy: Policy
    sources: Tuple[str, ...]  # paths loaded in precedence order (low->high)


class PolicyLoader:
    """
    Loads policy from:
      1) ~/.agent/global.yaml
      2) <repo>/.agent/policy.yaml
      3) <repo>/.agent/constraints.yaml (overrides and adds strict flags)

    All are optional.
    """

    def __init__(self, repo_root: str) -> None:
        self.repo_root = str(Path(repo_root).resolve())
        self.repo_agent_dir = Path(self.repo_root) / ".agent"

    def load(self) -> LoadedPolicy:
        sources: List[str] = []

        base = self._load_global(sources)
        repo = self._load_repo_policy(sources)
        constraints = self._load_repo_constraints(sources)

        merged = _deep_merge(_deep_merge(base, repo), constraints)

        policy = self._normalize(merged)

        return LoadedPolicy(policy=policy, sources=tuple(sources))

    def _load_global(self, sources: List[str]) -> Dict[str, Any]:
        path = _expand_user("~/.agent/global.yaml")
        if path.exists():
            sources.append(str(path))
        return _read_yaml(path)

    def _load_repo_policy(self, sources: List[str]) -> Dict[str, Any]:
        path = self.repo_agent_dir / "policy.yaml"
        if path.exists():
            sources.append(str(path))
        return _read_yaml(path)

    def _load_repo_constraints(self, sources: List[str]) -> Dict[str, Any]:
        path = self.repo_agent_dir / "constraints.yaml"
        if path.exists():
            sources.append(str(path))
        return _read_yaml(path)

    def _normalize(self, d: Dict[str, Any]) -> Policy:
        # Command sandbox
        allowed_cmds = tuple(d.get("allowed_commands", []) or [])
        blocked_cmds = tuple(d.get("blocked_commands", []) or [])
        allow_network = bool(d.get("allow_network", False))

        # Patch/edit constraints
        max_files_per_patch = int(d.get("max_files_per_patch", 8))
        max_patch_bytes = int(d.get("max_patch_bytes", 300_000))

        # Context budget
        max_files_per_prompt = int(d.get("max_files_per_prompt", 8))
        max_slice_bytes = int(d.get("max_slice_bytes", 18_000))
        max_total_context_bytes = int(d.get("max_total_context_bytes", 80_000))

        # Protected/ignore globs
        protected_globs = tuple(d.get("protected_globs", Policy.protected_globs) or [])
        ignore_globs = tuple(d.get("ignore_globs", Policy.ignore_globs) or [])

        # Per-repo command aliases
        commands = d.get("commands", {}) or {}
        if not isinstance(commands, dict):
            raise ValueError("policy.commands must be a mapping")

        # Secrets patterns
        secrets_patterns = tuple(d.get("secrets_patterns", Policy.secrets_patterns) or [])

        # Provide defaults for common commands if missing
        defaults = {
            "check": "make check",
            "fix": "make fix",
            "verify": "make verify",
            "deploy_preview": "wrangler deploy --env preview",
            "deploy_prod": "wrangler deploy --env production",
            "rollback": "git revert --no-edit HEAD",
        }
        for k, v in defaults.items():
            commands.setdefault(k, v)

        return Policy(
            repo_root=self.repo_root,
            allowed_commands=allowed_cmds,
            blocked_commands=blocked_cmds,
            allow_network=allow_network,
            max_files_per_patch=max_files_per_patch,
            max_patch_bytes=max_patch_bytes,
            max_files_per_prompt=max_files_per_prompt,
            max_slice_bytes=max_slice_bytes,
            max_total_context_bytes=max_total_context_bytes,
            protected_globs=protected_globs,
            ignore_globs=ignore_globs,
            commands=commands,
            secrets_patterns=secrets_patterns,
        )


def repo_policy_paths(repo_root: str) -> Dict[str, str]:
    """
    Convenience for UI/diagnostics.
    """
    root = Path(repo_root).resolve()
    return {
        "global": str(_expand_user("~/.agent/global.yaml")),
        "repo_policy": str(root / ".agent" / "policy.yaml"),
        "repo_constraints": str(root / ".agent" / "constraints.yaml"),
    }
