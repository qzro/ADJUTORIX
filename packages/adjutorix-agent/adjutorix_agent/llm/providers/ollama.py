import json
import logging
import requests
from typing import Dict, Any, Optional


logger = logging.getLogger("adjutorix.llm.ollama")


class OllamaProvider:
    """
    Ollama local LLM provider.

    Requires:
      ollama serve
    running locally.
    """

    name = "ollama"

    def __init__(self, config: Dict[str, Any]) -> None:
        self.base_url: str = config.get("base_url", "http://127.0.0.1:11434")
        self.model: str = config.get("model", "qwen2.5-coder")
        self.timeout: int = config.get("timeout", 300)

    # -------------------------
    # Public API
    # -------------------------

    def generate(
        self,
        prompt: str,
        max_tokens: int = 2048,
        temperature: float = 0.1,
    ) -> str:
        """
        Generate text using Ollama API.
        """

        url = f"{self.base_url}/api/generate"

        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        logger.debug("Ollama request: %s", self.model)

        try:
            resp = requests.post(
                url,
                json=payload,
                timeout=self.timeout,
            )
        except Exception as e:
            raise RuntimeError(f"Ollama connection failed: {e}")

        if resp.status_code != 200:
            raise RuntimeError(
                f"Ollama error {resp.status_code}: {resp.text}"
            )

        data = resp.json()

        return data.get("response", "").strip()

    def is_available(self) -> bool:
        """
        Check if Ollama server is alive.
        """

        try:
            resp = requests.get(
                f"{self.base_url}/api/tags",
                timeout=5,
            )
            return resp.status_code == 200
        except Exception:
            return False

    # -------------------------
    # Management
    # -------------------------

    def pull_model(self) -> None:
        """
        Pull model if missing.
        """

        url = f"{self.base_url}/api/pull"

        payload = {"name": self.model}

        try:
            requests.post(url, json=payload, timeout=self.timeout)
            logger.info("Pulled Ollama model: %s", self.model)
        except Exception as e:
            logger.error("Failed pulling model: %s", e)

    def info(self) -> Dict[str, Any]:
        """
        Return provider info.
        """

        return {
            "provider": self.name,
            "model": self.model,
            "base_url": self.base_url,
        }
