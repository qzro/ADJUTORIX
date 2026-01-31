"""
secrets_scan

Lightweight deterministic secrets scanner.

Scans repository files for common credential patterns before commit/push.
Zero network. Zero cloud dependency.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Dict, Pattern


class SecretMatch:
    def __init__(self, file: Path, line_no: int, line: str, rule: str):
        self.file = file
        self.line_no = line_no
        self.line = line.strip()
        self.rule = rule

    def to_dict(self) -> Dict[str, str]:
        return {
            "file": str(self.file),
            "line": str(self.line_no),
            "rule": self.rule,
            "content": self.line,
        }


class SecretsScanError(Exception):
    pass


class SecretsScanner:
    """
    Deterministic regex-based secret scanner.
    """

    DEFAULT_RULES: Dict[str, Pattern[str]] = {
        "AWS_ACCESS_KEY": re.compile(r"AKIA[0-9A-Z]{16}"),
        "AWS_SECRET": re.compile(r"(?i)aws(.{0,20})?secret(.{0,20})?['\"][0-9a-zA-Z/+]{40}['\"]"),
        "GITHUB_TOKEN": re.compile(r"gh[pousr]_[0-9a-zA-Z]{36,255}"),
        "OPENAI_KEY": re.compile(r"sk-[0-9a-zA-Z]{32,}"),
        "GENERIC_API_KEY": re.compile(r"(?i)api[_-]?key\s*=\s*['\"][0-9a-zA-Z]{16,}['\"]"),
        "PRIVATE_KEY": re.compile(r"-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----"),
        "JWT_TOKEN": re.compile(r"eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+"),
        "SLACK_TOKEN": re.compile(r"xox[baprs]-[0-9a-zA-Z-]{10,48}"),
    }

    DEFAULT_EXCLUDES = {
        ".git",
        "node_modules",
        "dist",
        "build",
        ".venv",
        "__pycache__",
    }

    TEXT_EXTENSIONS = {
        ".py",
        ".ts",
        ".js",
        ".json",
        ".yaml",
        ".yml",
        ".env",
        ".txt",
        ".md",
        ".toml",
        ".ini",
        ".cfg",
        ".sh",
    }

    def __init__(
        self,
        root: Path,
        rules: Dict[str, Pattern[str]] | None = None,
        excludes: set[str] | None = None,
    ):
        self.root = root
        self.rules = rules or self.DEFAULT_RULES
        self.excludes = excludes or self.DEFAULT_EXCLUDES
        self.matches: List[SecretMatch] = []

    def scan(self) -> List[SecretMatch]:
        """
        Run full scan.
        """
        self.matches.clear()

        for path in self._iter_files(self.root):
            self._scan_file(path)

        return self.matches

    def _iter_files(self, root: Path):
        """
        Walk filesystem with exclusion.
        """
        for path in root.rglob("*"):
            if not path.is_file():
                continue

            if self._is_excluded(path):
                continue

            if path.suffix.lower() not in self.TEXT_EXTENSIONS:
                continue

            yield path

    def _is_excluded(self, path: Path) -> bool:
        for part in path.parts:
            if part in self.excludes:
                return True
        return False

    def _scan_file(self, path: Path):
        """
        Scan single file.
        """
        try:
            content = path.read_text(errors="ignore")
        except Exception:
            return

        for i, line in enumerate(content.splitlines(), start=1):
            self._scan_line(path, i, line)

    def _scan_line(self, path: Path, line_no: int, line: str):
        for name, pattern in self.rules.items():
            if pattern.search(line):
                self.matches.append(
                    SecretMatch(
                        file=path,
                        line_no=line_no,
                        line=line,
                        rule=name,
                    )
                )

    def has_secrets(self) -> bool:
        return bool(self.matches)

    def report(self) -> str:
        """
        Human-readable report.
        """
        if not self.matches:
            return "No secrets detected."

        lines: List[str] = ["Potential secrets detected:\n"]

        for m in self.matches:
            lines.append(
                f"{m.file}:{m.line_no} [{m.rule}] {m.line}"
            )

        return "\n".join(lines)


def scan_repository(
    repo_path: Path,
    fail_on_match: bool = True,
) -> List[Dict[str, str]]:
    """
    Public API for agent.

    Args:
        repo_path: Repo root
        fail_on_match: Raise if secrets found
    """
    scanner = SecretsScanner(repo_path)
    matches = scanner.scan()

    if matches and fail_on_match:
        raise SecretsScanError(scanner.report())

    return [m.to_dict() for m in matches]


def main():
    import sys

    root = Path.cwd()

    try:
        results = scan_repository(root, fail_on_match=False)

        if not results:
            print("✓ No secrets found")
            return

        print("⚠ Secrets detected:\n")

        for r in results:
            print(
                f"{r['file']}:{r['line']} "
                f"[{r['rule']}] {r['content']}"
            )

        sys.exit(2)

    except SecretsScanError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
