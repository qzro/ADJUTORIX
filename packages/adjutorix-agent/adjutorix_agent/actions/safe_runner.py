"""
Safe action runner: deterministic allowlist, no git, no implicit exec.
Actions = pure config + allowlist executor.

VSC-only: check/fix/verify run npm scripts in packages/adjutorix-vscode;
only scripts that exist in that package's package.json are run (no "Missing script").

Invariant (governed edits): No write reaches disk without a recorded patch.
Tools should produce file_ops and call patch.propose; apply is via patch.apply only.
Fix path currently runs npm run lint --fix (writes to disk); v2 will emit file_ops and propose.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


class PolicyError(RuntimeError):
    pass


# Relative to repo root; actions run from repo root so this path resolves.
VSC_PACKAGE_SUBDIR = Path("packages") / "adjutorix-vscode"

# Fallback allowlist for actions that don't use VSC-generated cmds (e.g. deploy).
# Check/verify/fix use generated "npm -C <path> run <script>" strings; allowlist is allow = DEFAULT_ALLOWED | cmds.
DEFAULT_ALLOWED = {
    "echo \"deploy not configured\"",
}


def npm_scripts(pkg_dir: Path) -> set[str]:
    """Return script names from package.json scripts section."""
    pj = pkg_dir / "package.json"
    if not pj.exists():
        return set()
    try:
        data = json.loads(pj.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return set()
    return set((data.get("scripts") or {}).keys())


def npm_run(pkg_dir: Path, script: str, extra: str = "") -> Optional[List[str]]:
    """Return a one-element command list to run the script, or None if script doesn't exist."""
    scripts = npm_scripts(pkg_dir)
    if script not in scripts:
        return None
    cmd = f"npm -C {shlex.quote(str(pkg_dir))} run {shlex.quote(script)}"
    if extra:
        cmd += f" -- {extra}"
    return [cmd]


def get_vsc_commands(repo_root: str, kind: str) -> List[str]:
    """
    Build check/fix/verify commands from packages/adjutorix-vscode package.json.
    Only includes scripts that exist. Returns [] if VSC package not present.
    """
    root = Path(repo_root).resolve()
    vsc = root / VSC_PACKAGE_SUBDIR
    if not (vsc / "package.json").exists():
        return []

    cmds: List[str] = []
    if kind == "check":
        r = npm_run(vsc, "build")
        if r:
            cmds.extend(r)
        r = npm_run(vsc, "lint")
        if r:
            cmds.extend(r)
        r = npm_run(vsc, "test")
        if r:
            cmds.extend(r)
    elif kind == "fix":
        r = npm_run(vsc, "lint", "--fix")
        if r:
            cmds.extend(r)
        else:
            r = npm_run(vsc, "build")
            if r:
                cmds.extend(r)
    elif kind == "verify":
        r = npm_run(vsc, "build")
        if r:
            cmds.extend(r)
        r = npm_run(vsc, "test")
        if r:
            cmds.extend(r)
    else:
        return []
    return cmds


