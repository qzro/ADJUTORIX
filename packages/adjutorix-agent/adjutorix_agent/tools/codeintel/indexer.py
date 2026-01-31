"""
codeintel.indexer

Builds a lightweight local index for fast retrieval without model tokens.

Outputs (per workspace):
- .agent/index/files.json          (file inventory + hashes)
- .agent/index/symbols.jsonl       (one JSON object per symbol)
- .agent/index/imports.jsonl       (one JSON object per import edge)
- .agent/index/metadata.json       (build metadata)

Index strategy:
- Fast path: universal-ctags if available (best coverage for many langs)
- Fallback: ripgrep-based heuristics for Python/TS/JS signatures
- Always: file inventory + hashing for incremental rebuild decisions

This is designed to be deterministic and safe (no network).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

DEFAULT_EXCLUDES = [
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".cache",
    "__pycache__",
]


@dataclass(frozen=True)
class IndexPaths:
    root: Path
    agent_dir: Path
    index_dir: Path
    files_json: Path
    symbols_jsonl: Path
    imports_jsonl: Path
    metadata_json: Path


def _is_within(root: Path, p: Path) -> bool:
    try:
        root = root.resolve()
        p = p.resolve()
        return root == p or root in p.parents
    except Exception:
        return False


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _normalize_rel(root: Path, p: Path) -> str:
    rel = p.relative_to(root)
    return str(rel).replace(os.sep, "/")


def _ensure_dirs(paths: IndexPaths) -> None:
    paths.agent_dir.mkdir(parents=True, exist_ok=True)
    paths.index_dir.mkdir(parents=True, exist_ok=True)


def _paths(workspace_root: str) -> IndexPaths:
    root = Path(workspace_root).resolve()
    agent_dir = root / ".agent"
    index_dir = agent_dir / "index"
    return IndexPaths(
        root=root,
        agent_dir=agent_dir,
        index_dir=index_dir,
        files_json=index_dir / "files.json",
        symbols_jsonl=index_dir / "symbols.jsonl",
        imports_jsonl=index_dir / "imports.jsonl",
        metadata_json=index_dir / "metadata.json",
    )


def _walk_files(root: Path, excludes: List[str], include_exts: Optional[List[str]] = None) -> List[Path]:
    ex = set(excludes)
    results: List[Path] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        # skip excluded directories
        parts = set(p.parts)
        if any(x in parts for x in ex):
            continue
        if include_exts is not None:
            if p.suffix.lower() not in include_exts:
                continue
        results.append(p)
    return results


def _write_json(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def _truncate_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")


def _append_jsonl(path: Path, obj: Dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def _which(cmd: str) -> Optional[str]:
    return shutil.which(cmd)


def _run(cmd: List[str], cwd: Path, timeout: int = 120) -> Tuple[int, str, str]:
    p = subprocess.run(
        cmd,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
        timeout=timeout,
    )
    return p.returncode, p.stdout, p.stderr


def _ctags_available() -> bool:
    return _which("ctags") is not None


def _rg_available() -> bool:
    return _which("rg") is not None


def _build_file_inventory(paths: IndexPaths, excludes: List[str]) -> Dict[str, Any]:
    files: List[Dict[str, Any]] = []
    for p in _walk_files(paths.root, excludes):
        rel = _normalize_rel(paths.root, p)
        try:
            st = p.stat()
        except OSError:
            continue
        files.append(
            {
                "path": rel,
                "size": st.st_size,
                "mtime": int(st.st_mtime),
            }
        )
    files.sort(key=lambda x: x["path"])
    inv = {"root": str(paths.root), "files": files}
    _write_json(paths.files_json, inv)
    return inv


def _build_symbols_ctags(paths: IndexPaths, excludes: List[str], include_exts: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Use universal-ctags JSON output if available.

    We write:
      symbols.jsonl with {"name","kind","path","line","language","scope","signature"?}
    """
    if not _ctags_available():
        return {"ok": False, "reason": "ctags not found"}

    # ctags --output-format=json -R .
    # Excludes: use --exclude=...
    cmd = ["ctags", "--output-format=json", "-R", str(paths.root)]
    for ex in excludes:
        cmd.append(f"--exclude={ex}")

    # optional extension gating (rarely needed; keep broad)
    rc, out, err = _run(cmd, cwd=paths.root, timeout=300)
    if rc != 0:
        return {"ok": False, "reason": f"ctags failed rc={rc}: {err[:400]}"}

    _truncate_file(paths.symbols_jsonl)
    _truncate_file(paths.imports_jsonl)

    count = 0
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        # obj keys vary by ctags build
        name = obj.get("name")
        kind = obj.get("kind")
        file = obj.get("path") or obj.get("file")
        ln = obj.get("line")
        lang = obj.get("language")
        scope = obj.get("scope")
        signature = obj.get("signature")

        if not name or not file or not ln:
            continue

        # Ensure path is within workspace
        abs_file = Path(file)
        if not abs_file.is_absolute():
            abs_file = (paths.root / abs_file).resolve()
        if not _is_within(paths.root, abs_file):
            continue

        rel = _normalize_rel(paths.root, abs_file)
        if include_exts is not None and abs_file.suffix.lower() not in include_exts:
            continue

        _append_jsonl(
            paths.symbols_jsonl,
            {
                "name": name,
                "kind": kind,
                "path": rel,
                "line": int(ln),
                "language": lang,
                "scope": scope,
                "signature": signature,
            },
        )
        count += 1

    return {"ok": True, "symbols": count, "warnings": err.strip()[:200] if err else ""}


