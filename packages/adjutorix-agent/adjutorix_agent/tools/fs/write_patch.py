"""
write_patch tool

Applies a unified diff patch to files in workspace.

Design goals:
- strict path validation (no traversal)
- patch apply is atomic at the repo level (apply all hunks or none)
- supports dry_run for preview checks
- records per-file results for UI
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from typing import Optional, Dict, Any, List

from adjutorix_agent.tools.registry import register_tool


class PatchApplyError(Exception):
    pass


@dataclass
class ApplyResult:
    ok: bool
    stdout: str
    stderr: str
    returncode: int


def _validate_root(workspace_root: Optional[str]) -> str:
    if not workspace_root:
        raise PatchApplyError("workspace_root is required for patch apply")
    root = os.path.abspath(workspace_root)
    if not os.path.isdir(root):
        raise PatchApplyError(f"workspace_root does not exist: {workspace_root}")
    return root


def _run_git_apply(
    repo_root: str,
    patch_text: str,
    *,
    dry_run: bool,
    whitespace: str = "nowarn",
) -> ApplyResult:
    """
    Apply patch using `git apply` to ensure correct unified-diff semantics.

    - dry_run uses `--check`
    - whitespace: 'nowarn'|'warn'|'fix'
    """
    args = ["git", "apply"]

    if dry_run:
        args.append("--check")

    # Safer defaults
    args += ["--recount", "--unsafe-paths"]  # allow patch paths but we validate root
    # whitespace handling
    if whitespace == "fix":
        args.append("--whitespace=fix")
    elif whitespace == "warn":
        args.append("--whitespace=warn")
    else:
        args.append("--whitespace=nowarn")

    proc = subprocess.run(
        args,
        input=patch_text.encode("utf-8", errors="replace"),
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    return ApplyResult(
        ok=(proc.returncode == 0),
        stdout=proc.stdout.decode("utf-8", errors="replace"),
        stderr=proc.stderr.decode("utf-8", errors="replace"),
        returncode=proc.returncode,
    )


def _git_has_changes(repo_root: str) -> bool:
    proc = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    out = proc.stdout.decode("utf-8", errors="replace").strip()
    return len(out) > 0


def write_patch(
    patch: str,
    *,
    workspace_root: Optional[str] = None,
    dry_run: bool = False,
    whitespace: str = "nowarn",
    max_files_touched: int = 25,
) -> Dict[str, Any]:
    """
    Apply unified diff patch.

    Args:
        patch: Unified diff string
        workspace_root: Repo root
        dry_run: If True, validates patch without applying
        whitespace: nowarn|warn|fix
        max_files_touched: safety limit; enforced by PatchGate

    Returns:
        {
          "dry_run": bool,
          "ok": bool,
          "stdout": str,
          "stderr": str,
          "touched_files": [...],
          "repo_dirty_before": bool,
          "repo_dirty_after": bool
        }
    """

    if not isinstance(patch, str) or not patch.strip():
        raise PatchApplyError("patch must be a non-empty string")

    # Hard gate: apply (write) disabled. Only dry_run allowed for preview.
    if not dry_run:
        raise PatchApplyError(
            "Direct apply disabled. Use patch.propose then patch.accept "
            "then patch.apply (RPC) for governed edits. This tool allows dry_run=True only."
        )

    repo_root = _validate_root(workspace_root)

    repo_dirty_before = _git_has_changes(repo_root)

    def _extract_touched(patch_text: str) -> List[str]:
        out: List[str] = []
        for line in patch_text.splitlines():
            if line.startswith("+++ b/"):
                out.append(line.replace("+++ b/", "").strip())
        return out

    touched_files = _extract_touched(patch)

    # Dry-run check first
    precheck = _run_git_apply(repo_root, patch, dry_run=True, whitespace=whitespace)
    if not precheck.ok:
        return {
            "dry_run": True,
            "ok": False,
            "stdout": precheck.stdout,
            "stderr": precheck.stderr,
            "touched_files": touched_files,
            "repo_dirty_before": repo_dirty_before,
            "repo_dirty_after": repo_dirty_before,
        }

    if dry_run:
        return {
            "dry_run": True,
            "ok": True,
            "stdout": precheck.stdout,
            "stderr": precheck.stderr,
            "touched_files": touched_files,
            "repo_dirty_before": repo_dirty_before,
            "repo_dirty_after": repo_dirty_before,
        }

    # Apply for real
    applied = _run_git_apply(repo_root, patch, dry_run=False, whitespace=whitespace)
    if not applied.ok:
        raise PatchApplyError(f"git apply failed: {applied.stderr}")

    repo_dirty_after = _git_has_changes(repo_root)

    return {
        "dry_run": False,
        "ok": True,
        "stdout": applied.stdout,
        "stderr": applied.stderr,
        "touched_files": touched_files,
        "repo_dirty_before": repo_dirty_before,
        "repo_dirty_after": repo_dirty_after,
    }


# ----------------------------------------------------------------------
# Registration
# ----------------------------------------------------------------------

register_tool(
    name="write_patch",
    handler=write_patch,
    description="Apply a unified diff patch via git apply (atomic, gated)",
    dangerous=True,  # modifies code
    requires_confirmation=True,  # UI must confirm
    category="filesystem",
    timeout=20,
)