def load_actions(repo_root: str) -> Dict[str, Any]:
    p = Path(repo_root) / ".adjutorix" / "actions.json"
    if not p.exists():
        raise PolicyError(f"Missing actions config: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def _copy_tracked_files(repo_root: Path, dest: Path) -> None:
    """
    Copy only git-tracked files from repo_root to dest.
    Preserves directory structure. Raises PolicyError if git ls-files fails.
    """
    proc = subprocess.run(
        ["git", "ls-files"],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise PolicyError(
            f"Sandbox requires git; git ls-files failed: {proc.stderr or proc.stdout or 'unknown'}"
        )
    lines = [s.strip() for s in (proc.stdout or "").strip().splitlines() if s.strip()]
    for rel in lines:
        if ".." in rel or rel.startswith("/") or "\\" in rel:
            continue
        src = repo_root / rel
        if not src.exists():
            continue
        if src.is_symlink():
            continue  # Skip symlinks; avoid ambiguity (copy target vs copy link) and escape risk
        dst = dest / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_file():
            shutil.copy2(src, dst)


def _run_in_sandbox(
    repo_root: Path,
    action: str,
    cmds: List[str],
    allow: set,
    start: float,
) -> Dict[str, Any]:
    """
    Run check/verify in an isolated temp copy: tracked files only, npm ci, then run cmds.
    Ensures the real repo is never dirtied by check/verify.
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix="adjutorix_sandbox_"))
    try:
        _copy_tracked_files(repo_root, tmp_dir)
        # Point caches into temp so we don't touch user's global caches for install
        cache_dir = tmp_dir / "npm_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["npm_config_cache"] = str(cache_dir)
        # Jest / other common caches
        env["JEST_CACHE_DIR"] = str(tmp_dir / "jest_cache")
        env["TMP"] = str(tmp_dir)
        env["TEMP"] = str(tmp_dir)

        # npm ci at workspace root (monorepo: installs all workspaces)
        pkg_json = tmp_dir / "package.json"
        if pkg_json.exists():
            proc_ci = subprocess.run(
                ["npm", "ci"],
                cwd=str(tmp_dir),
                capture_output=True,
                text=True,
                env=env,
            )
            if proc_ci.returncode != 0:
                return {
                    "status": "failed",
                    "message": "Sandbox npm ci failed; real repo unchanged.",
                    "results": [
                        {
                            "command": "npm ci",
                            "return_code": proc_ci.returncode,
                            "stdout": (proc_ci.stdout or "")[-4000:],
                            "stderr": (proc_ci.stderr or "")[-4000:],
                        }
                    ],
                    "duration": time.time() - start,
                }

        results: List[Dict[str, Any]] = []
        work_dir = tmp_dir
        for cmd in cmds:
            if cmd not in allow:
                raise PolicyError(f"Blocked command: {cmd}")
            p = subprocess.run(
                cmd,
                cwd=str(work_dir),
                shell=True,
                capture_output=True,
                text=True,
                env=env,
            )
            results.append({
                "command": cmd,
                "return_code": p.returncode,
                "stdout": (p.stdout or "")[-4000:],
                "stderr": (p.stderr or "")[-4000:],
            })
            if p.returncode != 0:
                return {
                    "status": "failed",
                    "message": f"Command failed: {cmd}",
                    "results": results,
                    "duration": time.time() - start,
                }
        return {
            "status": "success",
            "message": f"{action} OK (sandbox)",
            "results": results,
            "duration": time.time() - start,
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def run_action(
    repo_root: str,
    action: str,
    *,
    require_confirm: bool = False,
    cwd: Optional[str] = None,
) -> Dict[str, Any]:
    if os.getenv("ADJUTORIX_ACTIONS_DISABLED", "0") == "1":
        raise PolicyError("Actions are disabled (chat-only mode).")

    cfg = load_actions(repo_root)
    if action not in cfg:
        raise PolicyError(f"Unknown action: {action}")

    spec = cfg[action]

    # VSC-only: check/fix/verify run scripts from packages/adjutorix-vscode (only if they exist)
    if action in ("check", "fix", "verify"):
        vsc_cmds = get_vsc_commands(repo_root, action)
        if vsc_cmds:
            cmds = vsc_cmds
            allow = set(DEFAULT_ALLOWED) | set(cmds)
        else:
            cmds = list(spec.get("commands") or [])
            allow = set(DEFAULT_ALLOWED)
    else:
        cmds = list(spec.get("commands") or [])
        allow = set(DEFAULT_ALLOWED)

    if not cmds:
        raise PolicyError(f"No commands configured for action '{action}'")

    # Hard gate: fix must not write to disk until it emits file_ops and uses patch.propose
    if action == "fix":
        return {
            "status": "blocked",
            "message": "fix is propose-only; use patch.propose (file_ops) then patch.accept then patch.apply.",
            "results": [],
            "duration": 0.0,
        }

    if spec.get("requireConfirm") and not require_confirm:
        return {
            "status": "blocked",
            "message": f"Action '{action}' requires confirmation",
            "results": [],
            "duration": 0.0,
        }

    start = time.time()
    root = Path(repo_root).resolve()

    # Governance: check/verify run in isolated sandbox so the real repo is never dirtied.
    # Set ADJUTORIX_SANDBOX_ACTIONS=0 to run in-repo (legacy; ungoverned).
    if action in ("check", "verify") and os.getenv("ADJUTORIX_SANDBOX_ACTIONS", "1") != "0":
        return _run_in_sandbox(root, action, cmds, allow, start)

    results: List[Dict[str, Any]] = []
    work_dir = (Path(cwd) if cwd else root).resolve()
    if not work_dir.exists() or not work_dir.is_dir():
        work_dir = root
    for cmd in cmds:
        if cmd not in allow:
            raise PolicyError(f"Blocked command: {cmd}")
        p = subprocess.run(
            cmd,
            cwd=str(work_dir),
            shell=True,
            capture_output=True,
            text=True,
        )
        results.append({
            "command": cmd,
            "return_code": p.returncode,
            "stdout": (p.stdout or "")[-4000:],
            "stderr": (p.stderr or "")[-4000:],
        })
        if p.returncode != 0:
            return {
                "status": "failed",
                "message": f"Command failed: {cmd}",
                "results": results,
                "duration": time.time() - start,
            }
    return {
        "status": "success",
        "message": f"{action} OK",
        "results": results,
        "duration": time.time() - start,
    }
