import logging
import requests
from typing import Dict, Any


logger = logging.getLogger("adjutorix.llm.lmstudio")


class LMStudioProvider:
    """
    LM Studio local OpenAI-compatible provider.

    Requires:
      LM Studio local server enabled
      (usually http://localhost:1234/v1)
    """

    name = "lmstudio"

    def __init__(self, config: Dict[str, Any]) -> None:
        self.base_url: str = config.get(
            "base_url",
            "http://127.0.0.1:1234/v1",
        )
        self.model: str = config.get("model", "local-model")
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
        Generate text using OpenAI-compatible API.
        """

        url = f"{self.base_url}/chat/completions"

        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a precise software engineering assistant.",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }

        headers = {
            "Content-Type": "application/json",
        }

        logger.debug("LM Studio request: %s", self.model)

        try:
            resp = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
        except Exception as e:
            raise RuntimeError(f"LM Studio connection failed: {e}")

        if resp.status_code != 200:
            raise RuntimeError(
                f"LM Studio error {resp.status_code}: {resp.text}"
            )

        data = resp.json()

        try:
            return (
                data["choices"][0]["message"]["content"]
                .strip()
            )
        except Exception:
            raise RuntimeError(
                f"Invalid LM Studio response: {data}"
            )

    def is_available(self) -> bool:
        """
        Check if LM Studio server is alive.
        """

        try:
            resp = requests.get(
                f"{self.base_url}/models",
                timeout=5,
            )
            return resp.status_code == 200
        except Exception:
            return False

    # -------------------------
    # Management
    # -------------------------

    def info(self) -> Dict[str, Any]:
        """
        Return provider info.
        """

        return {
            "provider": self.name,
            "model": self.model,
            "base_url": self.base_url,
        }
