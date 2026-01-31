"""
no_guessing

Enforces the "No-Guessing" policy:
If the agent is uncertain about symbols, entrypoints, or structure,
it MUST run discovery tools before generating patches.

Used by:
- planner
- executor
- patch_gate
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence


REQUIRED_TOOLS = (
    "search",
    "find_symbol",
    "entrypoints",
    "related_files",
)


@dataclass
class KnowledgeGap:
    topic: str
    missing_tools: List[str]
    message: str


class NoGuessingGuard:
    """
    Verifies that sufficient deterministic tools were used
    before allowing planning/patching.
    """

    def __init__(self) -> None:
        self._tool_history: List[str] = []

    def record_tool(self, tool_name: str) -> None:
        """
        Record that a tool was executed.
        """
        self._tool_history.append(tool_name)

    def reset(self) -> None:
        self._tool_history.clear()

    def _missing(self, required: Sequence[str]) -> List[str]:
        return [t for t in required if t not in self._tool_history]

    def check_symbol_resolution(self, symbol: str) -> Optional[KnowledgeGap]:
        """
        Ensure symbol lookup was done before using a symbol.
        """
        missing = self._missing(("find_symbol", "search"))
        if missing:
            return KnowledgeGap(
                topic=f"symbol:{symbol}",
                missing_tools=missing,
                message=(
                    f"Symbol '{symbol}' used without verification. "
                    "Run discovery tools first."
                ),
            )
        return None

    def check_entrypoints(self) -> Optional[KnowledgeGap]:
        """
        Ensure entrypoints were inspected before structural edits.
        """
        missing = self._missing(("entrypoints", "search"))
        if missing:
            return KnowledgeGap(
                topic="entrypoints",
                missing_tools=missing,
                message="Entrypoints not verified before modification.",
            )
        return None

    def check_dependency_context(self, path: str) -> Optional[KnowledgeGap]:
        """
        Ensure dependency context was built before cross-file edits.
        """
        missing = self._missing(("related_files", "dependency_graph"))
        if missing:
            return KnowledgeGap(
                topic=f"dependencies:{path}",
                missing_tools=missing,
                message=(
                    f"Dependencies for '{path}' not inspected "
                    "before modification."
                ),
            )
        return None

    def enforce_or_raise(self, gaps: Sequence[KnowledgeGap]) -> None:
        """
        Raise if any unresolved knowledge gaps exist.
        """
        unresolved = [g for g in gaps if g is not None]
        if not unresolved:
            return

        lines = [
            "No-Guessing policy violation.",
            "Required discovery steps were skipped:",
            "",
        ]

        for g in unresolved:
            lines.append(f"- Topic: {g.topic}")
            lines.append(f"  Missing tools: {', '.join(g.missing_tools)}")
            lines.append(f"  Reason: {g.message}")
            lines.append("")

        raise RuntimeError("\n".join(lines))

    # High-level helpers -----------------------------------------

    def require_symbol_verified(self, symbol: str) -> None:
        gap = self.check_symbol_resolution(symbol)
        if gap:
            self.enforce_or_raise([gap])

    def require_entrypoints_verified(self) -> None:
        gap = self.check_entrypoints()
        if gap:
            self.enforce_or_raise([gap])

    def require_dependencies_verified(self, path: str) -> None:
        gap = self.check_dependency_context(path)
        if gap:
            self.enforce_or_raise([gap])
