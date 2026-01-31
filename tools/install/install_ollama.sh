#!/usr/bin/env bash
set -e

# ADJUTORIX - Ollama Installer
# Installs Ollama for local LLM runtime

echo "==> Installing Ollama..."

if command -v ollama >/dev/null 2>&1; then
  echo "Ollama already installed."
  ollama --version
  exit 0
fi

OS="$(uname -s)"

if [[ "$OS" == "Linux" ]]; then
  curl -fsSL https://ollama.com/install.sh | sh
elif [[ "$OS" == "Darwin" ]]; then
  brew install ollama || {
    echo "Homebrew not found. Installing via official script..."
    curl -fsSL https://ollama.com/install.sh | sh
  }
else
  echo "Unsupported OS: $OS"
  exit 1
fi

echo "==> Starting Ollama service..."

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl enable ollama
  sudo systemctl start ollama
else
  ollama serve >/dev/null 2>&1 &
fi

echo "==> Pulling default models..."

ollama pull qwen2.5-coder || true
ollama pull deepseek-coder || true
ollama pull codellama || true

echo "==> Ollama installation complete."
echo "Run: ollama list"
echo "Done."
