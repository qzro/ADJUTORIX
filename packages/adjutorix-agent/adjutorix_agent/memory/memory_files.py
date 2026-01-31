from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional


AGENT_DIR_NAME = ".agent"

DEFAULT_FILES = {
    "memory": "memory.md",
    "decisions": "decisions.log",
    "constraints": "constraints.yaml",
    "map": "map.json",
}


class MemoryFileError(RuntimeError):
    pass


class MemoryFiles:
    """
    Manages reading/writing of per-repo .agent/* memory files.

    Layout:

      repo_root/
        .agent/
          memory.md
          decisions.log
          constraints.yaml
          map.json
          jobs/
    """

    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root.resolve()
        self.agent_dir = self.repo_root / AGENT_DIR_NAME

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def ensure(self) -> None:
        """Ensure .agent directory and base files exist."""
        self.agent_dir.mkdir(parents=True, exist_ok=True)

        for name, fname in DEFAULT_FILES.items():
            path = self.agent_dir / fname
            if not path.exists():
                self._init_file(name, path)

        jobs_dir = self.agent_dir / "jobs"
        jobs_dir.mkdir(exist_ok=True)

    def _init_file(self, key: str, path: Path) -> None:
        if key == "memory":
            path.write_text("# Project Memory\n\n", encoding="utf-8")

        elif key == "decisions":
            path.write_text("# Decisions Log\n\n", encoding="utf-8")

        elif key == "constraints":
            path.write_text("# Repo Constraints\n\n", encoding="utf-8")

        elif key == "map":
            path.write_text("{}", encoding="utf-8")

        else:
            path.touch()

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def memory_path(self) -> Path:
        return self.agent_dir / DEFAULT_FILES["memory"]

    def decisions_path(self) -> Path:
        return self.agent_dir / DEFAULT_FILES["decisions"]

    def constraints_path(self) -> Path:
        return self.agent_dir / DEFAULT_FILES["constraints"]

    def map_path(self) -> Path:
        return self.agent_dir / DEFAULT_FILES["map"]

    def jobs_dir(self) -> Path:
        return self.agent_dir / "jobs"

    # ------------------------------------------------------------------
    # Memory.md
    # ------------------------------------------------------------------

    def read_memory(self) -> str:
        self.ensure()
        return self.memory_path().read_text(encoding="utf-8")

    def write_memory(self, content: str) -> None:
        self.ensure()
        self.memory_path().write_text(content, encoding="utf-8")

    def append_memory(self, text: str) -> None:
        self.ensure()
        with self.memory_path().open("a", encoding="utf-8") as f:
            f.write(text.rstrip() + "\n")

    # ------------------------------------------------------------------
    # Decisions.log
    # ------------------------------------------------------------------

    def read_decisions(self) -> str:
        self.ensure()
        return self.decisions_path().read_text(encoding="utf-8")

    def append_decision(self, line: str) -> None:
        self.ensure()
        with self.decisions_path().open("a", encoding="utf-8") as f:
            f.write(line.rstrip() + "\n")

    # ------------------------------------------------------------------
    # Constraints.yaml (opaque text)
    # ------------------------------------------------------------------

    def read_constraints(self) -> str:
        self.ensure()
        return self.constraints_path().read_text(encoding="utf-8")

    def write_constraints(self, content: str) -> None:
        self.ensure()
        self.constraints_path().write_text(content, encoding="utf-8")

    # ------------------------------------------------------------------
    # Map.json
    # ------------------------------------------------------------------

    def read_map(self) -> Dict:
        self.ensure()
        path = self.map_path()

        try:
            return json.loads(path.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError as e:
            raise MemoryFileError(f"Invalid map.json: {e}") from e

    def write_map(self, data: Dict) -> None:
        self.ensure()
        self.map_path().write_text(
            json.dumps(data, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    # ------------------------------------------------------------------
    # Jobs
    # ------------------------------------------------------------------

    def create_job_dir(self, job_id: str) -> Path:
        """
        Create a job directory under .agent/jobs/.

        Example:
          .agent/jobs/2026-01-01_1200_fix-tests/
        """
        self.ensure()

        job_dir = self.jobs_dir() / job_id
        job_dir.mkdir(parents=True, exist_ok=False)
        return job_dir

    def list_jobs(self) -> List[Path]:
        self.ensure()

        if not self.jobs_dir().exists():
            return []

        return sorted(
            [p for p in self.jobs_dir().iterdir() if p.is_dir()],
            key=lambda p: p.name,
        )

    def get_job(self, job_id: str) -> Optional[Path]:
        path = self.jobs_dir() / job_id
        if path.exists() and path.is_dir():
            return path
        return None

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def snapshot(self) -> Dict[str, str]:
        """
        Return in-memory snapshot of all main memory files.
        Useful for context compaction.
        """
        self.ensure()

        return {
            "memory": self.read_memory(),
            "decisions": self.read_decisions(),
            "constraints": self.read_constraints(),
            "map": json.dumps(self.read_map(), indent=2),
        }
