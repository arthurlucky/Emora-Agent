<div align="center">

```
███████╗███╗   ███╗ ██████╗ ██████╗  █████╗
██╔════╝████╗ ████║██╔═══██╗██╔══██╗██╔══██╗
█████╗  ██╔████╔██║██║   ██║██████╔╝███████║
██╔══╝  ██║╚██╔╝██║██║   ██║██╔══██╗██╔══██║
███████╗██║ ╚═╝ ██║╚██████╔╝██║  ██║██║  ██║
╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
```

**Autonomous AI Agent — Self-hosted · Multi-platform · Multi-provider**

[![Node.js](https://img.shields.io/badge/Node.js-≥20-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](./LICENSE)

</div>

---

## Apa itu EMORA?

EMORA adalah AI agent otonom yang bisa kamu host sendiri (self-hosted). Dia bisa dipakai dari CLI, Telegram, WhatsApp, atau browser (Web UI) — semua dari satu proses Node.js.

**Fitur utama:**
- 🤖 **Agent loop** dengan tool calling (shell, file, git, web search, scheduler, dsb)
- 📡 **Multi-gateway** — Telegram + WhatsApp berjalan paralel dalam satu proses
- 🧠 **Skill system** — kemampuan terstruktur yang otomatis dipakai tanpa perlu diperintah
- 🏭 **Skill Factory** — EMORA bisa membuat skill baru secara otomatis dari pola penggunaan
- 🔌 **Multi-provider** — Groq, Gemini, Anthropic, OpenRouter, NVIDIA, HuggingFace, Ollama
- 🌐 **Web UI** — panel kontrol sesi, gateway, dan system prompt di browser
- 🖥️ **MCP server** — expose semua tools EMORA ke Claude Desktop / Cursor / Windsurf

---

## Persyaratan

- **Node.js ≥ 20** (rekomendasi: LTS terbaru)
- **npm ≥ 9**
- API key dari provider AI pilihan kamu (lihat bagian Setup)

---

## Instalasi

### Opsi A — Clone langsung (development)

```bash
git clone https://github.com/arthurlucky/Emora-Agent.git
cd Emora-Agent
npm install
```

### Opsi B — Global binary (`emora` di mana saja)

```bash
git clone https://github.com/arthurlucky/Emora-Agent.git
cd Emora-Agent
npm install
npm install -g .
```

Setelah install global, semua subcommand `emora` bisa dijalankan dari direktori mana pun.

---

## Setup Cepat

```bash
emora setup
```

atau kalau belum install global:

```bash
node setup.js
```

Wizard interaktif akan membimbing kamu melalui:
1. Pilih provider AI (arrow key ↑↓ + Enter)
2. Masukkan API key
3. Pilih model
4. Setup gateway Telegram / WhatsApp (opsional)
5. Aktifkan Web UI (opsional)

---

## Konfigurasi Manual (.env)

Kalau mau konfigurasi tanpa wizard, buat file `.env` di root project:

```env
# ── Provider & Model ─────────────────────────────
# Pilih salah satu: groq | gemini | openrouter | nvidia | openai | anthropic | huggingface | ollama
MODEL_PROVIDER=groq

# API key untuk provider yang dipilih
MODEL_API=gsk_xxxxxxxxxxxxxxxxxxxxxxxx

# Nama model
MODEL_NAME=llama-3.3-70b-versatile

# URL endpoint (opsional — auto-diisi oleh provider system)
# MODEL_URL=https://api.groq.com/openai/v1

# ── Khusus Anthropic ─────────────────────────────
# ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxx

# ── Khusus HuggingFace ───────────────────────────
# HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxx
# HUGGINGFACE_ENDPOINT_URL=   # opsional: dedicated HF endpoint

# ── Web Search (opsional) ─────────────────────────
TAVILY_API_KEY=tvly-xxxxxxxxxx

# ── Gateway Telegram ─────────────────────────────
TELEGRAM_GATEWAY=false
TELEGRAM_TOKEN_BOT=
TELEGRAM_ALLOWED_IDS=        # kosong = semua user bisa chat

# ── Gateway WhatsApp ─────────────────────────────
WA_GATEWAY=false
WA_PHONE_NUMBER=             # format: 6281234567890
WA_ALLOWED_NUMBERS=          # kosong = semua nomor bisa chat

# ── Identitas Agent ───────────────────────────────
NAME=Emora

# ── Web UI ────────────────────────────────────────
WEBUI=false
WEBUI_PORT=5090

# ── EMORA Hub ─────────────────────────────────────
EMORA_HUB=https://emora-hub--rellaja1214.replit.app
```

---

## Penggunaan

### CLI Commands

| Command | Deskripsi |
|---|---|
| `emora` | Jalankan CLI agent |
| `emora setup` | Setup wizard interaktif |
| `emora model` | Ganti model / provider |
| `emora gateway` | Jalankan gateway saja (tanpa CLI) |
| `emora send "pesan"` | Kirim pesan one-shot ke Telegram/WhatsApp |
| `emora status` | Tampilkan status semua komponen |
| `emora skills` | Browse & kelola skill |
| `emora mcp` | Manage MCP server |
| `emora --web` | CLI + Web UI |
| `emora --version` | Versi EMORA |
| `emora --help` | Tampilkan bantuan |

### Menjalankan EMORA

```bash
# CLI saja
emora

# CLI + Web UI (buka http://localhost:5090 setelah jalan)
emora --web

# Gateway saja (tanpa CLI — untuk server/VPS)
emora gateway

# Jalankan tanpa install global
node main.js
node main.js --web
```

### Slash Commands di dalam CLI

| Command | Deskripsi |
|---|---|
| `/new` | Buat sesi baru |
| `/sesi` | Tampilkan sesi aktif |
| `/sesi <uuid>` | Pindah ke sesi tertentu |
| `/sesilist` | Daftar semua sesi |
| `/sesiinfo <uuid>` | Detail info satu sesi |
| `/sesidel <uuid>` | Hapus satu sesi |
| `/clear` | Hapus sesi aktif + mulai baru |
| `/help` | Tampilkan panel bantuan |
| `/exit` | Keluar dari EMORA |

---

## Web UI

Bangun dan jalankan panel kontrol berbasis browser:

```bash
# Install dependency frontend
npm run webui:install

# Build frontend (wajib dilakukan sekali sebelum pakai)
npm run webui:build

# Jalankan EMORA dengan Web UI
emora --web
# → Buka http://localhost:5090
```

**Fitur Web UI:**
- Manajemen sesi chat (buat, rename, hapus)
- Chat langsung dengan Emora di browser
- Toggle & konfigurasi gateway Telegram/WhatsApp
- Editor AGENT.md dan SOUL.md langsung dari browser

---

## Gateway Setup

### Telegram

1. Chat ke `@BotFather` di Telegram → `/newbot` → ikuti instruksi
2. Copy token bot
3. Jalankan `emora setup` → pilih **Messaging Gateway** → **Telegram**
4. Paste token, isi allowed user ID (bisa dari `@userinfobot`)
5. Restart EMORA: `emora` atau `emora gateway`

### WhatsApp

1. Jalankan `emora setup` → pilih **Messaging Gateway** → **WhatsApp**
2. Masukkan nomor WhatsApp kamu (format: `6281234567890`)
3. Jalankan `emora gateway`
4. Saat pertama kali, EMORA akan menampilkan **Pairing Code** di terminal
5. Buka WhatsApp di HP → **Setelan** → **Perangkat Tertaut** → **Tautkan perangkat** → masukkan kode

---

## Provider AI

EMORA mendukung banyak provider. Gunakan `emora model` untuk ganti kapan saja.

| Provider | Tier | Tool Calling | Catatan |
|---|---|---|---|
| **Groq** | Gratis | ✅ | Paling cepat, highly recommended |
| **Google Gemini** | Gratis | ✅ | Kuota lumayan, stabil |
| **OpenRouter** | Gratis/Bayar | ✅ | Banyak pilihan model gratis |
| **NVIDIA NIM** | Gratis | ✅ | Enterprise models |
| **HuggingFace** | Gratis/Pro | ⚠️ | Hanya model tertentu support tool |
| **Anthropic** | Bayar | ✅ | Claude — terbaik untuk agent |
| **OpenAI** | Bayar | ✅ | GPT-4o |
| **Ollama** | Gratis (lokal) | ✅ | Jalankan model di device sendiri |

### Anthropic (butuh install tambahan)

```bash
npm install @langchain/anthropic
emora model   # pilih Anthropic
```

---

## Skill System

EMORA punya sistem skill — kumpulan panduan terstruktur yang dipakai secara **otomatis** tanpa perlu diperintah. Setiap kali user meminta sesuatu yang cocok dengan deskripsi skill, EMORA akan membacanya dan mengikuti workflownya diam-diam.

Skill tersedia saat ini:

| Skill | Deskripsi |
|---|---|
| `auto_code_reviewer` | Audit kode: bug, keamanan, best practice |
| `auto_generate_tools` | Buat tool baru untuk EMORA otomatis |
| `api_integration_helper` | Integrasikan API pihak ketiga |
| `env_config_auditor` | Audit keamanan konfigurasi & .env |
| `changelog_generator` | Buat CHANGELOG.md dari riwayat git |
| `scheduled_backup_setup` | Setup backup terjadwal otomatis |
| `dependency_health_check` | Cek dependency: versi usang, CVE |
| `log_triage` | Analisis log error & rekomendasi fix |
| `markdown_report_writer` | Tulis laporan/dokumentasi teknis |
| `bulk_file_organizer` | Organisir file secara massal |
| `website_health_check` | Cek uptime, SSL, response time endpoint |
| `group_broadcast_announcer` | Broadcast pengumuman ke grup WA/TG |
| `react_uiux` | Panduan UI/UX untuk React.js |
| `random_file_gen` | Buat file random untuk testing |

### Kelola Skill via CLI

```bash
emora skills              # menu interaktif
emora skills list         # daftar semua skill
emora skills audit        # audit kelengkapan skill
```

---

## emora send — One-shot Messaging

Kirim pesan ke Telegram/WhatsApp dari shell script, cron job, atau CI/CD tanpa membuka agent loop:

```bash
# Kirim ke platform aktif (auto-detect)
emora send "Deploy berhasil ✅"

# Kirim ke Telegram spesifik
emora send --to=telegram "Server restart selesai"

# Kirim ke nomor WhatsApp tertentu
emora send --to=whatsapp --number=6281234567890 "Hei dari bot"

# Pipe stdout/stderr ke Telegram
df -h | emora send --to=telegram
cat /var/log/nginx/error.log | tail -20 | emora send --to=telegram

# Dari cron job (contoh di crontab)
# 0 8 * * * emora send "Selamat pagi! Cek dashboard 👋" --to=telegram
```

---

## MCP Server (Model Context Protocol)

EMORA bisa berjalan sebagai MCP server, mengekspose semua tools-nya ke Claude Desktop, Cursor, Windsurf, atau MCP client lainnya.

```bash
# Setup MCP
emora mcp

# Jalankan sebagai MCP server (stdio)
emora mcp serve
```

**Tambahkan ke Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "emora": {
      "command": "emora",
      "args": ["mcp", "serve"]
    }
  }
}
```

---

## Struktur Project

```
Emora-Agent/
├── bin/
│   └── emora.js              ← CLI entrypoint binary
├── cli/
│   ├── select.js             ← Arrow-key menu utility
│   ├── cmd-model.js          ← emora model
│   ├── cmd-gateway.js        ← emora gateway
│   ├── cmd-send.js           ← emora send
│   ├── cmd-status.js         ← emora status
│   ├── cmd-skills.js         ← emora skills
│   └── cmd-mcp.js            ← emora mcp
├── core/
│   ├── chat.js               ← Agent loop utama
│   ├── tools.js              ← Registrasi semua tools
│   ├── memory.js             ← Manajemen memori sesi
│   ├── cmd.js                ← Slash command handler
│   └── sessionStore.js       ← Metadata sesi (nama, timestamp)
├── gateway/
│   ├── index.js              ← Gateway orchestrator
│   ├── sessionContext.js     ← Context platform/grup/admin
│   ├── telegram/             ← Telegram gateway (Telegraf)
│   └── whatsapp/             ← WhatsApp gateway (Baileys)
├── provider/
│   ├── index.js              ← Provider registry & factory
│   ├── openai_compat.js      ← Groq, Gemini, OpenRouter, OpenAI, NVIDIA, Ollama
│   ├── anthropic.js          ← Anthropic Claude
│   └── huggingface.js        ← HuggingFace Inference API
├── tools/                    ← Semua tool EMORA (shell, file, git, dsb)
├── skill/                    ← Skill library (auto-loaded ke system prompt)
├── memory/                   ← Session memory (JSON per sesi)
├── webui/                    ← Web UI (Vite + vanilla JS)
├── utils/                    ← Helper utilities
├── AGENT.md                  ← Instruksi perilaku agent
├── SOUL.md                   ← Persona & gaya komunikasi
├── setup.js                  ← Setup wizard
└── main.js                   ← CLI agent loop
```

---

## Tools yang Tersedia

| Tool | Fungsi |
|---|---|
| `shell_exec` | Jalankan command shell |
| `read_file` / `write_file` | Baca & tulis file |
| `list_files` | Daftar isi folder |
| `search_text` | Cari teks di semua file project |
| `find_folder` | Temukan folder berdasarkan nama |
| `create_folder` / `delete_folder` | Manajemen direktori |
| `search_web` | Web search via Tavily |
| `fetch_page` | Ambil konten halaman web |
| `datetime` | Info waktu & tanggal |
| `project_manager` | Planning & tracking task multi-langkah |
| `scheduler` | Jadwalkan task berulang |
| `git_manager` | Operasi git (add, commit, push, log, dsb) |
| `zip_compress` / `zip_extract` | Kompresi & ekstraksi file |
| `backup_manager` | Backup & restore folder/file |
| `system_monitor` | Info CPU, RAM, disk |
| `skill_factory` | Buat & kelola skill EMORA |
| `group_manager` | Manajemen grup Telegram/WhatsApp |
| `economy_manager` | Sistem ekonomi virtual |
| `emora_hub` | Sinkronisasi dengan EMORA Hub |

---

## FAQ

**Q: EMORA bisa dipakai gratis?**
Ya. Gunakan Groq atau Google Gemini — keduanya gratis dan support tool calling dengan baik.

**Q: Apakah EMORA perlu koneksi internet terus?**
Hanya untuk API call ke provider AI dan gateway (Telegram/WhatsApp). Kalau pakai Ollama, bisa fully offline kecuali gateway-nya.

**Q: Kenapa slash command `/clear` hanya hapus sesi saya, bukan semua?**
Ini disengaja (diperbaiki dari bug lama). `/clear` hanya menghapus sesi aktif kamu — tidak akan mengganggu sesi pengguna lain yang chat dari Telegram/WhatsApp.

**Q: Bagaimana cara update skill tanpa restart?**
Skill baru langsung aktif tanpa restart — katalog skill di-generate ulang di setiap pesan baru. Cukup buat skill via `skill_factory` atau tulis folder skill baru, dan langsung bisa dipakai.

---

## Lisensi

MIT License — lihat [LICENSE](./LICENSE)

---

<div align="center">
Built with ❤️ by arthurlucky
</div>
