"""
codeintel.find_symbol

Fast symbol lookup using the local index produced by tools.codeintel.indexer.

Reads:
- .agent/index/symbols.jsonl

Returns ranked matches for:
- exact match (case-sensitive)
- exact match (case-insensitive)
- prefix match
- substring match

This is deterministic and offline.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class SymbolHit:
    name: str
    kind: Optional[str]
    path: str
    line: int
    language: Optional[str] = None
    scope: Optional[str] = None
    signature: Optional[str] = None
    score: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "path": self.path,
            "line": self.line,
            "language": self.language,
            "scope": self.scope,
            "signature": self.signature,
            "score": self.score,
        }


def _symbols_path(workspace_root: str) -> Path:
    root = Path(workspace_root).resolve()
    return root / ".agent" / "index" / "symbols.jsonl"


def _iter_symbols(symbols_jsonl: Path) -> Iterable[Dict[str, Any]]:
    if not symbols_jsonl.exists():
        return []
    def _gen():
        with symbols_jsonl.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    return _gen()


def _score(name: str, q: str) -> int:
    if name == q:
        return 100
    if name.lower() == q.lower():
        return 90
    if name.startswith(q):
        return 70
    if name.lower().startswith(q.lower()):
        return 65
    if q in name:
        return 50
    if q.lower() in name.lower():
        return 45
    return 0


def find_symbol(
    *,
    workspace_root: str,
    query: str,
    limit: int = 25,
    kinds: Optional[List[str]] = None,
    languages: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Find symbols in the workspace index.

    Args:
        workspace_root: path to repo root.
        query: symbol name or partial name.
        limit: max results.
        kinds: optional filter, e.g. ["function","class"].
        languages: optional filter, e.g. ["Python","JavaScript"] or ["python","javascript"].

    Returns:
        {"ok": bool, "results": [..], "count": int, "index_found": bool}
    """
    q = (query or "").strip()
    if not q:
        return {"ok": False, "error": "empty_query", "results": [], "count": 0, "index_found": False}

    symbols_jsonl = _symbols_path(workspace_root)
    if not symbols_jsonl.exists():
        return {"ok": False, "error": "index_missing", "results": [], "count": 0, "index_found": False}

    kind_set = set([k.strip() for k in kinds]) if kinds else None
    lang_set = set([l.strip().lower() for l in languages]) if languages else None

    hits: List[SymbolHit] = []
    for obj in _iter_symbols(symbols_jsonl):
        name = obj.get("name")
        if not name:
            continue

        s = _score(name, q)
        if s <= 0:
            continue

        kind = obj.get("kind")
        if kind_set is not None and kind not in kind_set:
            continue

        language = obj.get("language")
        if lang_set is not None:
            if (language or "").lower() not in lang_set:
                continue

        try:
            line = int(obj.get("line", 0))
        except Exception:
            line = 0
        if line <= 0:
            continue

        hits.append(
            SymbolHit(
                name=name,
                kind=kind,
                path=obj.get("path", ""),
                line=line,
                language=language,
                scope=obj.get("scope"),
                signature=obj.get("signature"),
                score=s,
            )
        )

    hits.sort(key=lambda h: (-h.score, h.name.lower(), h.path, h.line))
    hits = hits[: max(1, int(limit))]

    return {
        "ok": True,
        "index_found": True,
        "count": len(hits),
        "results": [h.to_dict() for h in hits],
    }
