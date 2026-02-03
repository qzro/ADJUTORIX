"""
Patch ledger: propose, list, get, accept, reject, apply (file_ops only).
"""
from __future__ import annotations

import base64
import hashlib
import json
import tempfile
from pathlib import Path

import pytest

from adjutorix_agent.core.sqlite_ledger import LedgerError, SqliteLedger


def test_propose_list_get_accept_reject() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(
            job_id="j1",
            kind="fix",
            repo_root=tmp,
            cwd=tmp,
            confirm=False,
        )
        file_ops = [
            {"op": "write", "path": "foo.txt", "base_sha": "0" * 64, "new_content_b64": base64.b64encode(b"hello").decode()},
        ]
        patch_text = json.dumps(file_ops)
        base_rev = ledger.compute_base_rev_from_file_ops(patch_text)
        ledger.propose_patch(
            patch_id="p1",
            job_id="j1",
            author="engine",
            summary="test",
            base_rev=base_rev,
            patch_format="file_ops",
            patch_text=patch_text,
        )
        rows = ledger.list_patches(job_id="j1", limit=10)
        assert len(rows) == 1
        assert rows[0]["patch_id"] == "p1"
        assert rows[0]["status"] == "proposed"
        p = ledger.get_patch("p1")
        assert p is not None
        assert p["patch_text"] == patch_text
        ok = ledger.accept_patch("p1")
        assert ok is True
        assert ledger.get_patch("p1")["status"] == "accepted"
        ok_reject = ledger.reject_patch("p1")
        assert ok_reject is False  # already accepted