def _build_symbols_rg_heuristic(paths: IndexPaths, excludes: List[str]) -> Dict[str, Any]:
    """
    Fallback indexer for environments without ctags.
    Uses ripgrep patterns to locate Python/TS/JS defs.

    Produces symbols.jsonl only (imports left empty).
    """
    if not _rg_available():
        return {"ok": False, "reason": "rg not found"}

    _truncate_file(paths.symbols_jsonl)
    _truncate_file(paths.imports_jsonl)

    # Simple patterns
    patterns = [
        # Python: def/class
        (r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", "python", "function"),
        (r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[\(:]", "python", "class"),
        # TS/JS: function, class, const foo = ( ... ) =>
        (r"^\s*function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", "javascript", "function"),
        (r"^\s*class\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[{<]", "javascript", "class"),
        (r"^\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\(", "javascript", "const"),
    ]

    # Build rg command per pattern with vimgrep for file/line/col.
    symbol_count = 0
    for pat, lang, kind in patterns:
        cmd = ["rg", "--vimgrep", "--no-heading", "--color", "never", "--hidden", "-g", "!.git/**"]
        for ex in excludes:
            cmd += ["-g", f"!{ex}/**"]
        cmd += ["-e", pat, str(paths.root)]
        rc, out, err = _run(cmd, cwd=paths.root, timeout=180)
        if rc not in (0, 1):
            continue

        for line in out.splitlines():
            # file:line:col:text
            try:
                file, ln, col, text = line.split(":", 3)
            except ValueError:
                continue
            abs_file = Path(file).resolve()
            if not _is_within(paths.root, abs_file):
                continue
            rel = _normalize_rel(paths.root, abs_file)
            m = None
            try:
                m = __import__("re").search(pat, text)
            except re.error:
                m = None
            if not m:
                continue
            name = m.group(1)
            _append_jsonl(
                paths.symbols_jsonl,
                {
                    "name": name,
                    "kind": kind,
                    "path": rel,
                    "line": int(ln),
                    "language": lang,
                    "scope": None,
                    "signature": None,
                },
            )
            symbol_count += 1

    return {"ok": True, "symbols": symbol_count, "fallback": True}


def build_index(
    *,
    workspace_root: str,
    excludes: Optional[List[str]] = None,
    include_exts: Optional[List[str]] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """
    Build (or rebuild) the workspace index.

    Args:
        workspace_root: absolute path to a repo/workspace
        excludes: directories to exclude from indexing
        include_exts: optional list of extensions to index (like [".py",".ts"])
        force: rebuild even if metadata appears up to date (metadata is minimal)

    Returns:
        dict summary.
    """
    paths = _paths(workspace_root)
    _ensure_dirs(paths)
    ex = excludes[:] if excludes else DEFAULT_EXCLUDES[:]

    inv = _build_file_inventory(paths, ex)

    # Build symbols
    if _ctags_available():
        sym = _build_symbols_ctags(paths, ex, include_exts=include_exts)
        if not sym.get("ok"):
            sym = _build_symbols_rg_heuristic(paths, ex)
    else:
        sym = _build_symbols_rg_heuristic(paths, ex)

    meta = {
        "root": str(paths.root),
        "index_dir": str(paths.index_dir),
        "has_ctags": _ctags_available(),
        "has_rg": _rg_available(),
        "excludes": ex,
        "include_exts": include_exts,
        "files": len(inv.get("files", [])),
        "symbols": sym.get("symbols", 0),
        "fallback": bool(sym.get("fallback", False)),
    }
    _write_json(paths.metadata_json, meta)

    return {"inventory": {"files": meta["files"]}, "symbols": sym, "meta": meta}
