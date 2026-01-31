import logging
import subprocess
import json
import tempfile
from typing import Dict, Any, Optional


logger = logging.getLogger("adjutorix.llm.llama_cpp")


class LlamaCppProvider:
    """
    llama.cpp provider (CLI-based).

    Uses llama.cpp main binary to generate completions locally.

    Requires:
      - llama.cpp compiled binary
      - model file (.gguf)

    This avoids HTTP and works fully offline.
    """

    name = "llama_cpp"

    def __init__(self, config: Dict[str, Any]) -> None:
        self.binary: str = config.get("binary", "llama-cli")
        self.model_path: str = config.get("model_path", "")
        self.context_size: int = config.get("context_size", 4096)
        self.threads: int = config.get("threads", 4)
        self.gpu_layers: int = config.get("gpu_layers", 0)
        self.timeout: int = config.get("timeout", 600)

        if not self.model_path:
            raise ValueError("llama_cpp: model_path is required")

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
        Generate text via llama.cpp CLI.
        """

        full_prompt = self._build_prompt(prompt)

        with tempfile.NamedTemporaryFile(
            mode="w+",
            delete=False,
            suffix=".txt",
        ) as f:
            f.write(full_prompt)
            prompt_file = f.name

        cmd = [
            self.binary,
            "-m",
            self.model_path,
            "-f",
            prompt_file,
            "-n",
            str(max_tokens),
            "-c",
            str(self.context_size),
            "--temp",
            str(temperature),
            "-t",
            str(self.threads),
        ]

        if self.gpu_layers > 0:
            cmd.extend(["-ngl", str(self.gpu_layers)])

        logger.debug("llama.cpp command: %s", " ".join(cmd))

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("llama.cpp execution timed out")

        if proc.returncode != 0:
            raise RuntimeError(
                f"llama.cpp failed:\n{proc.stderr}"
            )

        output = proc.stdout.strip()

        return self._extract_response(output)

    def is_available(self) -> bool:
        """
        Check if llama.cpp binary and model are usable.
        """

        try:
            proc = subprocess.run(
                [self.binary, "--help"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if proc.returncode != 0:
                return False

            return bool(self.model_path)

        except Exception:
            return False

    # -------------------------
    # Prompt handling
    # -------------------------

    def _build_prompt(self, user_prompt: str) -> str:
        """
        Wrap prompt in system/user format.
        """

        return f"""### System:
You are a precise software engineering assistant.

### User:
{user_prompt}

### Assistant:
"""

    def _extract_response(self, raw: str) -> str:
        """
        Extract assistant reply from output.
        """

        marker = "### Assistant:"

        if marker in raw:
            return raw.split(marker, 1)[1].strip()

        return raw.strip()

    # -------------------------
    # Metadata
    # -------------------------

    def info(self) -> Dict[str, Any]:
        """
        Provider info.
        """

        return {
            "provider": self.name,
            "binary": self.binary,
            "model_path": self.model_path,
            "context_size": self.context_size,
            "threads": self.threads,
            "gpu_layers": self.gpu_layers,
        }
