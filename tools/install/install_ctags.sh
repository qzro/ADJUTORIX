#!/usr/bin/env bash
set -e

# ADJUTORIX - Universal Ctags Installer
# Installs universal-ctags for code indexing

echo "==> Installing universal-ctags..."

if command -v ctags >/dev/null 2>&1; then
  echo "ctags already installed."
  ctags --version || true
  exit 0
fi

OS="$(uname -s)"

if [[ "$OS" == "Linux" ]]; then
  if command -v apt >/dev/null 2>&1; then
    sudo apt update
    sudo apt install -y universal-ctags
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y universal-ctags
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm ctags
  else
    echo "Unsupported Linux package manager."
    exit 1
  fi

elif [[ "$OS" == "Darwin" ]]; then
  if command -v brew >/dev/null 2>&1; then
    brew install universal-ctags
  else
    echo "Homebrew not found. Please install Homebrew first."
    exit 1
  fi

else
  echo "Unsupported OS: $OS"
  exit 1
fi

echo "==> Verifying installation..."
ctags --version || true

echo "==> universal-ctags installation complete."
echo "Done."
