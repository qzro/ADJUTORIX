#!/usr/bin/env bash
set -e

# ADJUTORIX - ripgrep Installer
# Installs ripgrep (rg) for fast code search

echo "==> Installing ripgrep..."

if command -v rg >/dev/null 2>&1; then
  echo "ripgrep already installed."
  rg --version
  exit 0
fi

OS="$(uname -s)"

if [[ "$OS" == "Linux" ]]; then
  if command -v apt >/dev/null 2>&1; then
    sudo apt update
    sudo apt install -y ripgrep
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y ripgrep
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm ripgrep
  else
    echo "Unsupported Linux package manager."
    exit 1
  fi

elif [[ "$OS" == "Darwin" ]]; then
  if command -v brew >/dev/null 2>&1; then
    brew install ripgrep
  else
    echo "Homebrew not found. Please install Homebrew first."
    exit 1
  fi

else
  echo "Unsupported OS: $OS"
  exit 1
fi

echo "==> Verifying installation..."
rg --version

echo "==> ripgrep installation complete."
echo "Done."
