"""
Safe action runner: deterministic allowlist, no git, no implicit exec.
Actions = pure config + allowlist executor.
"""

from __future__ import annotations

import os
import json
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List


class PolicyError(RuntimeError):
    pass


DEFAULT_ALLOWED = {
    "npm test",
    "npm run lint -- --fix",
    "echo \"deploy not configured\"",
}


def load_actions(repo_root: str) -> Dict[str, Any]:
    p = Path(repo_root) / ".adjutorix" / "actions.json"
    if not p.exists():
        raise PolicyError(f"Missing actions config: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def run_action(
    repo_root: str,
    action: str,
    *,
    require_confirm: bool = False,
) -> Dict[str, Any]:
    if os.getenv("ADJUTORIX_ACTIONS_DISABLED", "0") == "1":
        raise PolicyError("Actions are disabled (chat-only mode).")

    cfg = load_actions(repo_root)
    if action not in cfg:
        raise PolicyError(f"Unknown action: {action}")

    spec = cfg[action]
    cmds: List[str] = list(spec.get("commands") or [])
    if not cmds:
        raise PolicyError(f"No commands configured for action '{action}'")

    if spec.get("requireConfirm") and not require_confirm:
        return {
            "status": "blocked",
            "message": f"Action '{action}' requires confirmation",
            "results": [],
            "duration": 0.0,
        }

    allow = set(DEFAULT_ALLOWED)
    results: List[Dict[str, Any]] = []
    start = time.time()

    for cmd in cmds:
        if cmd not in allow:
            raise PolicyError(f"Blocked command: {cmd}")

        p = subprocess.run(
            cmd,
            cwd=repo_root,
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
