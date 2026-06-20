#!/bin/bash

set -e

clear

# -------------------------
# Banner EMORA
# -------------------------
if ! command -v figlet >/dev/null 2>&1; then
  echo "[INFO] Installing figlet..."
  sudo apt update && sudo apt install figlet -y
fi

figlet EMORA
echo "======================================"
echo "  EMORA Installer Script"
echo "======================================"
echo ""

# -------------------------
# Update system basic tools
# -------------------------
echo "[INFO] Updating system..."
sudo apt update -y
sudo apt install -y curl git

# -------------------------
# Install Ollama
# -------------------------
echo ""
echo "[INFO] Checking Ollama..."

if command -v ollama >/dev/null 2>&1; then
  echo "[OK] Ollama already installed: $(ollama --version)"
else
  curl -fsSL https://ollama.com/install.sh | sh
  echo "[OK] Ollama installed"
fi

# -------------------------
# Install Node.js Latest
# -------------------------
echo ""
echo "[INFO] Checking Node.js..."

if command -v node >/dev/null 2>&1; then
  echo "[OK] Node already installed: $(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "[OK] Node.js installed"
fi

# -------------------------
# Clone Repository
# -------------------------
echo ""
echo "[INFO] Cloning EMORA Agent..."

if [ -d "emora" ]; then
  echo "[WARN] Folder 'emora' sudah ada, skip clone"
else
  git clone https://github.com/arthurlucky/Emora-Agent.git
  cd Emora-Agent
  mv Emora-Agent emora 2>/dev/null || true
fi

# kalau folder beda nama repo
if [ -d "Emora-Agent" ]; then
  cd Emora-Agent
fi

echo "[OK] Repo ready"

# -------------------------
# Final Check
# -------------------------
echo ""
echo "======================================"
echo "  INSTALLATION COMPLETE"
echo "======================================"

echo "Ollama: $(ollama --version 2>/dev/null || echo 'not found')"
echo "Node:   $(node -v 2>/dev/null || echo 'not found')"
echo "NPM:    $(npm -v 2>/dev/null || echo 'not found')"

echo ""
echo "[DONE] EMORA siap digunakan"