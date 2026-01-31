"""
release_artifacts

Builds and stores deterministic release artifacts after deploy.

Purpose:
- Capture deploy outputs
- Store hashes
- Map git SHA -> deployment
- Provide rollback/audit trace
- Zero external dependencies

Artifacts are written to:
  .agent/releases/<timestamp>_<short_sha>/

Structure:
  - deploy.log
  - git.json
  - hashes.json
  - metadata.json
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class ReleaseArtifacts:
    release_id: str
    path: Path
    git_sha: str
    created_at: float


def _run_git(cmd: List[str], cwd: str) -> str:
    proc = subprocess.run(
        ["git"] + cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip())
    return proc.stdout.strip()


def _get_git_sha(repo_root: str) -> str:
    return _run_git(["rev-parse", "HEAD"], repo_root)


def _get_git_status(repo_root: str) -> str:
    return _run_git(["status", "--porcelain"], repo_root)


def _short_sha(sha: str) -> str:
    return sha[:8]


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _hash_dir(root: Path) -> Dict[str, str]:
    hashes: Dict[str, str] = {}

    for file in root.rglob("*"):
        if not file.is_file():
            continue
        rel = file.relative_to(root)
        hashes[str(rel)] = _hash_file(file)

    return hashes


def _release_root(repo_root: str) -> Path:
    return Path(repo_root) / ".agent" / "releases"


def create_release(
    *,
    repo_root: str,
    deploy_stdout: str,
    deploy_stderr: str,
    artifact_dirs: Optional[List[str]] = None,
) -> ReleaseArtifacts:
    """
    Create a release artifact bundle.

    Args:
        repo_root: workspace root
        deploy_stdout: stdout from deploy command
        deploy_stderr: stderr from deploy command
        artifact_dirs: directories to hash (e.g. dist/, build/)

    Returns:
        ReleaseArtifacts
    """

    root = Path(repo_root).resolve()
    releases = _release_root(repo_root)
    releases.mkdir(parents=True, exist_ok=True)

    sha = _get_git_sha(repo_root)
    short = _short_sha(sha)
    ts = int(time.time())

    release_id = f"{ts}_{short}"
    path = releases / release_id
    path.mkdir(parents=True)

    # --- Write deploy log ---
    deploy_log = path / "deploy.log"
    deploy_log.write_text(
        "=== STDOUT ===\n"
        + deploy_stdout
        + "\n\n=== STDERR ===\n"
        + deploy_stderr
    )

    # --- Git metadata ---
    git_meta = {
        "sha": sha,
        "short_sha": short,
        "dirty": bool(_get_git_status(repo_root)),
        "created_at": ts,
    }

    (path / "git.json").write_text(json.dumps(git_meta, indent=2))

    # --- Artifact hashes ---
    hashes: Dict[str, Dict[str, str]] = {}

    if artifact_dirs:
        for d in artifact_dirs:
            p = root / d
            if p.exists() and p.is_dir():
                hashes[d] = _hash_dir(p)

    (path / "hashes.json").write_text(json.dumps(hashes, indent=2))

    # --- Metadata ---
    metadata = {
        "id": release_id,
        "repo": str(root),
        "timestamp": ts,
        "git": git_meta,
        "artifacts": list(hashes.keys()),
    }

    (path / "metadata.json").write_text(json.dumps(metadata, indent=2))

    return ReleaseArtifacts(
        release_id=release_id,
        path=path,
        git_sha=sha,
        created_at=ts,
    )


def list_releases(repo_root: str) -> List[ReleaseArtifacts]:
    """
    List all stored releases.
    """
    root = _release_root(repo_root)

    if not root.exists():
        return []

    releases: List[ReleaseArtifacts] = []

    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue

        meta_file = d / "metadata.json"
        if not meta_file.exists():
            continue

        meta = json.loads(meta_file.read_text())

        releases.append(
            ReleaseArtifacts(
                release_id=meta["id"],
                path=d,
                git_sha=meta["git"]["sha"],
                created_at=meta["timestamp"],
            )
        )

    return releases


def get_release(
    repo_root: str, release_id: str
) -> Optional[ReleaseArtifacts]:
    """
    Get a specific release bundle.
    """
    root = _release_root(repo_root)
    path = root / release_id

    if not path.exists():
        return None

    meta_file = path / "metadata.json"
    if not meta_file.exists():
        return None

    meta = json.loads(meta_file.read_text())

    return ReleaseArtifacts(
        release_id=meta["id"],
        path=path,
        git_sha=meta["git"]["sha"],
        created_at=meta["timestamp"],
    )


def delete_release(repo_root: str, release_id: str) -> bool:
    """
    Remove a release bundle (manual cleanup only).
    """
    root = _release_root(repo_root)
    path = root / release_id

    if not path.exists():
        return False

    for item in path.rglob("*"):
        if item.is_file():
            item.unlink()

    for item in reversed(list(path.rglob("*"))):
        if item.is_dir():
            item.rmdir()

    path.rmdir()
    return True
