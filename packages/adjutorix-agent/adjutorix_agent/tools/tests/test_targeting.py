"""
test_targeting

Deterministic test targeting engine.

Goal:
- Given a set of changed files, return the smallest safe set of tests to run.
- Fall back to full suite when confidence is low.

Design principles:
- Tool-first, no guessing.
- Prefer correctness over minimality.
- Language-agnostic heuristics with per-repo overrides via .agent/policy.yaml.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple


@dataclass(frozen=True)
class TargetingResult:
    mode: str  # "targeted" | "full"
    reason: str
    tests: List[str]
    confidence: float  # 0..1


DEFAULT_TEST_FILE_PATTERNS = (
    "test_*.py",
    "*_test.py",
    "*Tests.java",
    "*.spec.ts",
    "*.spec.tsx",
    "*.test.ts",
    "*.test.tsx",
)


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except Exception:
        return False


def _normalize_paths(paths: Sequence[str], root: Path) -> List[Path]:
    out: List[Path] = []
    for p in paths:
        pp = (root / p).resolve() if not Path(p).is_absolute() else Path(p).resolve()
        if pp.exists() and _is_within(pp, root):
            out.append(pp)
    return out


def _looks_like_test_file(path: Path) -> bool:
    name = path.name
    if name.startswith("test_") and name.endswith(".py"):
        return True
    if name.endswith("_test.py"):
        return True
    if name.endswith(".spec.ts") or name.endswith(".spec.tsx"):
        return True
    if name.endswith(".test.ts") or name.endswith(".test.tsx"):
        return True
    if name.endswith("Tests.java"):
        return True
    return False


def _find_parent_dir_named(path: Path, name: str) -> Optional[Path]:
    for parent in [path] + list(path.parents):
        if parent.name == name:
            return parent
    return None


def _python_module_to_tests(changed: Path, repo_root: Path) -> Set[Path]:
    """
    For Python:
    - If changed is already a test file -> run it.
    - If changed is in a package/module, prefer:
      - tests/ subtree mirroring package structure
      - or sibling test file patterns near module
    """
    candidates: Set[Path] = set()

    if _looks_like_test_file(changed):
        candidates.add(changed)
        return candidates

    tests_dir = repo_root / "tests"
    if tests_dir.exists() and tests_dir.is_dir():
        # Try mirror: src/pkg/foo.py -> tests/pkg/test_foo.py
        rel = changed.relative_to(repo_root)
        rel_parts = list(rel.parts)

        # strip common roots
        for prefix in ("src", "app", "lib"):
            if rel_parts and rel_parts[0] == prefix:
                rel_parts = rel_parts[1:]
                break

        if rel_parts:
            file_stem = Path(rel_parts[-1]).stem
            rel_dir = Path(*rel_parts[:-1]) if len(rel_parts) > 1 else Path()

            mirror_1 = (tests_dir / rel_dir / f"test_{file_stem}.py")
            mirror_2 = (tests_dir / rel_dir / f"{file_stem}_test.py")

            if mirror_1.exists():
                candidates.add(mirror_1)
            if mirror_2.exists():
                candidates.add(mirror_2)

            # Add any tests in mirrored folder if direct file missing
            mirror_folder = tests_dir / rel_dir
            if mirror_folder.exists() and mirror_folder.is_dir():
                for p in mirror_folder.rglob("test_*.py"):
                    candidates.add(p)
                for p in mirror_folder.rglob("*_test.py"):
                    candidates.add(p)

    # Local sibling tests: foo.py -> test_foo.py next to it
    sib1 = changed.with_name(f"test_{changed.stem}.py")
    sib2 = changed.with_name(f"{changed.stem}_test.py")
    if sib1.exists():
        candidates.add(sib1)
    if sib2.exists():
        candidates.add(sib2)

    # If file belongs to a small module folder, include tests in nearest tests folder
    nearest_tests = _find_parent_dir_named(changed.parent, "tests")
    if nearest_tests and nearest_tests.exists():
        for p in nearest_tests.rglob("test_*.py"):
            candidates.add(p)
        for p in nearest_tests.rglob("*_test.py"):
            candidates.add(p)

    return candidates


def _node_module_to_tests(changed: Path, repo_root: Path) -> Set[Path]:
    """
    For Node/TS:
    - If changed is test file -> run it.
    - Try sibling spec/test in same folder.
    - Try __tests__ folder near file.
    """
    candidates: Set[Path] = set()

    if _looks_like_test_file(changed):
        candidates.add(changed)
        return candidates

    folder = changed.parent
    stem = changed.stem

    # sibling tests
    for ext in (".ts", ".tsx", ".js", ".jsx"):
        for suffix in (".spec", ".test"):
            p = folder / f"{stem}{suffix}{ext}"
            if p.exists():
                candidates.add(p)

    # __tests__ nearby
    tests_folder = folder / "__tests__"
    if tests_folder.exists():
        for p in tests_folder.rglob("*"):
            if p.is_file() and (_looks_like_test_file(p) or p.suffix in (".ts", ".tsx", ".js", ".jsx")):
                candidates.add(p)

    # top-level tests
    top_tests = repo_root / "__tests__"
    if top_tests.exists():
        for p in top_tests.rglob("*"):
            if p.is_file() and (_looks_like_test_file(p) or p.suffix in (".ts", ".tsx", ".js", ".jsx")):
                candidates.add(p)

    return candidates


def _guess_repo_languages(repo_root: Path, changed_paths: List[Path]) -> Set[str]:
    langs: Set[str] = set()

    for p in changed_paths:
        if p.suffix == ".py":
            langs.add("python")
        elif p.suffix in (".ts", ".tsx", ".js", ".jsx"):
            langs.add("node")
        elif p.suffix in (".java", ".kt"):
            langs.add("jvm")

    # fallback: detect by config files
    if (repo_root / "pyproject.toml").exists() or (repo_root / "requirements.txt").exists():
        langs.add("python")
    if (repo_root / "package.json").exists():
        langs.add("node")

    return langs


def _dedupe_sorted(paths: Set[Path]) -> List[Path]:
    return sorted(paths, key=lambda p: str(p))


def _format_test_targets(paths: List[Path], repo_root: Path) -> List[str]:
    """
    Convert tests to runner-specific identifiers.
    Default: return paths relative to repo_root.
    """
    out: List[str] = []
    for p in paths:
        try:
            out.append(str(p.relative_to(repo_root)))
        except Exception:
            out.append(str(p))
    return out


def target_tests(
    repo_root: str,
    changed_files: Sequence[str],
    force_full: bool = False,
    max_tests: int = 200,
) -> TargetingResult:
    """
    Main API.

    - repo_root: repository root path
    - changed_files: list of file paths (relative or absolute)
    - force_full: override targeted selection
    - max_tests: safety cap; if exceeded, fall back to full
    """
    root = Path(repo_root).resolve()
    changed = _normalize_paths(changed_files, root)

    if force_full:
        return TargetingResult(
            mode="full",
            reason="force_full=true",
            tests=[],
            confidence=1.0,
        )

    if not changed:
        return TargetingResult(
            mode="full",
            reason="no_changed_files_or_not_found",
            tests=[],
            confidence=0.5,
        )

    # If critical config changes -> full
    CRITICAL = {
        "pyproject.toml",
        "requirements.txt",
        "poetry.lock",
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "tsconfig.json",
        ".github/workflows",
        "Dockerfile",
    }
    for p in changed:
        if p.name in CRITICAL:
            return TargetingResult(
                mode="full",
                reason=f"critical_change:{p.name}",
                tests=[],
                confidence=0.9,
            )
        if ".github/workflows" in str(p):
            return TargetingResult(
                mode="full",
                reason="ci_workflow_changed",
                tests=[],
                confidence=0.9,
            )

    langs = _guess_repo_languages(root, changed)
    candidates: Set[Path] = set()

    for p in changed:
        # If it's a test, include directly
        if _looks_like_test_file(p):
            candidates.add(p)
            continue

        # Language-specific targeting
        if "python" in langs and p.suffix == ".py":
            candidates |= _python_module_to_tests(p, root)

        if "node" in langs and p.suffix in (".ts", ".tsx", ".js", ".jsx"):
            candidates |= _node_module_to_tests(p, root)

    # If we found nothing, fall back to full
    if not candidates:
        return TargetingResult(
            mode="full",
            reason="no_targeted_tests_found",
            tests=[],
            confidence=0.4,
        )

    # Safety cap
    candidates_list = _dedupe_sorted(candidates)

    if len(candidates_list) > max_tests:
        return TargetingResult(
            mode="full",
            reason=f"too_many_targeted_tests:{len(candidates_list)}>{max_tests}",
            tests=[],
            confidence=0.6,
        )

    targets = _format_test_targets(candidates_list, root)

    # Confidence estimation
    # - Higher when we directly mapped to specific files and count is modest.
    confidence = 0.75
    if any(_looks_like_test_file(p) for p in changed):
        confidence = 0.9
    if len(targets) > 50:
        confidence = 0.65

    return TargetingResult(
        mode="targeted",
        reason="heuristic_mapping",
        tests=targets,
        confidence=confidence,
    )


def main():
    import argparse
    import json as _json

    ap = argparse.ArgumentParser(description="Adjutorix deterministic test targeting")
    ap.add_argument("--repo", default=".", help="Repo root")
    ap.add_argument("--changed", nargs="+", required=True, help="Changed files")
    ap.add_argument("--force-full", action="store_true")
    ap.add_argument("--max-tests", type=int, default=200)
    ap.add_argument("--json", action="store_true", help="Output JSON")
    args = ap.parse_args()

    res = target_tests(
        repo_root=args.repo,
        changed_files=args.changed,
        force_full=args.force_full,
        max_tests=args.max_tests,
    )

    if args.json:
        print(
            _json.dumps(
                {
                    "mode": res.mode,
                    "reason": res.reason,
                    "tests": res.tests,
                    "confidence": res.confidence,
                },
                indent=2,
            )
        )
    else:
        print(f"mode={res.mode} confidence={res.confidence:.2f} reason={res.reason}")
        for t in res.tests:
            print(t)


if __name__ == "__main__":
    main()
