"""
dep_audit

Deterministic dependency audit tool.

Performs offline/static analysis of dependency files
to detect risky patterns and known bad practices.

Zero cloud. Zero API. Zero telemetry.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Dict, List, Optional


class DependencyAuditError(Exception):
    pass


class DependencyIssue:
    def __init__(
        self,
        file: Path,
        dependency: str,
        version: str,
        issue: str,
        severity: str,
    ):
        self.file = file
        self.dependency = dependency
        self.version = version
        self.issue = issue
        self.severity = severity

    def to_dict(self) -> Dict[str, str]:
        return {
            "file": str(self.file),
            "dependency": self.dependency,
            "version": self.version,
            "issue": self.issue,
            "severity": self.severity,
        }


class DependencyAuditor:
    """
    Audits dependency files using deterministic checks.
    """

    RISKY_PACKAGES = {
        "event-stream",
        "flatmap-stream",
        "colors.js",
        "faker",
        "ua-parser-js",
    }

    MINIMUM_VERSIONS = {
        # Example: "package": "1.2.3"
    }

    SUPPORTED_FILES = {
        "package.json",
        "package-lock.json",
        "requirements.txt",
        "pyproject.toml",
        "poetry.lock",
        "Pipfile.lock",
    }

    def __init__(self, root: Path):
        self.root = root
        self.issues: List[DependencyIssue] = []

    # -------------------------
    # Public API
    # -------------------------

    def audit(self) -> List[DependencyIssue]:
        """
        Run full audit.
        """
        self.issues.clear()

        for file in self._find_dep_files():
            self._analyze_file(file)

        return self.issues

    # -------------------------
    # File discovery
    # -------------------------

    def _find_dep_files(self) -> List[Path]:
        found: List[Path] = []

        for path in self.root.rglob("*"):
            if not path.is_file():
                continue

            if path.name in self.SUPPORTED_FILES:
                found.append(path)

        return found

    # -------------------------
    # Analysis
    # -------------------------

    def _analyze_file(self, path: Path):
        name = path.name

        try:
            if name == "package.json":
                self._analyze_package_json(path)

            elif name == "package-lock.json":
                self._analyze_package_lock(path)

            elif name == "requirements.txt":
                self._analyze_requirements(path)

            elif name in ("pyproject.toml", "poetry.lock", "Pipfile.lock"):
                self._analyze_text_lockfile(path)

        except Exception as e:
            self._add_issue(
                path,
                "unknown",
                "unknown",
                f"Failed to analyze: {e}",
                "medium",
            )

    # -------------------------
    # Node.js
    # -------------------------

    def _analyze_package_json(self, path: Path):
        data = json.loads(path.read_text())

        deps = {}
        deps.update(data.get("dependencies", {}))
        deps.update(data.get("devDependencies", {}))

        for name, version in deps.items():
            self._check_dependency(path, name, version)

    def _analyze_package_lock(self, path: Path):
        data = json.loads(path.read_text())

        packages = data.get("packages", {})

        for pkg, meta in packages.items():
            name = meta.get("name")
            version = meta.get("version")

            if name and version:
                self._check_dependency(path, name, version)

    # -------------------------
    # Python
    # -------------------------

    def _analyze_requirements(self, path: Path):
        for line in path.read_text().splitlines():
            line = line.strip()

            if not line or line.startswith("#"):
                continue

            if "==" in line:
                name, version = line.split("==", 1)
            else:
                name = line
                version = "*"

            self._check_dependency(path, name, version)

    def _analyze_text_lockfile(self, path: Path):
        """
        Conservative: scan text for risky packages.
        """
        content = path.read_text(errors="ignore")

        for pkg in self.RISKY_PACKAGES:
            if pkg in content:
                self._add_issue(
                    path,
                    pkg,
                    "unknown",
                    "Known risky package detected",
                    "high",
                )

    # -------------------------
    # Core checks
    # -------------------------

    def _check_dependency(self, file: Path, name: str, version: str):
        name = name.strip()
        version = version.strip()

        # Known bad packages
        if name in self.RISKY_PACKAGES:
            self._add_issue(
                file,
                name,
                version,
                "Known compromised / high-risk package",
                "critical",
            )

        # Wildcard versions
        if version in ("*", "latest", ""):
            self._add_issue(
                file,
                name,
                version,
                "Unpinned dependency version",
                "medium",
            )

        # Minimum versions (if defined)
        min_v = self.MINIMUM_VERSIONS.get(name)

        if min_v and self._version_lt(version, min_v):
            self._add_issue(
                file,
                name,
                version,
                f"Version below minimum safe ({min_v})",
                "high",
            )

    def _add_issue(
        self,
        file: Path,
        dep: str,
        version: str,
        issue: str,
        severity: str,
    ):
        self.issues.append(
            DependencyIssue(
                file=file,
                dependency=dep,
                version=version,
                issue=issue,
                severity=severity,
            )
        )

    # -------------------------
    # Utilities
    # -------------------------

    def _version_lt(self, a: str, b: str) -> bool:
        """
        Naive semantic version comparison.
        """
        try:
            pa = [int(x) for x in a.replace("^", "").replace("~", "").split(".")]
            pb = [int(x) for x in b.split(".")]

            return pa < pb
        except Exception:
            return False

    def has_issues(self) -> bool:
        return bool(self.issues)

    def report(self) -> str:
        if not self.issues:
            return "No dependency issues detected."

        lines: List[str] = ["Dependency audit issues:\n"]

        for i in self.issues:
            lines.append(
                f"{i.file} | {i.dependency}@{i.version} "
                f"[{i.severity.upper()}] {i.issue}"
            )

        return "\n".join(lines)


# -------------------------
# Public API
# -------------------------


def audit_repository(
    repo_path: Path,
    fail_on_issue: bool = True,
) -> List[Dict[str, str]]:
    auditor = DependencyAuditor(repo_path)
    issues = auditor.audit()

    if issues and fail_on_issue:
        raise DependencyAuditError(auditor.report())

    return [i.to_dict() for i in issues]


# -------------------------
# CLI
# -------------------------


def main():
    import sys

    root = Path.cwd()

    try:
        issues = audit_repository(root, fail_on_issue=False)

        if not issues:
            print("✓ No dependency issues found")
            return

        print("⚠ Dependency issues detected:\n")

        for i in issues:
            print(
                f"{i['file']} | {i['dependency']}@{i['version']} "
                f"[{i['severity'].upper()}] {i['issue']}"
            )

        sys.exit(2)

    except DependencyAuditError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
