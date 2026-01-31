#!/usr/bin/env python3
"""
Adjutorix CLI

Terminal interface for interacting with the local Adjutorix agent.

Usage:
  adjutorix "fix failing tests"
  adjutorix check
  adjutorix verify
  adjutorix deploy
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict

import requests
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax


DEFAULT_AGENT_URL = "http://127.0.0.1:8765/rpc"
DEFAULT_TIMEOUT = 600


console = Console()


class AgentClient:
    def __init__(self, url: str) -> None:
        self.url = url
        self._id = 0

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def call(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
            "params": params,
        }

        try:
            r = requests.post(
                self.url,
                json=payload,
                timeout=DEFAULT_TIMEOUT,
            )
        except requests.RequestException as exc:
            raise RuntimeError(f"Agent connection failed: {exc}") from exc

        if r.status_code != 200:
            raise RuntimeError(f"Agent returned HTTP {r.status_code}")

        data = r.json()

        if "error" in data:
            err = data["error"]
            raise RuntimeError(f"[{err.get('code')}] {err.get('message')}")

        return data["result"]


def _print_json(obj: Any) -> None:
    txt = json.dumps(obj, indent=2, sort_keys=True)
    syntax = Syntax(txt, "json", theme="monokai", line_numbers=False)
    console.print(syntax)


def _banner() -> None:
    console.print(
        Panel.fit(
            "[bold cyan]ADJUTORIX CLI[/bold cyan]\nLocal Agent Interface",
            border_style="cyan",
        )
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="adjutorix",
        description="Adjutorix terminal interface",
    )

    parser.add_argument(
        "command",
        nargs="*",
        help="Natural language instruction or predefined command",
    )

    parser.add_argument(
        "--agent-url",
        default=os.environ.get("ADJUTORIX_AGENT_URL", DEFAULT_AGENT_URL),
        help="Adjutorix agent RPC endpoint",
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Print raw JSON output",
    )

    return parser.parse_args()


def _map_shortcut(cmd: str) -> str:
    shortcuts = {
        "check": "agent.check",
        "fix": "agent.fix",
        "verify": "agent.verify",
        "deploy": "agent.deploy",
        "status": "agent.status",
    }

    return shortcuts.get(cmd, "agent.run")


def _run(client: AgentClient, args: argparse.Namespace) -> int:
    if not args.command:
        raise RuntimeError("No command provided")

    if len(args.command) == 1:
        raw = args.command[0]
    else:
        raw = " ".join(args.command)

    method = _map_shortcut(args.command[0])

    params = {
        "input": raw,
        "cwd": os.getcwd(),
    }

    console.print(f"[dim]→ {method}[/dim]")
    console.print(f"[dim]→ {raw}[/dim]\n")

    result = client.call(method, params)

    if args.json:
        _print_json(result)
        return 0

    status = result.get("status", "unknown")

    if status == "ok":
        console.print("[bold green]✓ Success[/bold green]")
    elif status == "error":
        console.print("[bold red]✗ Failed[/bold red]")
    else:
        console.print(f"[yellow]! {status}[/yellow]")

    summary = result.get("summary")
    if summary:
        console.print("\n[bold]Summary:[/bold]")
        console.print(summary)

    logs = result.get("logs")
    if logs:
        console.print("\n[bold]Logs:[/bold]")
        for line in logs:
            console.print(f"[dim]{line}[/dim]")

    diff = result.get("diff")
    if diff:
        console.print("\n[bold]Patch:[/bold]")
        syntax = Syntax(diff, "diff", theme="monokai", line_numbers=False)
        console.print(syntax)

    return 0


def main() -> None:
    args = _parse_args()

    _banner()

    client = AgentClient(args.agent_url)

    try:
        rc = _run(client, args)
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted[/yellow]")
        sys.exit(130)
    except Exception as exc:
        console.print(f"[bold red]Error:[/bold red] {exc}")
        sys.exit(1)

    sys.exit(rc)


if __name__ == "__main__":
    main()
