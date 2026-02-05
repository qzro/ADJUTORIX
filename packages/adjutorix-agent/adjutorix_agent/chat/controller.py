"""
Controller: chat returns envelope only. Intent is exactly one of: no_action, propose_patch, propose_job.
Chat is advisory only; jobs and patches are power.
"""

from __future__ import annotations

import secrets
from typing import Any, Dict, List

# Exactly three states for chat output. No free-text pretending to act.
CHAT_INTENT_NO_ACTION = "no_action"
CHAT_INTENT_PROPOSE_PATCH = "propose_patch"
CHAT_INTENT_PROPOSE_JOB = "propose_job"


class Controller:
    """Returns only envelopes: analysis + intent (no_action | propose_patch | propose_job) + payload."""

    def handle(self, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        trace_id = secrets.token_hex(8)
        text = (messages[-1].get("content") if messages else "") or ""
        t = text.strip().lower()

        # Advisory only: suggest job (check/verify), never execute from chat
        if "repo" in t or "status" in t or "failing" in t or "error" in t:
            return {
                "type": "chat_response",
                "trace_id": trace_id,
                "engine": "none",
                "intent": CHAT_INTENT_PROPOSE_JOB,
                "analysis": "Chat cannot act. Use Check/Verify buttons or propose a patch.",
                "payload": {
                    "goal": "Assess repo state via tools (not chat).",
                    "steps": [
                        {"id": "1", "action": "run", "tool": "check"},
                        {"id": "2", "action": "review", "requires": ["check"]},
                        {"id": "3", "action": "run", "tool": "verify", "when": "after patch apply"},
                    ],
                    "commands": ["check", "verify"],
                },
            }

        return {
            "type": "chat_response",
            "trace_id": trace_id,
            "engine": "none",
            "intent": CHAT_INTENT_NO_ACTION,
            "analysis": "Chat cannot act. Use Check/Verify or propose a patch (Accept/Apply).",
            "payload": {
                "message": "Chat cannot act. Use Check/Verify or propose a patch.",
                "suggested": [],
            },
        }
