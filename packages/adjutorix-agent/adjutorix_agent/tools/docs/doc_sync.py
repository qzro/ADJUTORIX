"""
doc_sync

Deterministic documentation synchronizer.

Goals:
- Zero network.
- Generate/update docs from local sources (OpenAPI spec, registry catalogs, etc.).
- Provide one entrypoint for "doc sync" used by agent tools.

This module is intentionally generic: it can be reused across repos.
It does NOT assume VATFix; it only operates on files.

Supported operations:
- Render OpenAPI JSON/YAML -> Markdown (basic endpoint table + schemas listing)
- Render "catalog" from registry manifests (profiles/recipes/etc.) -> Markdown
- Maintain a "docs index" file

All writes are atomic (write temp then replace).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None  # type: ignore


@dataclass(frozen=True)
class DocSyncConfig:
    repo_root: Path
    docs_dir: Path
    openapi_path: Optional[Path] = None
    catalogs_dir: Optional[Path] = None
    output_openapi_md: Optional[Path] = None
    output_catalog_md: Optional[Path] = None
    output_index_md: Optional[Path] = None


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(path.parent)) as tmp:
        tmp.write(text)
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def _load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _load_openapi(path: Path) -> Dict[str, Any]:
    raw = _load_text(path)
    if path.suffix.lower() in {".yaml", ".yml"}:
        if yaml is None:
            raise RuntimeError("PyYAML not installed. Install 'pyyaml' to parse YAML OpenAPI specs.")
        return yaml.safe_load(raw)  # type: ignore
    return json.loads(raw)


def _md_escape(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ").strip()


def _summarize_openapi(spec: Dict[str, Any]) -> Tuple[str, str]:
    """
    Returns: (endpoints_md, schemas_md)
    """
    info = spec.get("info", {}) or {}
    title = info.get("title", "API")
    version = info.get("version", "")

    paths: Dict[str, Any] = spec.get("paths", {}) or {}
    rows: List[str] = []
    rows.append("| Method | Path | Summary |")
    rows.append("|---|---|---|")

    for path, methods in sorted(paths.items()):
        if not isinstance(methods, dict):
            continue
        for method, op in sorted(methods.items()):
            if method.lower() not in {"get", "post", "put", "patch", "delete", "head", "options"}:
                continue
            if not isinstance(op, dict):
                continue
            summary = op.get("summary") or op.get("operationId") or ""
            rows.append(f"| {method.upper()} | `{_md_escape(path)}` | {_md_escape(str(summary))} |")

    endpoints_md = "\n".join(rows)

    # Schemas list (OpenAPI 3)
    comps = spec.get("components", {}) or {}
    schemas: Dict[str, Any] = comps.get("schemas", {}) or {}
    schema_lines: List[str] = []
    schema_lines.append(f"## Schemas ({len(schemas)})")
    if schemas:
        for name in sorted(schemas.keys()):
            schema_lines.append(f"- `{name}`")
    else:
        schema_lines.append("_No schemas found in components.schemas_")

    header = f"# {title}\n\n"
    if version:
        header += f"Version: `{version}`\n\n"
    header += "## Endpoints\n\n"
    return header + endpoints_md + "\n\n", "\n".join(schema_lines) + "\n"


def _render_catalog_from_dir(catalog_dir: Path) -> str:
    """
    Render a "catalog" markdown from JSON/YAML manifests in a directory.
    Expected file naming is flexible. We read all *.json, *.yml, *.yaml.
    """
    items: List[Dict[str, Any]] = []

    for p in sorted(catalog_dir.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in {".json", ".yml", ".yaml"}:
            continue
        try:
            if p.suffix.lower() == ".json":
                data = json.loads(_load_text(p))
            else:
                if yaml is None:
                    continue
                data = yaml.safe_load(_load_text(p))  # type: ignore
            if isinstance(data, dict):
                data["_file"] = str(p.relative_to(catalog_dir))
                items.append(data)
        except Exception:
            # deterministic: skip unreadable manifest
            continue

    lines: List[str] = []
    lines.append(f"# Catalog: {catalog_dir.name}")
    lines.append("")
    lines.append(f"Found `{len(items)}` manifest(s) in `{catalog_dir}`.")
    lines.append("")
    lines.append("| ID | Name | Version | File |")
    lines.append("|---|---|---|---|")

    for item in items:
        _id = str(item.get("id", ""))
        name = str(item.get("name", "")) or str(item.get("title", "")) or ""
        ver = str(item.get("version", "")) or str(item.get("rev", "")) or ""
        file_ = str(item.get("_file", ""))
        lines.append(f"| `{_md_escape(_id)}` | {_md_escape(name)} | `{_md_escape(ver)}` | `{_md_escape(file_)}` |")

    return "\n".join(lines) + "\n"


def build_config(
    repo_root: Union[str, Path],
    docs_dir: Union[str, Path] = "docs",
    openapi_path: Optional[Union[str, Path]] = None,
    catalogs_dir: Optional[Union[str, Path]] = None,
    output_openapi_md: Optional[Union[str, Path]] = None,
    output_catalog_md: Optional[Union[str, Path]] = None,
    output_index_md: Optional[Union[str, Path]] = None,
) -> DocSyncConfig:
    rr = Path(repo_root).resolve()
    dd = (rr / docs_dir).resolve()
    return DocSyncConfig(
        repo_root=rr,
        docs_dir=dd,
        openapi_path=(rr / openapi_path).resolve() if openapi_path else None,
        catalogs_dir=(rr / catalogs_dir).resolve() if catalogs_dir else None,
        output_openapi_md=(dd / output_openapi_md).resolve() if output_openapi_md else None,
        output_catalog_md=(dd / output_catalog_md).resolve() if output_catalog_md else None,
        output_index_md=(dd / output_index_md).resolve() if output_index_md else None,
    )


def sync_openapi_to_markdown(cfg: DocSyncConfig) -> Optional[Path]:
    if not cfg.openapi_path or not cfg.openapi_path.exists():
        return None
    out = cfg.output_openapi_md or (cfg.docs_dir / "openapi.md")
    spec = _load_openapi(cfg.openapi_path)
    endpoints_md, schemas_md = _summarize_openapi(spec)
    content = endpoints_md + schemas_md
    _atomic_write_text(out, content)
    return out


def sync_catalog_to_markdown(cfg: DocSyncConfig) -> Optional[Path]:
    if not cfg.catalogs_dir or not cfg.catalogs_dir.exists():
        return None
    out = cfg.output_catalog_md or (cfg.docs_dir / "catalog.md")
    content = _render_catalog_from_dir(cfg.catalogs_dir)
    _atomic_write_text(out, content)
    return out


def sync_docs_index(cfg: DocSyncConfig, generated_files: List[Path]) -> Path:
    out = cfg.output_index_md or (cfg.docs_dir / "INDEX.md")
    rels = [str(p.relative_to(cfg.docs_dir)) if p.is_absolute() else str(p) for p in generated_files]
    rels = sorted(set(rels))

    lines: List[str] = []
    lines.append("# Docs Index")
    lines.append("")
    lines.append("Generated files:")
    lines.append("")
    for r in rels:
        lines.append(f"- `{r}`")
    lines.append("")
    _atomic_write_text(out, "\n".join(lines))
    return out


def sync_all(
    repo_root: Union[str, Path],
    docs_dir: Union[str, Path] = "docs",
    openapi_path: Optional[Union[str, Path]] = None,
    catalogs_dir: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    """
    One-shot doc sync. Returns a deterministic report dict.
    """
    cfg = build_config(repo_root=repo_root, docs_dir=docs_dir, openapi_path=openapi_path, catalogs_dir=catalogs_dir)
    generated: List[Path] = []

    o = sync_openapi_to_markdown(cfg)
    if o:
        generated.append(o)

    c = sync_catalog_to_markdown(cfg)
    if c:
        generated.append(c)

    idx = sync_docs_index(cfg, generated_files=generated)
    generated.append(idx)

    return {
        "status": "ok",
        "generated": [str(p) for p in generated],
        "docs_dir": str(cfg.docs_dir),
        "openapi": str(cfg.openapi_path) if cfg.openapi_path else None,
        "catalogs": str(cfg.catalogs_dir) if cfg.catalogs_dir else None,
    }
