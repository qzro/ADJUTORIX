from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


class KnowledgeBaseError(RuntimeError):
    pass


def _default_home_dir() -> Path:
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE")
    if not home:
        raise KnowledgeBaseError("Cannot resolve user home directory (HOME/USERPROFILE missing).")
    return Path(home).expanduser().resolve()


class KnowledgeBase:
    """
    Cross-repo knowledge store under ~/.agent/knowledge/.

    Purpose:
      - shared conventions across repos
      - reusable snippets
      - known gotchas per repo
      - "facts" that survive sessions

    Storage:
      ~/.agent/
        global.yaml              (optional; handled elsewhere)
        knowledge/
          README.md
          shared/
            snippets.json
            conventions.md
          repos/
            VATFix/
              notes.md
              gotchas.md
              tags.json
            SPEEDKIT/
              ...
    """

    def __init__(self, base_dir: Optional[Path] = None) -> None:
        self.base_dir = (base_dir or (_default_home_dir() / ".agent")).resolve()
        self.knowledge_dir = self.base_dir / "knowledge"
        self.shared_dir = self.knowledge_dir / "shared"
        self.repos_dir = self.knowledge_dir / "repos"

        self._ensure_dirs()

    # ------------------------------------------------------------------
    # Init
    # ------------------------------------------------------------------

    def _ensure_dirs(self) -> None:
        self.knowledge_dir.mkdir(parents=True, exist_ok=True)
        self.shared_dir.mkdir(parents=True, exist_ok=True)
        self.repos_dir.mkdir(parents=True, exist_ok=True)

        readme = self.knowledge_dir / "README.md"
        if not readme.exists():
            readme.write_text(
                "# Adjutorix Knowledge Base\n\n"
                "This directory stores durable, cross-repo knowledge.\n"
                "It is safe to keep under your home directory.\n\n"
                "Structure:\n"
                "- shared/: cross-repo snippets and conventions\n"
                "- repos/: per-repo notes and gotchas\n",
                encoding="utf-8",
            )

        # seed shared files
        conventions = self.shared_dir / "conventions.md"
        if not conventions.exists():
            conventions.write_text("# Conventions\n\n", encoding="utf-8")

        snippets = self.shared_dir / "snippets.json"
        if not snippets.exists():
            snippets.write_text(json.dumps({"snippets": []}, indent=2), encoding="utf-8")

    # ------------------------------------------------------------------
    # Shared conventions
    # ------------------------------------------------------------------

    def read_shared_conventions(self) -> str:
        path = self.shared_dir / "conventions.md"
        return path.read_text(encoding="utf-8")

    def append_shared_convention(self, line: str) -> None:
        path = self.shared_dir / "conventions.md"
        with path.open("a", encoding="utf-8") as f:
            f.write(line.rstrip() + "\n")

    # ------------------------------------------------------------------
    # Shared snippets
    # ------------------------------------------------------------------

    def list_snippets(self) -> List[Dict[str, Any]]:
        path = self.shared_dir / "snippets.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError as e:
            raise KnowledgeBaseError(f"Invalid snippets.json: {e}") from e

        snippets = data.get("snippets")
        if not isinstance(snippets, list):
            return []
        return snippets

    def add_snippet(self, name: str, language: str, content: str, tags: Optional[List[str]] = None) -> None:
        """
        Store a reusable snippet.

        Snippet schema:
          { name, language, tags:[], content }
        """
        path = self.shared_dir / "snippets.json"
        data = {"snippets": self.list_snippets()}

        entry = {
            "name": name,
            "language": language,
            "tags": tags or [],
            "content": content,
        }

        # de-dup by name+language
        out: List[Dict[str, Any]] = []
        replaced = False
        for s in data["snippets"]:
            if s.get("name") == name and s.get("language") == language:
                out.append(entry)
                replaced = True
            else:
                out.append(s)
        if not replaced:
            out.append(entry)

        path.write_text(json.dumps({"snippets": out}, indent=2, sort_keys=True), encoding="utf-8")

    # ------------------------------------------------------------------
    # Per-repo knowledge
    # ------------------------------------------------------------------

    def repo_dir(self, repo_name: str) -> Path:
        safe = self._sanitize(repo_name)
        d = self.repos_dir / safe
        d.mkdir(parents=True, exist_ok=True)
        return d

    def read_repo_notes(self, repo_name: str) -> str:
        d = self.repo_dir(repo_name)
        p = d / "notes.md"
        if not p.exists():
            p.write_text("# Notes\n\n", encoding="utf-8")
        return p.read_text(encoding="utf-8")

    def append_repo_note(self, repo_name: str, line: str) -> None:
        d = self.repo_dir(repo_name)
        p = d / "notes.md"
        if not p.exists():
            p.write_text("# Notes\n\n", encoding="utf-8")
        with p.open("a", encoding="utf-8") as f:
            f.write(line.rstrip() + "\n")

    def read_repo_gotchas(self, repo_name: str) -> str:
        d = self.repo_dir(repo_name)
        p = d / "gotchas.md"
        if not p.exists():
            p.write_text("# Gotchas\n\n", encoding="utf-8")
        return p.read_text(encoding="utf-8")

    def append_repo_gotcha(self, repo_name: str, line: str) -> None:
        d = self.repo_dir(repo_name)
        p = d / "gotchas.md"
        if not p.exists():
            p.write_text("# Gotchas\n\n", encoding="utf-8")
        with p.open("a", encoding="utf-8") as f:
            f.write(line.rstrip() + "\n")

    def read_repo_tags(self, repo_name: str) -> Dict[str, Any]:
        d = self.repo_dir(repo_name)
        p = d / "tags.json"
        if not p.exists():
            p.write_text(json.dumps({"tags": []}, indent=2), encoding="utf-8")

        try:
            return json.loads(p.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError as e:
            raise KnowledgeBaseError(f"Invalid tags.json for repo {repo_name}: {e}") from e

    def add_repo_tag(self, repo_name: str, tag: str) -> None:
        d = self.repo_dir(repo_name)
        p = d / "tags.json"
        data = self.read_repo_tags(repo_name)
        tags = data.get("tags") if isinstance(data.get("tags"), list) else []
        if tag not in tags:
            tags.append(tag)
        p.write_text(json.dumps({"tags": sorted(tags)}, indent=2), encoding="utf-8")

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _sanitize(name: str) -> str:
        return "".join(ch for ch in name if ch.isalnum() or ch in ("-", "_", ".")).strip("._") or "repo"

    def snapshot(self, repo_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Snapshot of knowledge base content for compaction/routing.

        If repo_name is provided, include repo notes/gotchas/tags.
        """
        snap: Dict[str, Any] = {
            "shared": {
                "conventions": self.read_shared_conventions(),
                "snippets": self.list_snippets(),
            }
        }
        if repo_name:
            snap["repo"] = {
                "name": repo_name,
                "notes": self.read_repo_notes(repo_name),
                "gotchas": self.read_repo_gotchas(repo_name),
                "tags": self.read_repo_tags(repo_name),
            }
        return snap
