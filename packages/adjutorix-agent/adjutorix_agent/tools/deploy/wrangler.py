"""
wrangler

Deterministic Cloudflare Wrangler deploy tool wrapper.

Design:
- Zero network from this tool itself, but it executes `wrangler` which obviously talks to Cloudflare.
- Uses the sandboxed command runner to enforce allowlists.
- Does not parse secrets; it logs only safe outputs.
- Supports deploy/preview/rollback via repo policy commands.

This tool assumes:
- The workspace repo already has Cloudflare project config (wrangler.toml / package scripts).
- Auth is handled by user's local environment (wrangler login / CF_API_TOKEN).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..run.run_command import run_command
from ..run.allowlist import CommandAllowlist


@dataclass(frozen=True)
class WranglerResult:
    ok: bool
    command: List[str]
    cwd: str
    exit_code: int
    stdout: str
    stderr: str


def _ensure_wranger_allowed(allowlist: CommandAllowlist) -> None:
    # Allowlist must explicitly permit wrangler usage.
    allowlist.require_allowed("wrangler")


def deploy(
    *,
    repo_root: str,
    allowlist: CommandAllowlist,
    project_dir: Optional[str] = None,
    env: Optional[str] = None,
    dry_run: bool = False,
    extra_args: Optional[List[str]] = None,
    timeout_sec: int = 900,
) -> WranglerResult:
    """
    Deploy to Cloudflare using `wrangler deploy`.

    Args:
      repo_root: workspace root
      allowlist: sandbox allowlist
      project_dir: optional subdir (e.g., packages/worker)
      env: optional environment name (-e)
      dry_run: if True, runs `wrangler deploy --dry-run` (where supported)
      extra_args: appended raw args (still sandboxed)
      timeout_sec: process timeout
    """
    _ensure_wranger_allowed(allowlist)

    cwd = Path(repo_root)
    if project_dir:
        cwd = (cwd / project_dir).resolve()

    cmd: List[str] = ["wrangler", "deploy"]
    if env:
        cmd += ["-e", env]
    if dry_run:
        cmd += ["--dry-run"]
    if extra_args:
        cmd += extra_args

    res = run_command(
        command=cmd,
        cwd=str(cwd),
        allowlist=allowlist,
        timeout_sec=timeout_sec,
        capture_output=True,
        text=True,
    )
    return WranglerResult(
        ok=res.exit_code == 0,
        command=cmd,
        cwd=str(cwd),
        exit_code=res.exit_code,
        stdout=res.stdout,
        stderr=res.stderr,
    )


def rollback(
    *,
    repo_root: str,
    allowlist: CommandAllowlist,
    project_dir: Optional[str] = None,
    script: Optional[List[str]] = None,
    timeout_sec: int = 900,
) -> WranglerResult:
    """
    Rollback is repo-specific. Wrangler doesn't provide a universal "rollback" for all products.
    So this tool executes a policy-defined rollback script (e.g., npm script, wrangler versions deploy).

    Args:
      script: full command list defined by policy, e.g. ["npm","run","rollback"] or ["wrangler","versions","deploy",...]
    """
    _ensure_wranger_allowed(allowlist)

    cwd = Path(repo_root)
    if project_dir:
        cwd = (cwd / project_dir).resolve()

    if not script:
        # deterministic failure: no rollback script provided
        return WranglerResult(
            ok=False,
            command=[],
            cwd=str(cwd),
            exit_code=2,
            stdout="",
            stderr="No rollback script provided. Define one in repo policy.",
        )

    res = run_command(
        command=script,
        cwd=str(cwd),
        allowlist=allowlist,
        timeout_sec=timeout_sec,
        capture_output=True,
        text=True,
    )
    return WranglerResult(
        ok=res.exit_code == 0,
        command=script,
        cwd=str(cwd),
        exit_code=res.exit_code,
        stdout=res.stdout,
        stderr=res.stderr,
    )


def preview_deploy(
    *,
    repo_root: str,
    allowlist: CommandAllowlist,
    project_dir: Optional[str] = None,
    env: Optional[str] = "preview",
    extra_args: Optional[List[str]] = None,
    timeout_sec: int = 900,
) -> WranglerResult:
    """
    Deploy to a preview environment by convention (-e preview).
    """
    return deploy(
        repo_root=repo_root,
        allowlist=allowlist,
        project_dir=project_dir,
        env=env,
        dry_run=False,
        extra_args=extra_args,
        timeout_sec=timeout_sec,
    )