def test_apply_file_ops_atomic() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        (Path(tmp) / "foo.txt").write_text("old")
        import hashlib
        old_sha = hashlib.sha256(b"old").hexdigest()
        new_content = b"new content"
        new_sha = hashlib.sha256(new_content).hexdigest()
        file_ops = [
            {"op": "write", "path": "foo.txt", "base_sha": old_sha, "new_content_b64": base64.b64encode(new_content).decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p1",
            job_id="j1",
            author="engine",
            summary="edit foo",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p1")
        result = ledger.apply_patch("p1", Path(tmp))
        assert result["ok"] is True
        assert result["patch_status"] == "applied"
        assert (Path(tmp) / "foo.txt").read_bytes() == new_content
        assert ledger.get_file_rev("foo.txt") == new_sha


def test_apply_new_file_with_empty_base_rev() -> None:
    """New file: base_sha '' or 64 zeros matches current_rev '' (file missing)."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        new_content = b"new file content"
        new_sha = hashlib.sha256(new_content).hexdigest()
        file_ops = [
            {"op": "write", "path": "newfile.txt", "base_sha": "", "new_content_b64": base64.b64encode(new_content).decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p1",
            job_id="j1",
            author="engine",
            summary="create newfile",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p1")
        result = ledger.apply_patch("p1", Path(tmp))
        assert result["ok"] is True
        assert (Path(tmp) / "newfile.txt").read_bytes() == new_content
        assert ledger.get_file_rev("newfile.txt") == new_sha


def test_apply_rejects_path_traversal_write() -> None:
    """path='../../pwned' must hard-fail with INVALID_PATH; no file written outside repo."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        file_ops = [
            {"op": "write", "path": "../../pwned", "base_sha": "", "new_content_b64": base64.b64encode(b"pwned").decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p_trav",
            job_id="j1",
            author="engine",
            summary="traversal",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p_trav")
        res = ledger.apply_patch("p_trav", Path(tmp))
        assert res["ok"] is False
        assert res.get("error") == "INVALID_PATH"
        assert "../../pwned" in res.get("invalid_paths", [])
        assert not (Path(tmp).parent / "pwned").exists()


def test_apply_rejects_path_traversal_sub_dot_dot() -> None:
    """path='sub/../../pwned' must hard-fail (.. segment)."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        file_ops = [
            {"op": "write", "path": "sub/../../pwned", "base_sha": "", "new_content_b64": base64.b64encode(b"x").decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p_trav2",
            job_id="j1",
            author="engine",
            summary="traversal",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p_trav2")
        res = ledger.apply_patch("p_trav2", Path(tmp))
        assert res["ok"] is False
        assert res.get("error") == "INVALID_PATH"
        assert "sub/../../pwned" in res.get("invalid_paths", [])


def test_apply_rejects_symlink_escape() -> None:
    """If sub is a symlink to /tmp, path 'sub/file' must fail (resolves outside workspace)."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        sub = Path(tmp) / "sub"
        try:
            sub.symlink_to("/tmp")
        except OSError:
            pytest.skip("symlinks not supported or /tmp not available")
        file_ops = [
            {"op": "write", "path": "sub/file", "base_sha": "", "new_content_b64": base64.b64encode(b"x").decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p_sym",
            job_id="j1",
            author="engine",
            summary="symlink",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p_sym")
        res = ledger.apply_patch("p_sym", Path(tmp))
        assert res["ok"] is False
        assert res.get("error") == "INVALID_PATH"
        assert "sub/file" in res.get("invalid_paths", [])


def test_apply_rejects_path_traversal_delete() -> None:
    """delete path='../../victim' must hard-fail."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        file_ops = [
            {"op": "delete", "path": "../../victim", "base_sha": "a" * 64},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p_del",
            job_id="j1",
            author="engine",
            summary="traversal delete",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p_del")
        res = ledger.apply_patch("p_del", Path(tmp))
        assert res["ok"] is False
        assert res.get("error") == "INVALID_PATH"
        assert "../../victim" in res.get("invalid_paths", [])


def test_apply_rejects_empty_path() -> None:
    """path='' in file_ops must hard-fail (INVALID_FILE_OPS in validation)."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        file_ops = [
            {"op": "write", "path": "", "base_sha": "", "new_content_b64": base64.b64encode(b"x").decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p_empty",
            job_id="j1",
            author="engine",
            summary="empty path",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p_empty")
        res = ledger.apply_patch("p_empty", Path(tmp))
        assert res["ok"] is False
        assert res.get("error") == "INVALID_FILE_OPS"


def test_apply_rejects_dot_path() -> None:
    """path='.' in file_ops must hard-fail INVALID_PATH."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        file_ops = [
            {"op": "write", "path": ".", "base_sha": "", "new_content_b64": base64.b64encode(b"x").decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p_dot",
            job_id="j1",
            author="engine",
            summary="dot path",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p_dot")
        res = ledger.apply_patch("p_dot", Path(tmp))
        assert res["ok"] is False
        assert res.get("error") == "INVALID_PATH"
        assert "." in res.get("invalid_paths", [])


def test_apply_rejects_rename_op() -> None:
    """Rename op must be rejected with UNSUPPORTED_OP (v1)."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        (Path(tmp) / "a.txt").write_text("a")
        file_ops = [
            {"op": "rename", "from": "a.txt", "to": "b.txt", "base_sha": hashlib.sha256(b"a").hexdigest()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p_ren",
            job_id="none",
            author="engine",
            summary="rename",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p_ren")
        res = ledger.apply_patch("p_ren", Path(tmp))
        assert res["ok"] is False
        assert res.get("error") == "UNSUPPORTED_OP"
        assert (Path(tmp) / "a.txt").exists()
        assert not (Path(tmp) / "b.txt").exists()


def test_apply_rejects_rename_traversal() -> None:
    """Rename with from/to outside workspace must not write; v1 rejects with UNSUPPORTED_OP before path check."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        file_ops = [
            {"op": "rename", "from": "../../pwned_from", "to": "../../pwned_to", "base_sha": "0" * 64},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p_rentrav",
            job_id="none",
            author="engine",
            summary="rename traversal",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p_rentrav")
        res = ledger.apply_patch("p_rentrav", Path(tmp))
        assert res["ok"] is False
        assert res.get("error") == "UNSUPPORTED_OP"
        assert not (Path(tmp).parent / "pwned_from").exists()
        assert not (Path(tmp).parent / "pwned_to").exists()


def test_apply_rejects_if_base_rev_mismatch() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        (Path(tmp) / "foo.txt").write_text("current")
        file_ops = [
            {"op": "write", "path": "foo.txt", "base_sha": "wrong" * 16, "new_content_b64": base64.b64encode(b"new").decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p1",
            job_id="none",
            author="engine",
            summary="edit",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        ledger.accept_patch("p1")
        result = ledger.apply_patch("p1", Path(tmp))
        assert result["ok"] is False
        assert result["error"] == "CONFLICT_BASE_REV"
        assert "foo.txt" in result.get("conflict_files", [])


def test_get_patch_review() -> None:
    """get_patch_review returns per-op base/new content when base matches; base_mismatch when not."""
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.sqlite"
        ledger = SqliteLedger(db)
        ledger.create_job(job_id="j1", kind="fix", repo_root=tmp, cwd=tmp, confirm=False)
        (Path(tmp) / "foo.txt").write_bytes(b"old content")
        old_sha = hashlib.sha256(b"old content").hexdigest()
        new_content = b"new content"
        file_ops = [
            {"op": "write", "path": "foo.txt", "base_sha": old_sha, "new_content_b64": base64.b64encode(new_content).decode()},
        ]
        patch_text = json.dumps(file_ops)
        ledger.propose_patch(
            patch_id="p1",
            job_id="j1",
            author="engine",
            summary="edit",
            base_rev=ledger.compute_base_rev_from_file_ops(patch_text),
            patch_format="file_ops",
            patch_text=patch_text,
        )
        review = ledger.get_patch_review("p1", Path(tmp))
        assert review is not None
        assert len(review) == 1
        ro = review[0]
        assert ro["path"] == "foo.txt"
        assert ro["op"] == "write"
        assert ro["base_mismatch"] is False
        assert ro.get("base_content_b64") == base64.b64encode(b"old content").decode()
        assert ro.get("new_content_b64") == base64.b64encode(new_content).decode()
        # After changing file on disk, base should mismatch
        (Path(tmp) / "foo.txt").write_bytes(b"other")
        review2 = ledger.get_patch_review("p1", Path(tmp))
        assert review2 is not None
        assert review2[0]["base_mismatch"] is True
