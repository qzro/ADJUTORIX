import logging
from typing import Dict, Any, Optional

from .providers.ollama import OllamaProvider
from .providers.lmstudio import LMStudioProvider
from .providers.llama_cpp import LlamaCppProvider


logger = logging.getLogger("adjutorix.llm.router")


class ModelRoutingError(Exception):
    pass


class ModelRouter:
    """
    Routes requests between fast and strong local models.

    Goal:
    - Use small models for cheap tasks
    - Use big models only for reasoning
    """

    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config

        self.fast_provider = self._init_provider("fast")
        self.strong_provider = self._init_provider("strong")

    # -------------------------
    # Public API
    # -------------------------

    def generate(
        self,
        prompt: str,
        task_type: str,
        max_tokens: int = 2048,
        temperature: float = 0.1,
    ) -> str:
        """
        Main generation entrypoint.
        """

        provider = self._select_provider(task_type)

        logger.debug(
            "Routing task '%s' to %s",
            task_type,
            provider.name,
        )

        return provider.generate(
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def health_check(self) -> Dict[str, bool]:
        """
        Check availability of providers.
        """

        return {
            "fast": self.fast_provider.is_available(),
            "strong": self.strong_provider.is_available(),
        }

    # -------------------------
    # Internals
    # -------------------------

    def _select_provider(self, task_type: str):
        """
        Decide which model to use.
        """

        task_type = task_type.lower()

        if task_type in (
            "search",
            "summarize",
            "classify",
            "lint",
            "format",
            "explain_error",
        ):
            return self.fast_provider

        if task_type in (
            "plan",
            "design",
            "refactor",
            "patch",
            "verify",
            "reason",
        ):
            return self.strong_provider

        # Fallback: prefer fast
        logger.warning("Unknown task type: %s (using fast)", task_type)
        return self.fast_provider

    def _init_provider(self, role: str):
        """
        Initialize provider for role.
        """

        cfg = self.config.get(role, {})

        provider_type = cfg.get("provider", "ollama").lower()

        if provider_type == "ollama":
            return OllamaProvider(cfg)

        if provider_type == "lmstudio":
            return LMStudioProvider(cfg)

        if provider_type == "llama_cpp":
            return LlamaCppProvider(cfg)

        raise ModelRoutingError(
            f"Unknown provider type for {role}: {provider_type}"
        )


# -------------------------
# Helper
# -------------------------


def load_default_router(config_path: Optional[str] = None) -> ModelRouter:
    """
    Load router with default or file-based config.
    """

    import json
    import os

    config: Dict[str, Any] = {}

    if config_path and os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                config = json.load(f)
        except Exception as e:
            logger.error("Failed loading router config: %s", e)

    return ModelRouter(config)
