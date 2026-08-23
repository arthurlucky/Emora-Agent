#!/bin/bash
# install.sh — Installer EMORA Agent
# Pakai: curl -fsSL https://raw.githubusercontent.com/arthurlucky/Emora-Agent/main/install.sh | bash

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   🚀 EMORA Agent — Installer          ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── [1/6] Node.js check ──────────────────────────────────────────────────────
echo -e "${BLUE}[1/6]${NC} Cek Node.js..."
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}❌ Node.js tidak ditemukan.${NC}"
    echo "   Install dulu:"
    echo "   - Termux : pkg install nodejs"
    echo "   - Linux  : https://nodejs.org (atau nvm install 20)"
    echo "   - macOS  : brew install node"
    exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo -e "${RED}❌ Node.js $(node -v) terlalu lama — butuh >= v20.${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node $(node -v)"
echo ""

# ── [2/6] Clone / update repo ────────────────────────────────────────────────
REPO="https://github.com/arthurlucky/Emora-Agent.git"
DIR="Emora-Agent"

if [ -f "package.json" ] && grep -q "emora-agent" package.json 2>/dev/null; then
    echo -e "${BLUE}[2/6]${NC} Update instalasi existing..."
    git pull --rebase 2>/dev/null || echo -e "${YELLOW}⚠${NC} git pull gagal (working tree kotor?) — lanjut dengan kode saat ini"
elif [ -d "$DIR" ]; then
    echo -e "${BLUE}[2/6]${NC} Masuk ke folder $DIR dan update..."
    cd "$DIR"
    git pull --rebase 2>/dev/null || true
else
    echo -e "${BLUE}[2/6]${NC} Clone repository..."
    git clone --depth 1 "$REPO"
    cd "$DIR"
fi
echo -e "${GREEN}✓${NC} Source siap: $(pwd)"
echo ""

# ── [3/6] Dependencies ───────────────────────────────────────────────────────
echo -e "${BLUE}[3/6]${NC} Install dependencies (bisa 1-3 menit)..."
npm install --no-audit --no-fund --loglevel=error || {
    echo -e "${RED}❌ npm install gagal.${NC} Cek error di atas."
    exit 1
}
# Web UI dependencies (terpisah — cors dll tidak ada di root package.json)
if [ -f "webui/package.json" ]; then
    (cd webui && npm install --no-audit --no-fund --loglevel=error 2>/dev/null) \
        && echo -e "${GREEN}✓${NC} Web UI deps OK" \
        || echo -e "${YELLOW}⚠${NC} Web UI deps gagal — 'emora --web' belum bisa dipakai (fitur lain aman)"
fi
echo ""

# ── [4/6] Verifikasi file inti ───────────────────────────────────────────────
echo -e "${BLUE}[4/6]${NC} Verifikasi instalasi..."
MISSING=0
for f in bin/emora.js core/chat.js core/tools.js core/skillRegistry.js \
         provider/index.js setup.js AGENT.md SOUL.md; do
    [ ! -f "$f" ] && echo -e "${RED}❌ $f hilang${NC}" && MISSING=1
done
[ $MISSING -eq 1 ] && exit 1
chmod +x bin/emora.js 2>/dev/null || true
echo -e "${GREEN}✓${NC} Semua file inti ada"
echo ""

# ── [5/6] Link global + health check ─────────────────────────────────────────
echo -e "${BLUE}[5/6]${NC} Pasang command global 'emora'..."
npm link --loglevel=error >/dev/null 2>&1 \
    && echo -e "${GREEN}✓${NC} Command 'emora' tersedia dari folder mana pun" \
    || echo -e "${YELLOW}⚠${NC} npm link gagal — jalankan dengan 'node bin/emora.js' atau coba 'npm link' manual"

echo -e "${BLUE}[5/6]${NC} Health check..."
node bin/emora.js doctor || echo -e "${YELLOW}⚠${NC} Doctor menemukan catatan — baca outputnya"
echo ""

# ── [6/6] Setup wizard ───────────────────────────────────────────────────────
echo -e "${BLUE}[6/6]${NC} Setup awal..."
echo "Wizard interaktif akan jalan sekarang (provider AI, model, gateway)."
echo "Bisa dilewati (Ctrl+C) dan dijalankan belakangan lewat: emora setup"
echo ""
sleep 1
node setup.js || echo -e "${YELLOW}⚠${NC} Setup dilewati — jalankan 'emora setup' kapan saja."

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║  ✅ Instalasi selesai!                     ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "Perintah utama:"
echo "  emora                    TUI interaktif"
echo "  emora repl               REPL ringan"
echo "  emora run \"<prompt>\"     Chat sekali jalan"
echo "  emora -s list            Lihat sesi tersimpan"
echo "  emora -r <id|judul>      Resume sesi"
echo "  emora model list         Profile model tersimpan"
echo "  emora toolset list       Grup tool aktif"
echo "  emora doctor             Diagnosa mandiri"
echo "  emora --help             Semua perintah"
echo ""
