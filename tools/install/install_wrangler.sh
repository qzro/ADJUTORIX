#!/usr/bin/env bash
set -e

# ADJUTORIX - Cloudflare Wrangler Installer
# Installs wrangler CLI for Cloudflare Workers/Pages deployment

echo "==> Installing Cloudflare Wrangler..."

if command -v wrangler >/dev/null 2>&1; then
  echo "Wrangler already installed."
  wrangler --version
  exit 0
fi

OS="$(uname -s)"

if [[ "$OS" == "Linux" || "$OS" == "Darwin" ]]; then

  if command -v npm >/dev/null 2>&1; then
    npm install -g wrangler
  else
    echo "npm not found. Installing Node.js first."

    if [[ "$OS" == "Darwin" ]]; then
      if command -v brew >/dev/null 2>&1; then
        brew install node
      else
        echo "Homebrew not found. Install Homebrew first."
        exit 1
      fi
    else
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt install -y nodejs
    fi

    npm install -g wrangler
  fi

else
  echo "Unsupported OS: $OS"
  exit 1
fi

echo "==> Verifying installation..."
wrangler --version

echo "==> Wrangler installation complete."
echo "Run: wrangler login"
echo "Done."
