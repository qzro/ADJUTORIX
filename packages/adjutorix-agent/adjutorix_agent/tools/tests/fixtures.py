"""
fixtures

Deterministic fixtures support.

Purpose:
- Provide a standard place to store and load "golden" test fixtures for tools.
- Keep it zero-network, zero-magic.
- Support regression testing for profiles/recipes in other projects too.

This module does NOT auto-discover files outside the repo root.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union


@dataclass(frozen=True)
class FixturePaths:
    root: Path
    fixtures_dir: Path
    manifests_dir: Path


DEFAULT_FIXTURE_DIR = "fixtures"
DEFAULT_MANIFEST_DIR = "manifests"


def _sha256_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _read_bytes(path: Path) -> bytes:
    return path.read_bytes()


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _write_text(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data, encoding="utf-8")


def resolve_fixture_paths(repo_root: Union[str, Path], fixture_dir: str = DEFAULT_FIXTURE_DIR) -> FixturePaths:
    root = Path(repo_root).resolve()
    base = root / ".adjutorix" / fixture_dir
    manifests = base / DEFAULT_MANIFEST_DIR
    return FixturePaths(root=root, fixtures_dir=base / DEFAULT_FIXTURE_DIR, manifests_dir=manifests)


def fixture_path(repo_root: Union[str, Path], name: str, fixture_dir: str = DEFAULT_FIXTURE_DIR) -> Path:
    """
    Get a fixture file path for a given logical name (relative within fixtures).
    Example: name="profiles/stripe/sample.csv"
    """
    fp = resolve_fixture_paths(repo_root, fixture_dir=fixture_dir)
    return (fp.fixtures_dir / name).resolve()


def manifest_path(repo_root: Union[str, Path], name: str, fixture_dir: str = DEFAULT_FIXTURE_DIR) -> Path:
    """
    Get a manifest path for a given fixture logical name.
    Example: name="profiles/stripe/sample.csv" -> manifests/profiles/stripe/sample.csv.json
    """
    fp = resolve_fixture_paths(repo_root, fixture_dir=fixture_dir)
    return (fp.manifests_dir / f"{name}.json").resolve()


def load_fixture_bytes(repo_root: Union[str, Path], name: str, fixture_dir: str = DEFAULT_FIXTURE_DIR) -> bytes:
    path = fixture_path(repo_root, name, fixture_dir=fixture_dir)
    if not path.exists():
        raise FileNotFoundError(f"Fixture not found: {path}")
    return _read_bytes(path)


def load_fixture_text(repo_root: Union[str, Path], name: str, fixture_dir: str = DEFAULT_FIXTURE_DIR) -> str:
    path = fixture_path(repo_root, name, fixture_dir=fixture_dir)
    if not path.exists():
        raise FileNotFoundError(f"Fixture not found: {path}")
    return _read_text(path)


def load_fixture_json(repo_root: Union[str, Path], name: str, fixture_dir: str = DEFAULT_FIXTURE_DIR) -> Any:
    """
    Loads JSON fixture. Name can omit .json.
    """
    if not name.endswith(".json"):
        name = f"{name}.json"
    data = load_fixture_text(repo_root, name, fixture_dir=fixture_dir)
    return json.loads(data)


def write_fixture_bytes(
    repo_root: Union[str, Path],
    name: str,
    data: bytes,
    fixture_dir: str = DEFAULT_FIXTURE_DIR,
    write_manifest: bool = True,
    meta: Optional[Dict[str, Any]] = None,
) -> Tuple[Path, Optional[Path]]:
    """
    Writes fixture bytes and (optionally) a manifest with sha256 and metadata.
    Returns (fixture_path, manifest_path|None)
    """
    fpath = fixture_path(repo_root, name, fixture_dir=fixture_dir)
    _write_bytes(fpath, data)

    mpath: Optional[Path] = None
    if write_manifest:
        mpath = manifest_path(repo_root, name, fixture_dir=fixture_dir)
        man = {
            "name": name,
            "path": str(fpath),
            "sha256": _sha256_bytes(data),
            "bytes": len(data),
            "meta": meta or {},
        }
        _write_text(mpath, json.dumps(man, indent=2, sort_keys=True))
    return fpath, mpath


def write_fixture_text(
    repo_root: Union[str, Path],
    name: str,
    text: str,
    fixture_dir: str = DEFAULT_FIXTURE_DIR,
    write_manifest: bool = True,
    meta: Optional[Dict[str, Any]] = None,
) -> Tuple[Path, Optional[Path]]:
    data = text.encode("utf-8")
    return write_fixture_bytes(
        repo_root=repo_root,
        name=name,
        data=data,
        fixture_dir=fixture_dir,
        write_manifest=write_manifest,
        meta=meta,
    )


def write_fixture_json(
    repo_root: Union[str, Path],
    name: str,
    obj: Any,
    fixture_dir: str = DEFAULT_FIXTURE_DIR,
    write_manifest: bool = True,
    meta: Optional[Dict[str, Any]] = None,
) -> Tuple[Path, Optional[Path]]:
    if not name.endswith(".json"):
        name = f"{name}.json"
    text = json.dumps(obj, indent=2, sort_keys=True)
    return write_fixture_text(
        repo_root=repo_root,
        name=name,
        text=text,
        fixture_dir=fixture_dir,
        write_manifest=write_manifest,
        meta=meta,
    )


def verify_fixture(
    repo_root: Union[str, Path],
    name: str,
    fixture_dir: str = DEFAULT_FIXTURE_DIR,
) -> Dict[str, Any]:
    """
    Verify fixture bytes hash matches its manifest.
    Returns a dict with status + details.

    If manifest is missing, returns status="no_manifest".
    """
    fpath = fixture_path(repo_root, name, fixture_dir=fixture_dir)
    mpath = manifest_path(repo_root, name, fixture_dir=fixture_dir)

    if not fpath.exists():
        return {"status": "missing_fixture", "fixture": str(fpath), "manifest": str(mpath)}

    data = _read_bytes(fpath)
    actual = _sha256_bytes(data)

    if not mpath.exists():
        return {"status": "no_manifest", "fixture": str(fpath), "sha256": actual, "bytes": len(data)}

    man = json.loads(_read_text(mpath))
    expected = man.get("sha256")

    ok = expected == actual
    return {
        "status": "ok" if ok else "mismatch",
        "fixture": str(fpath),
        "manifest": str(mpath),
        "expected": expected,
        "actual": actual,
        "bytes": len(data),
        "meta": man.get("meta", {}),
    }


def verify_all_fixtures(repo_root: Union[str, Path], fixture_dir: str = DEFAULT_FIXTURE_DIR) -> List[Dict[str, Any]]:
    """
    Verify all fixtures present under .adjutorix/<fixture_dir>/fixtures
    """
    fp = resolve_fixture_paths(repo_root, fixture_dir=fixture_dir)
    base = fp.fixtures_dir
    results: List[Dict[str, Any]] = []

    if not base.exists():
        return [{"status": "no_fixtures_dir", "path": str(base)}]

    for path in base.rglob("*"):
        if not path.is_file():
            continue
        # name relative to fixtures_dir
        name = str(path.relative_to(base))
        results.append(verify_fixture(repo_root, name, fixture_dir=fixture_dir))

    return results
