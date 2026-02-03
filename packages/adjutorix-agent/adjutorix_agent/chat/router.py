"""
Chat router: returns envelope only. No exceptions, no strings. No LLM from chat path.
"""

from __future__ import annotations

import secrets
from typing import Any, Dict, List


class ChatRejectedError(Exception):
    """Legacy; router returns envelope instead of raising."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ChatRouter:
    """Returns envelope only. No LLM. Controller invariant: no freeform prose."""

    def __init__(self, llm=None, cloud_llm=None) -> None:
        self._llm = llm
        self._cloud = cloud_llm

    def chat(self, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        trace_id = secrets.token_hex(8)

        if not messages:
            return {
                "type": "reject",
                "trace_id": trace_id,
                "engine": "none",
                "payload": {"code": "CHAT_REJECTED", "message": "No message received."},
            }

        return {
            "type": "reject",
            "trace_id": trace_id,
            "engine": "none",
            "payload": {
                "code": "CHAT_NOT_AUTHORIZED",
                "message": "Chat not authorized. Use commands (/check /fix /verify) or controller plans.",
            },
        }
