"""
Controller: deterministic routing for chat. No LLM. Plan / questions_needed / reject only.
"""

from __future__ import annotations

import secrets
from typing import Any, Dict, List


class Controller:
    """Tool-first controller. Emits plan, questions_needed, or reject only."""

    def handle(self, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        trace_id = secrets.token_hex(8)
        text = (messages[-1].get("content") if messages else "") or ""
        t = text.strip().lower()

        # Deterministic routing (no LLM)
        if "repo" in t or "status" in t or "failing" in t or "error" in t:
            return {
                "type": "plan",
                "trace_id": trace_id,
                "engine": "none",
                "payload": {
                    "goal": "Assess repo state via tools (not chat).",
                    "steps": [
                        {"id": "1", "action": "run", "tool": "check"},
                        {"id": "2", "action": "review", "requires": ["check"]},
                        {"id": "3", "action": "run", "tool": "verify", "when": "after fix"},
                    ],
                    "commands": ["/check", "/fix", "/verify"],
                },
            }

        return {
            "type": "questions_needed",
            "trace_id": trace_id,
            "engine": "none",
            "payload": {
                "message": "Use /cap for commands or describe the target outcome as a controller request.",
                "suggested": [
                    "What should /check include?",
                    "What actions are allowed?",
                    "What is the failure mode?",
                ],
            },
        }
