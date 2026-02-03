"""
Ollama chat API adapter — zero-cost, local-only.
STRICT: no tools, no actions, no repo access.
Uses /api/chat (messages format), not /api/generate.
"""

import logging
from typing import Any, Dict, List

import requests

logger = logging.getLogger("adjutorix.llm.ollama_chat")


class OllamaChat:
    """
    Ollama /api/chat — messages in, content out.
    Requires: ollama serve (e.g. ollama run mistral).
    """

    def __init__(
        self,
        model: str = "mistral",
        base_url: str = "http://127.0.0.1:11434",
        timeout: int = 60,
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def generate(self, messages: List[Dict[str, str]]) -> str:
        """
        Sync generate from messages. Returns assistant content only.
        """
        url = f"{self.base_url}/api/chat"
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }
        try:
            r = requests.post(url, json=payload, timeout=self.timeout)
            r.raise_for_status()
            data = r.json()
            msg = data.get("message") or {}
            return (msg.get("content") or "").strip()
        except requests.RequestException as e:
            logger.warning("Ollama chat failed: %s", e)
            raise RuntimeError(f"Ollama chat failed: {e}") from e

    def is_available(self) -> bool:
        """Verify Ollama is up and the configured model exists."""
        try:
            r = requests.get(f"{self.base_url}/api/tags", timeout=3)
            r.raise_for_status()
            data = r.json()
            models = [m.get("name") for m in (data.get("models") or [])]
            return any((name or "").startswith(self.model) for name in models)
        except Exception:
            return False
