"""
Durable ledger for jobs + logs. v1: jobs + logs only.
Append-only logs; job state transitions persisted; recovery deterministic.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


SCHEMA_VERSION = 3


class LedgerError(RuntimeError):
    """Invalid state transition or missing job."""


def _utc_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True)
class JobRow:
    job_id: str
    kind: str
    state: str
    created_at_ms: int
    started_at_ms: Optional[int]
    finished_at_ms: Optional[int]
    repo_root: str
    cwd: str
    confirm: int
    summary: str
    error: str


class SqliteLedger:
    """
    Durable ledger for jobs + logs.
    Concurrency model: single writer (your single worker). Readers allowed.
    """

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_pragmas()
        self._migrate()

    def _init_pragmas(self) -> None:
        c = self._conn.cursor()
        c.execute("PRAGMA journal_mode=WAL;")
        c.execute("PRAGMA synchronous=NORMAL;")
        c.execute("PRAGMA foreign_keys=ON;")
        c.execute("PRAGMA busy_timeout=3000;")
        self._conn.commit()

    def _migrate(self) -> None:
        c = self._conn.cursor()
        c.execute(
            "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
        )
        cur = c.execute("SELECT value FROM meta WHERE key='schema_version';").fetchone()
        if cur is None:
            c.execute(
                "INSERT INTO meta(key,value) VALUES('schema_version', ?);",
                (str(SCHEMA_VERSION),),
            )
            self._create_schema_v1(c)
            self._conn.commit()
            return

        v = int(cur["value"])
        if v < SCHEMA_VERSION:
            if v < 2:
                self._migrate_v1_to_v2(c)
            if v < 3:
                self._migrate_v2_to_v3(c)
            return
        if v > SCHEMA_VERSION:
            raise RuntimeError(
                f"Unsupported schema_version={v}, expected {SCHEMA_VERSION}"
            )

    def _migrate_v1_to_v2(self, c: sqlite3.Cursor) -> None:
        """Add next_log_seq to jobs; backfill from existing logs; bump schema version."""
        try:
            c.execute("ALTER TABLE jobs ADD COLUMN next_log_seq INTEGER NOT NULL DEFAULT 0;")
        except sqlite3.OperationalError:
            pass
        c.execute(
            """
            UPDATE jobs
            SET next_log_seq = COALESCE(
                (SELECT MAX(seq) + 1 FROM logs WHERE logs.job_id = jobs.job_id),
                0
            );
            """
        )
        c.execute("UPDATE meta SET value=? WHERE key='schema_version';", ("2",))
        self._conn.commit()

    def _migrate_v2_to_v3(self, c: sqlite3.Cursor) -> None:
        """Add patches and file_revs tables; bump schema version."""
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS patches (
              patch_id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL,
              created_at_ms INTEGER NOT NULL,
              author TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected','applied','failed','reverted')),
              summary TEXT NOT NULL DEFAULT '',
              base_rev TEXT NOT NULL,
              patch_format TEXT NOT NULL CHECK (patch_format IN ('unified_diff','file_ops')),
              patch_text TEXT NOT NULL,
              error TEXT NOT NULL DEFAULT ''
            );
            """
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_patches_job_created ON patches(job_id, created_at_ms DESC);"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_patches_status_created ON patches(status, created_at_ms DESC);"
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS file_revs (
              path TEXT PRIMARY KEY,
              rev TEXT NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_patch_id TEXT
            );
            """
        )
        c.execute("UPDATE meta SET value=? WHERE key='schema_version';", (str(SCHEMA_VERSION),))
        self._conn.commit()

    def _create_schema_v1(self, c: sqlite3.Cursor) -> None:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
              job_id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              state TEXT NOT NULL,
              created_at_ms INTEGER NOT NULL,
              started_at_ms INTEGER,
              finished_at_ms INTEGER,
              repo_root TEXT NOT NULL,
              cwd TEXT NOT NULL,
              confirm INTEGER NOT NULL DEFAULT 0,
              summary TEXT NOT NULL DEFAULT '',
              error TEXT NOT NULL DEFAULT '',
              next_log_seq INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS logs (
              job_id TEXT NOT NULL,
              seq INTEGER NOT NULL,
              ts_ms INTEGER NOT NULL,
              stream TEXT NOT NULL,
              line TEXT NOT NULL,
              PRIMARY KEY(job_id, seq),
              FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
            );
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);")
        c.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at_ms);")
        self._create_patches_file_revs(c)

    def _create_patches_file_revs(self, c: sqlite3.Cursor) -> None:
        """Create patches and file_revs tables (v3)."""
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS patches (
              patch_id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL,
              created_at_ms INTEGER NOT NULL,
              author TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected','applied','failed','reverted')),
              summary TEXT NOT NULL DEFAULT '',
              base_rev TEXT NOT NULL,
              patch_format TEXT NOT NULL CHECK (patch_format IN ('unified_diff','file_ops')),
              patch_text TEXT NOT NULL,
              error TEXT NOT NULL DEFAULT ''
            );
            """
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_patches_job_created ON patches(job_id, created_at_ms DESC);"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_patches_status_created ON patches(status, created_at_ms DESC);"
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS file_revs (
              path TEXT PRIMARY KEY,
              rev TEXT NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_patch_id TEXT
            );
            """
        )

    # ---------------------------
    # Jobs
    # ---------------------------
    def create_job(
        self,
        *,
        job_id: str,
        kind: str,
        repo_root: str,
        cwd: str,
        confirm: bool,
    ) -> None:
        now = _utc_ms()
        self._conn.execute(
            """
            INSERT INTO jobs(job_id, kind, state, created_at_ms, repo_root, cwd, confirm)
            VALUES(?,?,?,?,?,?,?);
            """,
            (job_id, kind, "queued", now, repo_root, cwd, 1 if confirm else 0),
        )
        self._conn.commit()

    def start_job(self, job_id: str) -> None:
        """Transition queued → running. Raises LedgerError if not queued."""
        now = _utc_ms()
        cur = self._conn.execute(
            "UPDATE jobs SET state='running', started_at_ms=? WHERE job_id=? AND state='queued';",
            (now, job_id),
        )
        self._conn.commit()
        if cur.rowcount != 1:
            raise LedgerError(f"start_job: job {job_id} not queued (rowcount={cur.rowcount})")

    def finish_job(
        self, job_id: str, *, state: str, summary: str = "", error: str = ""
    ) -> None:
        """Transition running or canceled → terminal. If already canceled, keep state canceled and set finished_at_ms + append to summary. Raises LedgerError if not running/canceled."""
        now = _utc_ms()
        cur = self._conn.execute(
            """
            UPDATE jobs
            SET
              state = CASE WHEN state = 'canceled' THEN 'canceled' ELSE ? END,
              finished_at_ms = ?,
              summary = CASE WHEN state = 'canceled' THEN COALESCE(summary,'') || '; completed after cancel' ELSE ? END,
              error = CASE WHEN state = 'canceled' THEN error ELSE ? END
            WHERE job_id=? AND state IN ('running','canceled');
            """,
            (state, now, summary or "", error or "", job_id),
        )
        self._conn.commit()
        if cur.rowcount != 1:
            raise LedgerError(
                f"finish_job: job {job_id} not running/canceled (rowcount={cur.rowcount})"
            )

    def cancel_job(self, job_id: str) -> bool:
        """Transition queued|running → canceled. Returns True if updated."""
        now = _utc_ms()
        cur = self._conn.execute(
            """
            UPDATE jobs
            SET state='canceled', finished_at_ms=?,
                summary=CASE WHEN state='queued' THEN 'Canceled' ELSE 'Cancel requested (may still complete)' END,
                error=''
            WHERE job_id=? AND state IN ('queued','running');
            """,
            (now, job_id),
        )
        self._conn.commit()
        return cur.rowcount == 1

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        r = self._conn.execute(
            "SELECT * FROM jobs WHERE job_id=?;", (job_id,)
        ).fetchone()
        return dict(r) if r else None

    def list_queued_job_ids(self) -> List[str]:
        rows = self._conn.execute(
            "SELECT job_id FROM jobs WHERE state='queued' ORDER BY created_at_ms ASC;"
        ).fetchall()
        return [str(row["job_id"]) for row in rows]

    def list_recent_jobs(self, limit: int = 50) -> List[Dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM jobs ORDER BY created_at_ms DESC LIMIT ?;", (limit,)
        ).fetchall()
        return [dict(x) for x in rows]

    def count_queued(self) -> int:
        r = self._conn.execute(
            "SELECT COUNT(1) AS n FROM jobs WHERE state='queued';"
        ).fetchone()
        return int(r["n"]) if r else 0

    def recover_on_startup(self, *, reason: str = "engine_restart") -> int:
        """
        Crash recovery: any job that was queued or running becomes aborted.
        Option A: least surprising; no resurrected runs after restart.
        """
        now = _utc_ms()
        cur = self._conn.execute(
            "SELECT job_id FROM jobs WHERE state IN ('queued','running');"
        ).fetchall()
        job_ids = [x["job_id"] for x in cur]
        if not job_ids:
            return 0
        self._conn.executemany(
            """
            UPDATE jobs
            SET state='aborted', finished_at_ms=?, summary=?, error=?
            WHERE job_id=?;
            """,
            [
                (now, "Aborted (engine restart)", reason, jid)
                for jid in job_ids
            ],
        )
        self._conn.commit()
        return len(job_ids)

    # ---------------------------
    # Logs (O(1) sequencing via jobs.next_log_seq)
    # ---------------------------
    def next_seq(self, job_id: str) -> int:
        """Return next sequence number (for readers). Uses next_log_seq if present else MAX(seq)+1."""
        r = self._conn.execute(
            "SELECT next_log_seq FROM jobs WHERE job_id=?;", (job_id,)
        ).fetchone()
        if r is not None and "next_log_seq" in r.keys():
            return int(r["next_log_seq"])
        r = self._conn.execute(
            "SELECT MAX(seq) AS m FROM logs WHERE job_id=?;", (job_id,)
        ).fetchone()
        m = r["m"] if r else None
        return int(m) + 1 if m is not None else 0

    def append_log(
        self, job_id: str, line: str, *, stream: str = "system"
    ) -> int:
        """Append one log line; seq from jobs.next_log_seq, in one transaction."""
        ts = _utc_ms()
        try:
            self._conn.execute("BEGIN IMMEDIATE")
            cur = self._conn.execute(
                "SELECT next_log_seq FROM jobs WHERE job_id=?;", (job_id,)
            ).fetchone()
            if cur is None:
                self._conn.rollback()
                raise LedgerError(f"append_log: job {job_id} not found")
            seq = int(cur["next_log_seq"]) if "next_log_seq" in cur.keys() else self._next_seq_fallback(job_id)
            self._conn.execute(
                "INSERT INTO logs(job_id, seq, ts_ms, stream, line) VALUES(?,?,?,?,?);",
                (job_id, seq, ts, stream, line),
            )
            self._conn.execute(
                "UPDATE jobs SET next_log_seq=? WHERE job_id=?;",
                (seq + 1, job_id),
            )
            self._conn.commit()
            return seq
        except Exception:
            self._conn.rollback()
            raise

    def _next_seq_fallback(self, job_id: str) -> int:
        """For DBs without next_log_seq column."""
        r = self._conn.execute(
            "SELECT MAX(seq) AS m FROM logs WHERE job_id=?;", (job_id,)
        ).fetchone()
        m = r["m"] if r else None
        return int(m) + 1 if m is not None else 0

    def get_logs(
        self, job_id: str, since_seq: int = 0, limit: int = 500
    ) -> Dict[str, Any]:
        rows = self._conn.execute(
            """
            SELECT seq, line FROM logs
            WHERE job_id=? AND seq>=?
            ORDER BY seq ASC
            LIMIT ?;
            """,
            (job_id, since_seq, limit),
        ).fetchall()
        lines = [{"seq": int(r["seq"]), "line": str(r["line"])} for r in rows]
        next_seq = (lines[-1]["seq"] + 1) if lines else self.next_seq(job_id)
        job = self.get_job(job_id)
        done = bool(
            job
            and job["state"] in ("success", "failed", "canceled", "aborted")
        )
        return {"lines": lines, "next_seq": next_seq, "done": done}

    # ---------------------------
    # Patches + file_revs (v3)
    # ---------------------------
    PATCH_TEXT_MAX_BYTES = 2 * 1024 * 1024  # 2 MB cap

    def _sha(self, data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def compute_base_rev_from_file_ops(patch_text: str) -> str:
        """Compute base_rev from file_ops JSON: sha256 of deterministic {path: base_sha} map."""
        try:
            ops = json.loads(patch_text)
        except (json.JSONDecodeError, TypeError):
            return ""
        if not isinstance(ops, list):
            return ""
        base_map: Dict[str, str] = {}
        for op in ops:
            if not isinstance(op, dict):
                continue
            path = op.get("path") or op.get("from")
            base_sha = op.get("base_sha")
            if path and base_sha is not None:
                base_map[str(path)] = str(base_sha)
        if not base_map:
            return ""
        canonical = json.dumps(base_map, sort_keys=True)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def propose_patch(
        self,
        *,
        patch_id: str,
        job_id: str,
        author: str,
        summary: str,
        base_rev: str,
        patch_format: str,
        patch_text: str,
    ) -> None:
        """Store patch as proposed. Validates patch_format and size."""
        if patch_format not in ("unified_diff", "file_ops"):
            raise LedgerError(f"propose_patch: invalid patch_format {patch_format}")
        if len(patch_text.encode("utf-8")) > self.PATCH_TEXT_MAX_BYTES:
            raise LedgerError(
                f"propose_patch: patch_text exceeds {self.PATCH_TEXT_MAX_BYTES} bytes"
            )
        now = _utc_ms()
        self._conn.execute(
            """
            INSERT INTO patches(patch_id, job_id, created_at_ms, author, status, summary, base_rev, patch_format, patch_text, error)
            VALUES(?,?,?,?,?,?,?,?,?,?);
            """,
            (patch_id, job_id, now, author, "proposed", summary, base_rev, patch_format, patch_text, ""),
        )
        self._conn.commit()

    def get_patch(self, patch_id: str) -> Optional[Dict[str, Any]]:
        r = self._conn.execute(
            "SELECT * FROM patches WHERE patch_id=?;", (patch_id,)
        ).fetchone()
        return dict(r) if r else None

    def get_patch_review(
        self, patch_id: str, workspace_root: Path
    ) -> Optional[List[Dict[str, Any]]]:
        """
        For file_ops patches: return per-op review data for UI diff.
        Each item: path, op, new_content_b64?, base_content_b64?, base_mismatch (bool).
        base_content_b64 only set when base_sha matches current file rev (so diff is reliable).
        Returns None if patch not found or not file_ops.
        """
        p = self.get_patch(patch_id)
        if not p or p.get("patch_format") != "file_ops":
            return None
        try:
            ops = json.loads(p["patch_text"])
        except (json.JSONDecodeError, TypeError):
            return None
        if not isinstance(ops, list):
            return None
        root = Path(workspace_root).resolve()
        EMPTY_REV = ""
        ZERO_REV = "0" * 64

        def current_rev(rel_path: str) -> str:
            try:
                fp = self._resolve_in_workspace(root, rel_path)
            except LedgerError:
                return EMPTY_REV
            if not fp.exists():
                return EMPTY_REV
            rev = self.get_file_rev(rel_path)
            if rev is not None:
                return rev
            return self._sha(fp.read_bytes())

        def base_norm(rev: Any) -> str:
            if rev == "" or rev == ZERO_REV:
                return EMPTY_REV
            return str(rev)

        out: List[Dict[str, Any]] = []
        for op in ops:
            if not isinstance(op, dict):
                continue
            op_type = op.get("op")
            path = op.get("path") or op.get("from")
            if not isinstance(path, str):
                continue
            base_sha = op.get("base_sha")
            base_n = base_norm(base_sha) if base_sha is not None else EMPTY_REV
            cur = current_rev(path)
            base_mismatch = cur != base_n
            entry: Dict[str, Any] = {
                "path": path,
                "op": op_type or "?",
                "base_mismatch": base_mismatch,
            }
            if op_type == "write":
                entry["new_content_b64"] = op.get("new_content_b64") or ""
                if not base_mismatch:
                    try:
                        fp = self._resolve_in_workspace(root, path)
                        if fp.exists():
                            entry["base_content_b64"] = base64.b64encode(fp.read_bytes()).decode()
                        else:
                            entry["base_content_b64"] = ""
                    except LedgerError:
                        entry["base_content_b64"] = ""
                        entry["base_mismatch"] = True
                else:
                    entry["base_content_b64"] = ""
            elif op_type == "delete":
                if not base_mismatch:
                    try:
                        fp = self._resolve_in_workspace(root, path)
                        if fp.exists():
                            entry["base_content_b64"] = base64.b64encode(fp.read_bytes()).decode()
                        else:
                            entry["base_content_b64"] = ""
                    except LedgerError:
                        entry["base_content_b64"] = ""
                        entry["base_mismatch"] = True
                else:
                    entry["base_content_b64"] = ""
            out.append(entry)
        return out

    def list_patches(
        self,
        *,
        job_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        q = "SELECT patch_id, job_id, status, created_at_ms, summary FROM patches WHERE 1=1"
        params: List[Any] = []
        if job_id is not None:
            q += " AND job_id=?"
            params.append(job_id)
        if status is not None:
            q += " AND status=?"
            params.append(status)
        q += " ORDER BY created_at_ms DESC LIMIT ?"
        params.append(limit)
        rows = self._conn.execute(q, params).fetchall()
        return [dict(x) for x in rows]

    def accept_patch(self, patch_id: str) -> bool:
        cur = self._conn.execute(
            "UPDATE patches SET status='accepted' WHERE patch_id=? AND status='proposed';",
            (patch_id,),
        )
        self._conn.commit()
        return cur.rowcount == 1

    def reject_patch(self, patch_id: str) -> bool:
        cur = self._conn.execute(
            "UPDATE patches SET status='rejected' WHERE patch_id=? AND status='proposed';",
            (patch_id,),
        )
        self._conn.commit()
        return cur.rowcount == 1

    def _set_patch_status(self, patch_id: str, status: str, error: str = "") -> None:
        self._conn.execute(
            "UPDATE patches SET status=?, error=? WHERE patch_id=?;",
            (status, error, patch_id),
        )
        self._conn.commit()

    def get_file_rev(self, path: str) -> Optional[str]:
        r = self._conn.execute(
            "SELECT rev FROM file_revs WHERE path=?;", (path,)
        ).fetchone()
        return str(r["rev"]) if r else None

    def set_file_rev(
        self, path: str, rev: str, *, last_patch_id: Optional[str] = None
    ) -> None:
        now = _utc_ms()
        self._conn.execute(
            """
            INSERT INTO file_revs(path, rev, updated_at_ms, last_patch_id)
            VALUES(?,?,?,?)
            ON CONFLICT(path) DO UPDATE SET rev=?, updated_at_ms=?, last_patch_id=?;
            """,
            (path, rev, now, last_patch_id, rev, now, last_patch_id),
        )
        self._conn.commit()

    def _resolve_in_workspace(self, workspace_root: Path, rel: str) -> Path:
        if not rel or rel in (".", "/"):
            raise LedgerError(f"invalid path: {rel!r}")
        if os.path.isabs(rel):
            raise LedgerError(f"path escapes workspace (absolute): {rel!r}")
        if "\\" in rel:
            raise LedgerError(f"path escapes workspace (backslash): {rel!r}")

        # Normalize segments; reject any ".."
        parts = rel.split("/")
        if any(p == ".." for p in parts):
            raise LedgerError(f"path escapes workspace ('..' segment): {rel!r}")

        root = workspace_root.resolve()
        target = (root / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            raise LedgerError(f"path escapes workspace: {rel!r}")

        return target

    def apply_patch(
        self, patch_id: str, workspace_root: Path
    ) -> Dict[str, Any]:
        """
        Apply patch (file_ops only). Requires status=accepted.
        Preflight: base_sha must match file_revs or current file bytes.
        Per-file atomic and best-effort durable: write temp -> fsync(temp) -> rename -> fsync(parent dir).
        Full crash-consistency across multiple files is NOT guaranteed (ops applied sequentially).
        Returns {ok, error?, conflict_files?, invalid_paths?, patch_status}.
        """
        p = self.get_patch(patch_id)
        if not p:
            return {"ok": False, "error": "NOT_FOUND", "patch_status": None}
        if p["status"] != "accepted":
            return {"ok": False, "error": "NOT_ACCEPTED", "patch_status": p["status"]}
        if p["patch_format"] != "file_ops":
            return {"ok": False, "error": "ONLY_FILE_OPS", "patch_status": p["status"]}

        try:
            ops = json.loads(p["patch_text"])
        except (json.JSONDecodeError, TypeError):
            return {"ok": False, "error": "INVALID_JSON", "patch_status": p["status"]}
        if not isinstance(ops, list):
            return {"ok": False, "error": "INVALID_FILE_OPS", "patch_status": p["status"]}

        # ---- Strict validation (no silent skipping) ----
        MAX_OPS = 500
        MAX_NEW_BYTES = 2 * 1024 * 1024  # decoded bytes cap (aggregate)
        if len(ops) > MAX_OPS:
            return {"ok": False, "error": "FILE_OPS_TOO_LARGE", "patch_status": p["status"]}

        total_new_bytes = 0
        for op in ops:
            if not isinstance(op, dict):
                return {"ok": False, "error": "INVALID_FILE_OPS", "patch_status": p["status"]}

            op_type = op.get("op")
            if op_type not in ("write", "delete", "rename"):
                return {"ok": False, "error": "INVALID_FILE_OPS", "patch_status": p["status"]}

            if op_type in ("write", "delete"):
                if not op.get("path"):
                    return {"ok": False, "error": "INVALID_FILE_OPS", "patch_status": p["status"]}

            if op_type == "rename":
                # v1 explicitly unsupported to avoid silent divergence
                return {"ok": False, "error": "UNSUPPORTED_OP", "patch_status": p["status"]}

            if op_type == "write":
                b64 = op.get("new_content_b64")
                if not isinstance(b64, str):
                    return {"ok": False, "error": "INVALID_FILE_OPS", "patch_status": p["status"]}
                try:
                    decoded = base64.b64decode(b64, validate=True)
                except Exception:
                    return {"ok": False, "error": "INVALID_FILE_OPS", "patch_status": p["status"]}
                total_new_bytes += len(decoded)
                if total_new_bytes > MAX_NEW_BYTES:
                    return {
                        "ok": False,
                        "error": "FILE_OPS_CONTENT_TOO_LARGE",
                        "patch_status": p["status"],
                    }

            # Require base_sha for preflight for write/delete
            if op_type in ("write", "delete") and op.get("base_sha") is None:
                return {"ok": False, "error": "INVALID_FILE_OPS", "patch_status": p["status"]}

        workspace_root = Path(workspace_root).resolve()

        conflict_files: List[str] = []
        invalid_paths: List[str] = []

        EMPTY_REV = ""
        ZERO_REV = "0" * 64

        def base_rev_normalized(rev: str) -> str:
            """Treat '' or 64 zeros as 'file missing' for preflight."""
            if rev == "" or rev == ZERO_REV:
                return EMPTY_REV
            return rev

        def current_rev(rel_path: str) -> str:
            fp = self._resolve_in_workspace(workspace_root, rel_path)
            if not fp.exists():
                return EMPTY_REV
            rev = self.get_file_rev(rel_path)
            if rev is not None:
                return rev
            return self._sha(fp.read_bytes())

        # ---- Preflight (also validates paths) ----
        for op in ops:
            op_type = op.get("op")
            if op_type not in ("write", "delete"):
                continue

            path = op.get("path")
            base_sha = op.get("base_sha")
            if not isinstance(path, str) or base_sha is None:
                # already validated above; this is defensive
                return {"ok": False, "error": "INVALID_FILE_OPS", "patch_status": p["status"]}

            try:
                cur = current_rev(path)
            except LedgerError:
                invalid_paths.append(path)
                continue

            base_norm = base_rev_normalized(str(base_sha))
            if cur != base_norm:
                conflict_files.append(path)

        if invalid_paths:
            return {
                "ok": False,
                "error": "INVALID_PATH",
                "invalid_paths": invalid_paths,
                "patch_status": p["status"],
            }

        if conflict_files:
            return {
                "ok": False,
                "error": "CONFLICT_BASE_REV",
                "conflict_files": conflict_files,
                "patch_status": p["status"],
            }

        # ---- Apply ----
        for op in ops:
            op_type = op.get("op")
            path = op.get("path")

            if op_type == "write" and isinstance(path, str):
                new_content_b64 = op.get("new_content_b64")
                if not isinstance(new_content_b64, str):
                    self._set_patch_status(patch_id, "failed", "missing new_content_b64")
                    return {"ok": False, "error": "PATCH_HUNK_FAILED", "patch_status": "failed"}

                try:
                    new_content = base64.b64decode(new_content_b64, validate=True)
                except Exception:
                    self._set_patch_status(patch_id, "failed", "invalid base64")
                    return {"ok": False, "error": "PATCH_HUNK_FAILED", "patch_status": "failed"}

                try:
                    fp = self._resolve_in_workspace(workspace_root, path)
                except LedgerError as e:
                    return {
                        "ok": False,
                        "error": "INVALID_PATH",
                        "invalid_paths": [path],
                        "patch_status": p["status"],
                    }

                fp.parent.mkdir(parents=True, exist_ok=True)
                tmp = fp.with_suffix(fp.suffix + ".tmp." + patch_id[:8])

                try:
                    tmp.write_bytes(new_content)

                    # fsync file
                    with open(tmp, "rb") as f:
                        os.fsync(f.fileno())

                    # rename into place (atomic replace)
                    tmp.rename(fp)

                    # fsync parent directory AFTER rename
                    try:
                        dir_fd = os.open(fp.parent, os.O_RDONLY)
                        try:
                            os.fsync(dir_fd)
                        finally:
                            os.close(dir_fd)
                    except Exception:
                        pass

                except Exception as e:
                    self._set_patch_status(patch_id, "failed", str(e))
                    return {"ok": False, "error": "PATCH_HUNK_FAILED", "patch_status": "failed"}

                rev = self._sha(new_content)
                self.set_file_rev(path, rev, last_patch_id=patch_id)

            elif op_type == "delete" and isinstance(path, str):
                try:
                    fp = self._resolve_in_workspace(workspace_root, path)
                except LedgerError:
                    return {
                        "ok": False,
                        "error": "INVALID_PATH",
                        "invalid_paths": [path],
                        "patch_status": p["status"],
                    }

                try:
                    if fp.exists():
                        fp.unlink()
                        # fsync parent dir after delete best-effort
                        try:
                            dir_fd = os.open(fp.parent, os.O_RDONLY)
                            try:
                                os.fsync(dir_fd)
                            finally:
                                os.close(dir_fd)
                        except Exception:
                            pass
                except Exception as e:
                    self._set_patch_status(patch_id, "failed", str(e))
                    return {"ok": False, "error": "PATCH_HUNK_FAILED", "patch_status": "failed"}

                self._conn.execute("DELETE FROM file_revs WHERE path=?;", (path,))
                self._conn.commit()

        self._set_patch_status(patch_id, "applied", "")
        return {"ok": True, "patch_status": "applied"}
