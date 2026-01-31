"""
Tool Registry for Adjutorix

Responsible for:
- Registering tools
- Enforcing allowlist / denylist
- Validating execution policies
- Providing lookup and metadata
"""

from __future__ import annotations

import threading
from typing import Callable, Dict, Any, Optional, List


class ToolError(Exception):
    pass


class ToolNotAllowedError(ToolError):
    pass


class ToolNotFoundError(ToolError):
    pass


class ToolRegistry:
    """
    Central registry for all deterministic tools.
    Thread-safe.
    """

    def __init__(self) -> None:
        self._tools: Dict[str, Callable[..., Any]] = {}
        self._metadata: Dict[str, Dict[str, Any]] = {}

        self._allowlist: Optional[List[str]] = None
        self._denylist: List[str] = []

        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def set_allowlist(self, tools: Optional[List[str]]) -> None:
        """
        Set explicit allowlist.
        If None, all registered tools are allowed (unless denied).
        """
        with self._lock:
            self._allowlist = tools[:] if tools else None

    def set_denylist(self, tools: List[str]) -> None:
        """
        Set denylist (always enforced).
        """
        with self._lock:
            self._denylist = tools[:]

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(
        self,
        name: str,
        handler: Callable[..., Any],
        *,
        description: str = "",
        dangerous: bool = False,
        requires_confirmation: bool = False,
        category: str = "general",
        timeout: Optional[int] = None,
    ) -> None:
        """
        Register a tool.

        Args:
            name: Unique tool name
            handler: Callable implementation
            description: Human description
            dangerous: Whether tool is potentially destructive
            requires_confirmation: UI must confirm before run
            category: Tool category
            timeout: Optional execution timeout (seconds)
        """

        if not name or not isinstance(name, str):
            raise ValueError("Tool name must be a non-empty string")

        if not callable(handler):
            raise ValueError("Tool handler must be callable")

        with self._lock:
            if name in self._tools:
                raise ToolError(f"Tool already registered: {name}")

            self._tools[name] = handler

            self._metadata[name] = {
                "name": name,
                "description": description,
                "dangerous": dangerous,
                "requires_confirmation": requires_confirmation,
                "category": category,
                "timeout": timeout,
            }

    def unregister(self, name: str) -> None:
        with self._lock:
            if name in self._tools:
                del self._tools[name]
                del self._metadata[name]

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------

    def list_tools(self) -> List[str]:
        with self._lock:
            return sorted(self._tools.keys())

    def get_metadata(self, name: str) -> Dict[str, Any]:
        with self._lock:
            if name not in self._metadata:
                raise ToolNotFoundError(name)

            return dict(self._metadata[name])

    def get_handler(self, name: str) -> Callable[..., Any]:
        with self._lock:
            if name not in self._tools:
                raise ToolNotFoundError(name)

            return self._tools[name]

    # ------------------------------------------------------------------
    # Policy Enforcement
    # ------------------------------------------------------------------

    def _check_allowlist(self, name: str) -> None:
        if self._allowlist is None:
            return

        if name not in self._allowlist:
            raise ToolNotAllowedError(
                f"Tool not in allowlist: {name}"
            )

    def _check_denylist(self, name: str) -> None:
        if name in self._denylist:
            raise ToolNotAllowedError(
                f"Tool is denylisted: {name}"
            )

    def _check_policy(self, name: str) -> None:
        self._check_denylist(name)
        self._check_allowlist(name)

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def execute(self, name: str, **kwargs: Any) -> Any:
        """
        Execute a registered tool with policy enforcement.
        """

        with self._lock:
            if name not in self._tools:
                raise ToolNotFoundError(name)

            self._check_policy(name)

            handler = self._tools[name]
            meta = self._metadata[name]

        try:
            return handler(**kwargs)

        except Exception as exc:
            raise ToolError(
                f"Tool '{name}' failed: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def describe(self) -> List[Dict[str, Any]]:
        """
        Return metadata for all registered tools.
        """

        with self._lock:
            return [
                dict(self._metadata[name])
                for name in sorted(self._tools.keys())
            ]

    def is_allowed(self, name: str) -> bool:
        """
        Check whether tool is currently allowed.
        """

        try:
            with self._lock:
                if name not in self._tools:
                    return False

                self._check_policy(name)

            return True

        except ToolNotAllowedError:
            return False

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def validate_all(self) -> None:
        """
        Validate registry integrity.
        Raises ToolError if inconsistent.
        """

        with self._lock:
            for name in self._tools:
                if name not in self._metadata:
                    raise ToolError(
                        f"Missing metadata for tool: {name}"
                    )

            for name in self._metadata:
                if name not in self._tools:
                    raise ToolError(
                        f"Metadata without tool: {name}"
                    )


# ----------------------------------------------------------------------
# Global Registry (singleton)
# ----------------------------------------------------------------------

_GLOBAL_REGISTRY: Optional[ToolRegistry] = None
_REGISTRY_LOCK = threading.Lock()


def get_registry() -> ToolRegistry:
    """
    Get global tool registry instance.
    """

    global _GLOBAL_REGISTRY

    with _REGISTRY_LOCK:
        if _GLOBAL_REGISTRY is None:
            _GLOBAL_REGISTRY = ToolRegistry()

        return _GLOBAL_REGISTRY


def register_tool(
    name: str,
    handler: Callable[..., Any],
    **kwargs: Any,
) -> None:
    """
    Convenience wrapper for global registry.
    """
    get_registry().register(name, handler, **kwargs)


def execute_tool(name: str, **kwargs: Any) -> Any:
    """
    Convenience wrapper for global registry.
    """
    return get_registry().execute(name, **kwargs)


def list_tools() -> List[str]:
    """
    Convenience wrapper for global registry.
    """
    return get_registry().list_tools()
