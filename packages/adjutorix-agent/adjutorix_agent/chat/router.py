"""
Chat router: UI → ChatRouter → LLM → Transcript.
STRICT: no tools, no actions, no repo access, no git, no ContextBudget, no ToolRegistry.
Multi-model: local first; cloud only if ADJUTORIX_ALLOW_CLOUD=1 (no surprise cost).
"""

import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger("adjutorix.chat.router")


class ChatRouter:
    """
    Routes chat to local LLM (Ollama) or optional cloud LLM.
    Local first; cloud only if ADJUTORIX_ALLOW_CLOUD=1. Default: zero cost.
    """

    def __init__(self, llm: Optional[Any] = None, cloud_llm: Optional[Any] = None) -> None:
        self._llm = llm
        self._cloud = cloud_llm

    def chat(self, messages: List[Dict[str, str]]) -> str:
        """
        Sync chat: messages in, assistant text out.
        Local first; cloud only if explicitly enabled.
        """
        if not messages:
            return "No message received."

        # Local first
        if self._llm is not None and getattr(self._llm, "is_available", None):
            try:
                if self._llm.is_available():
                    return self._llm.generate(messages)
            except Exception as e:
                logger.warning("LLM generate failed, using fallback: %s", e)

        # Cloud only if explicitly enabled (no surprise cost)
        if os.getenv("ADJUTORIX_ALLOW_CLOUD", "0") == "1" and self._cloud is not None:
            try:
                return self._cloud.generate(messages)
            except Exception as e:
                logger.warning("Cloud LLM failed: %s", e)

        # Fail closed / fallback
        last = messages[-1] if messages else {}
        content = (last.get("content") or last.get("message") or "").strip()
        return f"Received: {content[:200]}."
