"""
protected_files

Guards modifications to sensitive files. Used by:
- patch_gate (before apply)
- write_file / write_patch tools (before write)
- UI approvals (extra confirmation)

Protection is glob-based and repo-root relative.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

from adjutorix_agent.governance.policy import Policy


def _normalize_repo_rel(repo_root: Path, p: Path) -> str:
    try:
        rel = p.resolve().relative_to(repo_root.resolve())
    except Exception:
        # If file is outside repo root, treat as protected by default.
        return "__OUTSIDE_REPO__"
    return rel.as_posix()


@dataclass(frozen=True)
class ProtectionHit:
    path: str
    pattern: str
    reason: str


class ProtectedFiles:
    def __init__(self, policy: Policy) -> None:
        self.repo_root = Path(policy.repo_root).resolve()
        self.patterns: Tuple[str, ...] = tuple(policy.protected_globs)

    def is_protected(self, file_path: str) -> bool:
        p = (self.repo_root / file_path) if not Path(file_path).is_absolute() else Path(file_path)
        rel = _normalize_repo_rel(self.repo_root, p)
        if rel == "__OUTSIDE_REPO__":
            return True
        for pat in self.patterns:
            if Path(rel).match(pat):
                return True
        return False

    def check_paths(self, file_paths: Sequence[str]) -> List[ProtectionHit]:
        hits: List[ProtectionHit] = []
        for fp in file_paths:
            p = (self.repo_root / fp) if not Path(fp).is_absolute() else Path(fp)
            rel = _normalize_repo_rel(self.repo_root, p)
            if rel == "__OUTSIDE_REPO__":
                hits.append(
                    ProtectionHit(
                        path=str(p),
                        pattern="(outside repo)",
                        reason="Path resolves outside repo root",
                    )
                )
                continue
            for pat in self.patterns:
                if Path(rel).match(pat):
                    hits.append(
                        ProtectionHit(
                            path=rel,
                            pattern=pat,
                            reason="Matches protected_globs",
                        )
                    )
                    break
        return hits

    def require_override(self, file_paths: Sequence[str]) -> None:
        hits = self.check_paths(file_paths)
        if not hits:
            return
        msg_lines = ["Protected files modification blocked. Override required.", ""]
        for h in hits:
            msg_lines.append(f"- {h.path}  (pattern: {h.pattern})  reason: {h.reason}")
        raise PermissionError("\n".join(msg_lines))
