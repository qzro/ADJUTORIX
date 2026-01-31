"""
workspace.router

Routes agent operations to the correct repository workspace.

Responsibilities:
- Resolve repo name → filesystem path
- Load per-repo policy
- Select toolchain and commands
- Prevent cross-repo contamination
- Enforce single-active-workspace rule
"""

from __future__ import annotations

import os
import yaml
from pathlib import Path
from typing import Dict, Optional, Any

from adjutorix_agent.core.locks import WorkspaceLock
from adjutorix_agent.governance.policy import PolicyLoader


class WorkspaceNotFound(Exception):
    """Raised when a workspace cannot be resolved."""
    pass


class WorkspaceRouter:
    """
    Central workspace resolver.

    Maps logical repo names to physical paths and policies.
    """

    def __init__(
        self,
        config_path: Optional[Path] = None,
    ) -> None:

        if config_path is None:
            config_path = Path.home() / ".agent" / "workspaces.yaml"

        self.config_path = config_path
        self._workspaces: Dict[str, Dict[str, Any]] = {}

        self._lock = WorkspaceLock()

        self._load_config()

    # ---------------------------------------------------------
    # Config loading
    # ---------------------------------------------------------

    def _load_config(self) -> None:
        """
        Load ~/.agent/workspaces.yaml
        """
        if not self.config_path.exists():
            self._workspaces = {}
            return

        with open(self.config_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        self._workspaces = data.get("workspaces", {})

    def reload(self) -> None:
        """Reload workspace configuration."""
        self._load_config()

    # ---------------------------------------------------------
    # Resolution
    # ---------------------------------------------------------

    def list_workspaces(self) -> Dict[str, Dict[str, Any]]:
        """Return all registered workspaces."""
        return dict(self._workspaces)

    def has_workspace(self, name: str) -> bool:
        return name in self._workspaces

    def resolve_path(self, name: str) -> Path:
        """
        Resolve workspace name to absolute path.
        """
        if name not in self._workspaces:
            raise WorkspaceNotFound(f"Unknown workspace: {name}")

        path = Path(self._workspaces[name]["path"]).expanduser()

        if not path.exists():
            raise WorkspaceNotFound(
                f"Workspace path does not exist: {path}"
            )

        return path.resolve()

    def detect_from_path(self, path: Path) -> Optional[str]:
        """
        Detect workspace name from filesystem path.
        """
        path = path.resolve()

        for name, cfg in self._workspaces.items():
            root = Path(cfg["path"]).expanduser().resolve()
            if path == root or root in path.parents:
                return name

        return None

    # ---------------------------------------------------------
    # Policy / Toolchain
    # ---------------------------------------------------------

    def load_policy(self, name: str) -> Dict[str, Any]:
        """
        Load policy for workspace.
        """
        root = self.resolve_path(name)

        loader = PolicyLoader(root)
        return loader.load()

    def get_toolchain(self, name: str) -> str:
        """
        Return declared toolchain (python/node/etc).
        """
        cfg = self._workspaces.get(name)

        if not cfg:
            raise WorkspaceNotFound(name)

        return cfg.get("toolchain", "unknown")

    def get_commands(self, name: str) -> Dict[str, str]:
        """
        Return declared command set (check/fix/deploy/etc).
        """
        cfg = self._workspaces.get(name)

        if not cfg:
            raise WorkspaceNotFound(name)

        return cfg.get("commands", {})

    # ---------------------------------------------------------
    # Locking
    # ---------------------------------------------------------

    def acquire(self, name: str) -> None:
        """
        Lock workspace for exclusive use.
        """
        root = self.resolve_path(name)
        self._lock.acquire(str(root))

    def release(self) -> None:
        """Release workspace lock."""
        self._lock.release()

    def is_locked(self) -> bool:
        return self._lock.is_locked()

    # ---------------------------------------------------------
    # Context Builder
    # ---------------------------------------------------------

    def open_workspace(self, name: str) -> Dict[str, Any]:
        """
        Prepare full execution context for workspace.
        """
        self.acquire(name)

        root = self.resolve_path(name)

        policy = self.load_policy(name)
        toolchain = self.get_toolchain(name)
        commands = self.get_commands(name)

        context = {
            "name": name,
            "root": root,
            "policy": policy,
            "toolchain": toolchain,
            "commands": commands,
        }

        return context

    def close_workspace(self) -> None:
        """Close active workspace."""
        self.release()

    # ---------------------------------------------------------
    # Registration (optional helper)
    # ---------------------------------------------------------

    def register(
        self,
        name: str,
        path: Path,
        toolchain: str = "unknown",
        commands: Optional[Dict[str, str]] = None,
    ) -> None:
        """
        Register a new workspace and persist to config.
        """
        path = path.expanduser().resolve()

        if not path.exists():
            raise WorkspaceNotFound(str(path))

        if commands is None:
            commands = {}

        self._workspaces[name] = {
            "path": str(path),
            "toolchain": toolchain,
            "commands": commands,
        }

        self._persist()

    def unregister(self, name: str) -> None:
        """Remove workspace."""
        if name in self._workspaces:
            del self._workspaces[name]
            self._persist()

    def _persist(self) -> None:
        """
        Write back to ~/.agent/workspaces.yaml
        """
        self.config_path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "workspaces": self._workspaces
        }

        with open(self.config_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False)

    # ---------------------------------------------------------
    # Debug
    # ---------------------------------------------------------

    def describe(self, name: str) -> Dict[str, Any]:
        """
        Return full workspace metadata.
        """
        root = self.resolve_path(name)

        return {
            "name": name,
            "root": str(root),
            "toolchain": self.get_toolchain(name),
            "commands": self.get_commands(name),
            "policy_loaded": (root / ".agent").exists(),
            "locked": self.is_locked(),
        }
