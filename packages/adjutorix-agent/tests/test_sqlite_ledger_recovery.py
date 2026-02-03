"""
Prove restart recovery: running and queued jobs at startup become aborted.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from adjutorix_agent.core.sqlite_ledger import SqliteLedger


def test_recover_running_jobs_to_aborted() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        l1 = SqliteLedger(db)

        l1.create_job(
            job_id="j1",
            kind="check",
            repo_root=tmp,
            cwd=tmp,
            confirm=False,
        )
        l1.start_job("j1")
        assert l1.get_job("j1")["state"] == "running"

        # Simulate process restart by constructing a new ledger object
        l2 = SqliteLedger(db)
        n = l2.recover_on_startup(reason="engine_restart")
        assert n == 1
        j = l2.get_job("j1")
        assert j is not None
        assert j["state"] == "aborted"
        assert j["error"] == "engine_restart"
        assert "engine restart" in j["summary"].lower()
        assert j["finished_at_ms"] is not None


def test_recover_queued_jobs_to_aborted() -> None:
    """Queued jobs at restart are aborted (Option A: no resurrected runs)."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        l1 = SqliteLedger(db)
        l1.create_job(
            job_id="q1",
            kind="check",
            repo_root=tmp,
            cwd=tmp,
            confirm=False,
        )
        assert l1.get_job("q1")["state"] == "queued"

        l2 = SqliteLedger(db)
        n = l2.recover_on_startup(reason="engine_restart")
        assert n == 1
        j = l2.get_job("q1")
        assert j is not None
        assert j["state"] == "aborted"
        assert j["finished_at_ms"] is not None
        assert "engine restart" in (j.get("summary") or "").lower()


def test_cancel_queued_sets_terminal_and_finished_at() -> None:
    """Cancel queued → terminal + finished_at_ms set."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(
            job_id="q1",
            kind="check",
            repo_root=tmp,
            cwd=tmp,
            confirm=False,
        )
        assert ledger.get_job("q1")["state"] == "queued"
        ok = ledger.cancel_job("q1")
        assert ok is True
        j = ledger.get_job("q1")
        assert j is not None
        assert j["state"] == "canceled"
        assert j["finished_at_ms"] is not None
        assert "canceled" in (j.get("summary") or "").lower()


def test_cancel_nonexistent_returns_false() -> None:
    """Cancel missing or terminal job returns False."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        assert ledger.cancel_job("nonexistent") is False
        ledger.create_job(
            job_id="j1",
            kind="check",
            repo_root=tmp,
            cwd=tmp,
            confirm=False,
        )
        ledger.start_job("j1")
        ledger.finish_job("j1", state="success", summary="done")
        assert ledger.cancel_job("j1") is False
