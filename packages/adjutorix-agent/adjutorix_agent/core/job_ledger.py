import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


class JobLedgerError(Exception):
    pass


class JobLedger:
    """
    Persistent audit log for every agent job.

    Each job is stored as:

    .agent/jobs/YYYY-MM-DD_HHMM_<slug>/
        plan.md
        diff.patch
        commands.log
        results.log
        summary.md
        meta.json
    """

    def __init__(self, agent_root: Path, repo_root: Path) -> None:
        self.agent_root = agent_root
        self.repo_root = repo_root
        self.jobs_dir = self._ensure_jobs_dir()

    # -------------------------
    # Job Lifecycle
    # -------------------------

    def create_job(self, slug: str) -> Path:
        """
        Create a new job directory.
        """

        ts = datetime.utcnow().strftime("%Y-%m-%d_%H%M")
        name = f"{ts}_{self._sanitize(slug)}"

        job_path = self.jobs_dir / name

        if job_path.exists():
            raise JobLedgerError(f"Job already exists: {job_path}")

        job_path.mkdir(parents=True)

        self._init_files(job_path)
        self._write_meta(job_path, {"slug": slug})

        return job_path

    def write_plan(self, job: Path, content: str) -> None:
        self._write(job / "plan.md", content)

    def write_diff(self, job: Path, patch: str) -> None:
        self._write(job / "diff.patch", patch)

    def append_command(self, job: Path, command: str) -> None:
        self._append(job / "commands.log", command)

    def append_result(self, job: Path, result: str) -> None:
        self._append(job / "results.log", result)

    def write_summary(self, job: Path, content: str) -> None:
        self._write(job / "summary.md", content)

    def update_meta(self, job: Path, data: Dict[str, Any]) -> None:
        meta = self._read_meta(job)
        meta.update(data)
        self._write_meta(job, meta)

    # -------------------------
    # Query / Maintenance
    # -------------------------

    def list_jobs(self) -> Dict[str, Path]:
        """
        Return mapping: job_name -> path
        """

        jobs: Dict[str, Path] = {}

        if not self.jobs_dir.exists():
            return jobs

        for d in self.jobs_dir.iterdir():
            if d.is_dir():
                jobs[d.name] = d

        return jobs

    def load_job(self, name: str) -> Path:
        job = self.jobs_dir / name

        if not job.exists():
            raise JobLedgerError(f"Job not found: {name}")

        return job

    def delete_job(self, name: str) -> None:
        job = self.load_job(name)
        shutil.rmtree(job)

    # -------------------------
    # Internals
    # -------------------------

    def _ensure_jobs_dir(self) -> Path:
        base = self.repo_root / ".agent" / "jobs"
        base.mkdir(parents=True, exist_ok=True)
        return base

    def _init_files(self, job: Path) -> None:
        files = [
            "plan.md",
            "diff.patch",
            "commands.log",
            "results.log",
            "summary.md",
            "meta.json",
        ]

        for name in files:
            (job / name).touch()

    def _sanitize(self, value: str) -> str:
        return "".join(
            c if c.isalnum() or c in "-_" else "_"
            for c in value.lower()
        )

    def _write(self, path: Path, content: str) -> None:
        path.write_text(content, encoding="utf-8")

    def _append(self, path: Path, content: str) -> None:
        with path.open("a", encoding="utf-8") as f:
            f.write(content.rstrip() + "\n")

    def _read_meta(self, job: Path) -> Dict[str, Any]:
        path = job / "meta.json"

        if not path.exists():
            return {}

        raw = path.read_text(encoding="utf-8").strip()

        if not raw:
            return {}

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            raise JobLedgerError(f"Invalid meta.json in {job}")

    def _write_meta(self, job: Path, data: Dict[str, Any]) -> None:
        path = job / "meta.json"

        payload = {
            "created_at": datetime.utcnow().isoformat(),
            "repo": str(self.repo_root),
            **data,
        }

        path.write_text(
            json.dumps(payload, indent=2, sort_keys=True),
            encoding="utf-8",
        )
