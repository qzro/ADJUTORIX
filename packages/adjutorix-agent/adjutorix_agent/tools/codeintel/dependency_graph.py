"""
codeintel.dependency_graph

Builds and queries a lightweight dependency graph based on imports/requires.

Sources:
- Python: import / from-import parsing (ast)
- JS/TS: require/import parsing (regex + esprima fallback if available)

Outputs:
- .agent/index/deps.json

Provides:
- direct_deps(file)
- reverse_deps(file)
- impacted_files(changed_files)
"""

from __future__ import annotations

import ast
import json
import os
import re
from pathlib import Path
from typing import Dict, List, Set, Iterable, Optional


INDEX_DIR = ".agent/index"
DEPS_FILE = "deps.json"


JS_IMPORT_RE = re.compile(
    r"""(?:import\s+.*?\s+from\s+['"](.+?)['"]|require\(\s*['"](.+?)['"]\s*\))"""
)


# -------------------------
# Index Paths
# -------------------------


def _index_dir(root: str) -> Path:
    return Path(root).resolve() / INDEX_DIR


def _deps_path(root: str) -> Path:
    return _index_dir(root) / DEPS_FILE


# -------------------------
# File Discovery
# -------------------------


def _iter_source_files(root: Path) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        if ".agent" in dirnames:
            dirnames.remove(".agent")
        if "node_modules" in dirnames:
            dirnames.remove("node_modules")
        if ".venv" in dirnames:
            dirnames.remove(".venv")

        for f in filenames:
            if f.endswith((".py", ".js", ".ts", ".tsx")):
                yield Path(dirpath) / f


# -------------------------
# Python Parsing
# -------------------------


def _parse_python_imports(path: Path) -> Set[str]:
    deps: Set[str] = set()

    try:
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
    except Exception:
        return deps

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for n in node.names:
                deps.add(n.name.split(".")[0])

        elif isinstance(node, ast.ImportFrom):
            if node.module:
                deps.add(node.module.split(".")[0])

    return deps


# -------------------------
# JS/TS Parsing
# -------------------------


def _parse_js_imports(path: Path) -> Set[str]:
    deps: Set[str] = set()

    try:
        src = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return deps

    for m in JS_IMPORT_RE.finditer(src):
        mod = m.group(1) or m.group(2)
        if mod:
            deps.add(mod)

    return deps


# -------------------------
# Resolution Helpers
# -------------------------


def _normalize_module(mod: str, base: Path) -> Optional[str]:
    """
    Resolve relative imports to file paths.
    """
    if mod.startswith("."):
        p = (base.parent / mod).resolve()

        for ext in (".py", ".js", ".ts", ".tsx"):
            if p.with_suffix(ext).exists():
                return str(p.with_suffix(ext))

        if p.is_dir():
            for name in ("index.py", "index.js", "index.ts"):
                q = p / name
                if q.exists():
                    return str(q)

        return None

    return mod  # external module


# -------------------------
# Graph Builder
# -------------------------


def build_dependency_graph(workspace_root: str) -> Dict[str, List[str]]:
    """
    Build dependency graph and persist it.
    """
    root = Path(workspace_root).resolve()
    graph: Dict[str, List[str]] = {}

    for file in _iter_source_files(root):
        rel = str(file.relative_to(root))
        deps: Set[str] = set()

        if file.suffix == ".py":
            mods = _parse_python_imports(file)
        else:
            mods = _parse_js_imports(file)

        for m in mods:
            r = _normalize_module(m, file)
            if r and r.startswith(str(root)):
                deps.add(str(Path(r).relative_to(root)))
            else:
                deps.add(m)

        graph[rel] = sorted(deps)

    idx = _index_dir(workspace_root)
    idx.mkdir(parents=True, exist_ok=True)

    with _deps_path(workspace_root).open("w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2, sort_keys=True)

    return graph


# -------------------------
# Load Graph
# -------------------------


def _load_graph(root: str) -> Dict[str, List[str]]:
    p = _deps_path(root)
    if not p.exists():
        return {}

    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


# -------------------------
# Query API
# -------------------------


def direct_deps(workspace_root: str, file: str) -> List[str]:
    """
    Direct dependencies of file.
    """
    g = _load_graph(workspace_root)
    return list(g.get(file, []))


def reverse_deps(workspace_root: str, file: str) -> List[str]:
    """
    Files that depend on given file.
    """
    g = _load_graph(workspace_root)
    out: List[str] = []

    for src, deps in g.items():
        if file in deps:
            out.append(src)

    return out


def impacted_files(
    workspace_root: str,
    changed_files: List[str],
    max_depth: int = 5,
) -> List[str]:
    """
    Compute transitive impact set.
    """
    g = _load_graph(workspace_root)

    impacted: Set[str] = set(changed_files)
    frontier: Set[str] = set(changed_files)

    depth = 0

    while frontier and depth < max_depth:
        next_frontier: Set[str] = set()

        for src, deps in g.items():
            if src in impacted:
                continue

            for d in deps:
                if d in frontier:
                    next_frontier.add(src)
                    break

        impacted |= next_frontier
        frontier = next_frontier
        depth += 1

    return sorted(impacted)


# -------------------------
# Tool Entry
# -------------------------


def dependency_graph(
    *,
    workspace_root: str,
    rebuild: bool = False,
) -> Dict[str, object]:
    """
    Tool entrypoint.

    Args:
        workspace_root: repo root
        rebuild: force rebuild

    Returns:
        {ok, nodes, edges}
    """
    root = Path(workspace_root).resolve()

    if rebuild or not _deps_path(workspace_root).exists():
        g = build_dependency_graph(workspace_root)
    else:
        g = _load_graph(workspace_root)

    edges = sum(len(v) for v in g.values())

    return {
        "ok": True,
        "nodes": len(g),
        "edges": edges,
        "graph_path": str(_deps_path(workspace_root)),
    }
