# Chat pipeline: UI → ChatRouter → LLM → Transcript
# STRICT: no tools, no actions, no repo access, no git, no ContextBudget, no ToolRegistry

from .router import ChatRouter

__all__ = ["ChatRouter"]
