# 🌟 EMORA — Autonomous AI Agent

![CI](https://github.com/arthurlucky/Emora-Agent/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
[![Changelog](https://img.shields.io/badge/changelog-CHANGELOG.md-orange)](./CHANGELOG.md)


## 1. Penjelasan EMORA

EMORA adalah AI agent **autonomous** dan **self-hosted**: jalan di mesin/server milikmu sendiri (bukan layanan cloud pihak ketiga), bisa terhubung ke banyak channel komunikasi sekaligus (Telegram, WhatsApp, Discord, Slack, Matrix), punya sistem skill & plugin yang bisa terus berkembang, dan bisa disambungkan ke tool eksternal lewat **MCP (Model Context Protocol)** — standar terbuka yang sama dipakai Claude Desktop/Claude Code.

Tiga cara utama berinteraksi dengan EMORA — semuanya berbagi *engine* yang sama, jadi skill/plugin/memori yang sama berlaku di mana pun kamu ngobrol:

1. **TUI** (`emora`) — antarmuka terminal interaktif untuk dipakai langsung dari CLI.
2. **Gateway** (`emora gateway run`) — EMORA nempel ke Telegram/WhatsApp/Discord/Slack/Matrix, siapa pun (atau kamu dari HP) bisa chat ke bot-nya.
3. **Web UI** (`emora --web`) — dashboard browser untuk memantau & mengontrol EMORA secara visual.

> 📖 **Panduan pemakaian lengkap** (semua perintah, tiap fitur, troubleshooting) ada di [`skill/guide-emora/skill.md`](./skill/guide-emora/skill.md) — dokumen itu juga otomatis jadi pengetahuan EMORA sendiri, jadi kamu bisa langsung tanya EMORA *"jelasin cara pakai kamu"* dan dia baca file yang sama.

---

## 2. Fitur Unggulan

### 🧠 Knowledge Library (RAG internal)
Basis pengetahuan permanen milik EMORA sendiri di folder `library/`, dengan indeks pencarian otomatis (TF-IDF) — jadi EMORA bisa **menyimpan dan mencari pengetahuan lintas-sesi tanpa terhalang *token limit* LLM**. Alurnya: `check` (cari dulu di library sebelum browsing web) → `collect` (kumpulkan info baru dari web search kalau belum ada) → `write` (simpan setelah diverifikasi, lewat pipeline validasi) → `read`/`read_latest` (ambil lagi kapan saja). Hasilnya, EMORA makin lama makin "pintar" soal topik yang sering ditanyakan, bukan mulai dari nol tiap sesi baru.

### 🧩 Sistem Plugin Terstandardisasi
Format plugin sama seperti Claude Code/Codex/Hermes Agent (`skills/`, `commands/`, `hooks/`, `.mcp.json`) — plugin pihak ketiga dari GitHub bisa langsung dipasang lewat `emora plugin install <url>` tanpa modifikasi apa pun. Mendukung plugin yang punya perilaku "selalu aktif" lewat hooks (`SessionStart`/`UserPromptSubmit`), dengan mekanisme *trust* eksplisit sebelum hook dieksekusi (keamanan seperti Claude Code).

### ⌨️ Manual Skill/Command Invocation
Semua skill (bawaan atau plugin) bisa dipanggil langsung lewat `/<nama>` atau `/<plugin>:<nama>`, konsisten di **semua** antarmuka — TUI maupun tiap gateway — mengikuti konvensi Claude Code/Antigravity CLI.

### 🔌 MCP Client
Sambungkan EMORA ke server MCP eksternal (transport `stdio` maupun `HTTP/Streamable`), termasuk integrasi siap-pakai ke **Obsidian** (`emora obsidian setup`) — baca/tulis/cari catatan langsung dari vault Obsidian kamu.

### 🌐 Multi-Gateway
Telegram, WhatsApp, Discord, Slack, dan Matrix — aktif bersamaan dari satu instalasi, satu memori/skill/plugin yang sama di semuanya.

### ⚡ Web UI (SPA)
Dashboard kontrol berbasis browser dengan *Server-Sent Events* untuk melihat proses berpikir EMORA (pemanggilan tool, progress) secara real-time.

### ⏱️ Cron Scheduler & 🕵️ Web Research
Jadwalkan EMORA menjalankan tugas berkala lewat `/cron` dari chat manapun, plus pencarian web (Tavily) & scraping halaman langsung untuk jawaban yang selalu up-to-date.

### 🏢 Multi-Bot Enterprise Mesh (`emora bot`)
Pecahan agent spesialis dengan kustomisasi nama, peran (persona), warna tampilan (coloris), serta daftar tools & skills. Bot dapat membentuk **grup/departemen perusahaan** dan **saling mendelegasikan tugas** secara otomatis layaknya struktur organisasi profesional.

### 🌐 Global Skills Discovery
EMORA secara otomatis memindai dan mendaftarkan skill global dari seluruh direktori sistem pengguna (`~/.emora/skills/`, `~/.agents/skills/`, `~/.gemini/skills/`, dan `~/.gemini/antigravity-cli/builtin/skills/`) yang dapat langsung digunakan via slash command (`/global:<skill>` atau `/<skill>`).

### 📡 Multi-Protocol Live Scan & Custom Endpoints
Mendukung *auto-probing* live model untuk endpoint custom lokal atau remote (Ollama `/api/tags`, OpenAI-compat `/v1/models`, Anthropic Claude dengan header `x-api-key` & `anthropic-version`, Groq, dan Gemini).

### 🤖 Multi-Provider + Model Profiles & Windowed Navigation
Groq, Google Gemini, OpenRouter (422+ model live), NVIDIA NIM, HuggingFace, Anthropic, OpenAI, Ollama (lokal), atau custom endpoint (LM Studio/vLLM). Simpan banyak konfigurasi sebagai **profile** (`★`) di urutan paling atas menu, lengkap dengan navigasi tombol pintas `ESC` (kembali) dan `CTRL+C` (keluar).

---

## 3. Struktur Folder

```text
EMORA/
├── core/
│   ├── chat.js             # Engine LLM utama (ask())
│   ├── tools.js             # Registrasi tool bawaan
│   ├── pluginManager.js     # Loader plugin (skills/commands/hooks/tools/.mcp.json)
│   ├── pluginHooks.js       # Eksekusi hook plugin (SessionStart/UserPromptSubmit)
│   ├── skillRegistry.js     # Katalog terpadu skill bawaan + plugin
│   └── cmd.js                # Parser slash command inti
├── tools/                   # Tool bawaan (knowledge_library, search_web, git_manager, dll)
├── gateway/
│   ├── manager.js           # Gateway Manager terpusat
│   ├── config.js             # Config multi-platform (gateways.config.json)
│   ├── telegram/ whatsapp/ discord/ slack/ matrix/
│   └── cron/                 # Sistem penjadwalan cron
├── mcp/                     # MCP client (stdio & HTTP/Streamable transport)
├── skill/                   # Skill bawaan (satu folder = satu skill)
│   ├── SKILL.md              # Panduan menulis skill & format plugin
│   └── guide-emora/          # Panduan pemakaian EMORA end-to-end
├── plugins/                  # Plugin eksternal ter-install (emora plugin install)
├── library/                  # Data Knowledge Library (RAG) — lihat bagian 2
├── memory/                   # Riwayat sesi percakapan per channel
├── webui/                    # Dashboard React SPA + Express server
├── cli/                      # Implementasi tiap sub-command `emora ...`
├── provider/                 # Adapter tiap provider AI (Groq/Gemini/OpenAI/dll)
├── setup.js                  # Wizard setup interaktif (emora setup)
├── install.sh                # Installer (lihat bagian 4)
└── bin/emora.js               # CLI entry point
```

---

## 4. Instalasi

Install langsung lewat `curl` + `install.sh` dari repo GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/arthurlucky/Emora-Agent/main/install.sh | bash
```

Skrip ini otomatis:
1. Mengecek apakah EMORA sudah pernah terpasang di device ini — clone repo kalau belum ada, atau update (`git pull`) kalau sudah.
2. Menyiapkan semua dependency yang dibutuhkan: **Node.js** (≥ v20), **npm** (selalu di-upgrade ke versi terbaru), dan seluruh **package** proyek (`npm install` lalu `npm update`), plus opsional Ollama untuk model lokal.
3. Memastikan `bin/emora.js` executable di platform yang kamu pakai (Linux/macOS/Termux otomatis lewat `chmod +x`; native Windows dilewati dengan aman karena `npm link` sudah membuat wrapper `.cmd` sendiri).
4. Menjalankan **wizard setup interaktif** EMORA di akhir (provider AI, gateway, dll) — bisa dilewati dan dijalankan belakangan lewat `emora setup`.

Repo: **https://github.com/arthurlucky/Emora-Agent.git**

**Manual** (kalau sudah punya foldernya sendiri):
```bash
cd emora
npm install && npm update
cp .env.example .env
npm link            # opsional — biar bisa panggil 'emora' dari folder mana pun
emora setup          # wizard interaktif: provider AI, gateway, dll
```

Butuh Node.js **v20+**. Cek versi: `node -v`.

**Windows tanpa WSL/Git Bash:** `install.sh` adalah skrip bash — di cmd.exe/PowerShell murni jalankan lewat [Git for Windows](https://git-scm.com/download/win) (sudah termasuk Git Bash) atau [WSL](https://learn.microsoft.com/windows/wsl/install), lalu jalankan perintah `curl` di atas dari sana.

---

## 🛠️ Menjalankan EMORA

| Perintah | Fungsi |
|---|---|
| `emora` | Buka TUI interaktif (default) |
| `emora repl` | REPL ringan ala Hermes (prompt `>`, multi-line) |
| `emora run "<prompt>"` | Chat sekali jalan — jawab lalu keluar |
| `emora -r <id\|judul>` | Resume sesi (by UUID, prefix ID, atau judul) |
| `emora -s list\|delete\|title` | Kelola sesi: daftar, hapus (`delete all` = semua), regen judul |
| `emora setup` | Wizard setup interaktif (provider AI, gateway, MCP, plugin, context window) |
| `emora model list\|set\|save\|use\|rm` | Provider/model & profile multi-konfigurasi |
| `emora bot list\|add\|rm\|run` | Kelola Bot Perusahaan (pecahan agent spesialis dengan peran & warna) |
| `emora config list\|get\|set` | Baca/tulis `.env` langsung |
| `emora toolset list\|use\|on\|off` | Preset grup tool aktif (full/coding/chat/minimal) |
| `emora backends add\|list` | Backend SSH untuk shell_exec remote |
| `emora doctor` | Diagnosa mandiri (env, koneksi, disk, test suite) |
| `emora gateway run` | Jalankan semua gateway aktif (foreground) |
| `emora gateway install-service` | Pasang sebagai service OS — jalan permanen di background |
| `emora send "<msg>"` | Kirim pesan one-shot ke platform gateway aktif |
| `emora --web` | Jalankan CLI + Web UI dashboard |
| `emora status` | Status semua komponen |
| `emora --help` | Semua perintah CLI yang tersedia |

Di dalam TUI/REPL, slash command yang sering dipakai:

```
/mode autonomous|safe|plan   # approval gate (plan = baca-saja)
/skin rpg|clean              # tema visual manhwa-style
/switch <profile>            # ganti model ke profile tersimpan
/model save <nama>           # simpan config aktif sebagai profile
/skills                      # SKILL WINDOW — semua skill terpasang
/help                        # daftar lengkap
```

## 🧩 Skill, Plugin & MCP — Ringkas

```bash
# Skill bawaan/plugin — dipanggil manual dari chat manapun:
/nama_skill
/nama_plugin:nama_command

# Kelola plugin:
emora plugin install <url_github>
emora plugin list
emora plugin trust-hooks <id>     # untuk plugin dengan perilaku "selalu aktif" (hooks)

# Kelola MCP server & Obsidian:
emora mcp
emora obsidian setup
```
Detail lengkap ada di `skill/SKILL.md` (untuk pembuat skill/plugin) dan `skill/guide-emora/skill.md` (untuk pemakaian sehari-hari).

## 🤝 Kontribusi

Pull request & issue terbuka. Rencana pengembangan lanjutan: hook-execution engine yang lebih lengkap (event lifecycle tambahan ala Claude Code), dukungan input multi-modal (gambar), dan perluasan Swarm/Multi-Agent architecture.

## 📄 Lisensi

MIT License — bebas digunakan dan dimodifikasi.
