#!/bin/bash

set -e

echo "======================================"
echo "  Installer EMORA"
echo "======================================"

# Detect OS
if ! command -v curl >/dev/null 2>&1; then
  echo "[INFO] Installing curl..."
  sudo apt update && sudo apt install curl -y
fi

# -------------------------
# Install Ollama
# -------------------------
echo ""
echo "[INFO] Installing Ollama..."

if command -v ollama >/dev/null 2>&1; then
  echo "[OK] Ollama sudah terinstall: $(ollama --version)"
else
  curl -fsSL https://ollama.com/install.sh | sh
  echo "[OK] Ollama selesai diinstall"
fi

# -------------------------
# Install Node.js Latest
# -------------------------
echo ""
echo "[INFO] Installing Node.js latest..."

if command -v node >/dev/null 2>&1; then
  echo "[INFO] Node sudah ada: $(node -v)"
else
  # Install NodeSource (latest LTS)
  curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
  sudo apt-get install -y nodejs

  echo "[OK] Node installed"
fi

# -------------------------
# Verifikasi
# -------------------------
echo ""
echo "======================================"
echo "VERIFIKASI INSTALL"
echo "======================================"

echo -n "Ollama: "
ollama --version || echo "not found"

echo -n "Node: "
node -v || echo "not found"

echo -n "NPM: "
npm -v || echo "not found"

echo ""
echo "[DONE] Semua proses selesai"