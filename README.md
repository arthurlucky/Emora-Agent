<div align="center">

**EMORA AGENT**
*Terminal Intelligence for Termux & Linux*

[![Node.js](https://img.shields.io/badge/Node.js-v16+-green.svg)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Termux%20%7C%20Linux-orange.svg)](https://termux.dev)
[![Telegram](https://img.shields.io/badge/Telegram-Community-2CA5E0?logo=telegram)](https://t.me/EMORAGENT)

</div>

---

## 🤖 Apa itu EMORA?

**EMORA** adalah AI Agent berbasis terminal yang dirancang untuk berjalan di **Termux** dan **Linux**. Ditenagai oleh LLM pilihan kamu (Groq, OpenAI, Gemini, Ollama, dan lainnya), EMORA bisa menjalankan perintah shell, mengelola file, browsing web, kirim notifikasi Telegram, dan banyak lagi — semua dari terminal.

Lebih dari sekadar chatbot, EMORA adalah asisten yang bisa **berpikir**, **merencanakan**, dan **mengeksekusi tugas kompleks multi-langkah** secara mandiri.

---

## ✨ Fitur Utama

- 🧠 **Agentic AI** — Mampu merencanakan dan mengeksekusi tugas kompleks secara mandiri menggunakan siklus Project Manager
- 🔧 **20+ Built-in Tools** — Shell executor, file manager, web search, ZIP, scheduler, dan masih banyak lagi
- 💬 **Telegram Gateway** — Gunakan EMORA langsung dari Telegram Bot
- 🌐 **Web UI** — Panel kontrol di browser (Express + Vite/vanilla JS) buat kelola sesi chat, toggle gateway, dan edit AGENT.md/SOUL.md
- 📦 **Skill System** — Simpan dan reuse workflow sebagai "skill" yang bisa dipanggil kapan saja
- 🏭 **Skill Factory** — Otomatis pembuatan skill berdasarkan workflow
- 🔌 **EMORA Hub** — Marketplace komunitas untuk berbagi dan mengunduh tools & skills custom
- ⏱️ **Background Scheduler** — Jalankan tugas berkala (monitoring, notifikasi, cron-style) di background
- 🧩 **Self-Expanding** — EMORA bisa membuat dan mendaftarkan tool barunya sendiri
- 🔄 **Multi-Provider** — Dukung Groq, OpenAI, NVIDIA NIM, OpenRouter, Google Gemini, dan Ollama (lokal)

---

## 🚀 Instalasi

### Prasyarat

- Node.js **v16+**
- npm
- (Opsional) Telegram Bot Token untuk gateway Telegram
- (Opsional) Tavily API Key untuk web search

### Langkah Instalasi

```bash
# 1. Clone repository
git clone https://github.com/arthurlucky/Emora-Agent.git
cd emora

# 2. Install dependencies
npm install

# 3. Jalankan setup interaktif
node setup.js
```

Setup wizard akan memandu kamu memilih:
- **Provider AI** (Groq, OpenAI, Gemini, NVIDIA NIM, OpenRouter, Ollama)
- **API Key** untuk provider yang dipilih
- **Telegram Gateway** (opsional)
- **Whatsapp Gateway** (opsional)
- **Web UI** (opsional)

### Konfigurasi Manual

Salin `.env.example` dan isi sesuai kebutuhan:

```bash
cp .env.example .env
```

```env
MODEL_URL=
MODEL_API=
MODEL_NAME=
TELEGRAM_GATEWAY=
TELEGRAM_TOKEN_BOT=
TELEGRAM_ALLOWED_IDS=
WA_PHONE_NUMBER=
WA_GATEWAY=
WA_ALLOWED_NUMBERS=
WEBUI=false
NAME=Emora
TAVILY_API_KEY=
EMORA_HUB=https://emora-hub--rellaja1214.replit.app
```

---

## ▶️ Menjalankan EMORA

```bash
node main.js
# atau
npm start
```

EMORA akan muncul di terminal dan siap menerima perintah. Jika Telegram Gateway aktif, bot juga langsung online.

---

## 🛠️ Tools Bawaan

| Tool | Deskripsi |
|------|-----------|
| `shell_exec` | Eksekusi perintah shell/bash |
| `read_file` | Baca isi file |
| `write_file` | Tulis atau buat file |
| `list_file` | Tampilkan daftar file dalam folder |
| `find_folder` | Cari folder berdasarkan nama |
| `create_folder` | Buat folder baru |
| `delete_folder` | Hapus folder |
| `search_web` | Cari informasi di internet (via Tavily) |
| `fetch_page` | Ambil konten dari URL |
| `search_text` | Cari teks dalam file |
| `datetime` | Informasi waktu dan tanggal |
| `system_monitor` | Monitor CPU, RAM, dan disk |
| `scheduler` | Jalankan tugas terjadwal di background |
| `project_manager` | Manajemen proyek multi-langkah |
| `skill_factory` | Buat dan kelola skills |
| `skill_reader` | Baca konten skill |
| `backup_manager` | Backup dan restore file |
| `zip_compress` | Kompres file ke ZIP |
| `zip_extract` | Ekstrak file ZIP |
| `emora_hub` | Akses EMORA Community Hub |
| `economy_manager` | Tool Have Fun buat kamu |

---

## 📚 Sistem Skill

Skills adalah kumpulan workflow, standar, dan best practice yang tersimpan sebagai file Markdown di folder `skill/`. EMORA menggunakannya untuk menyelesaikan tugas tertentu secara konsisten.

### Skills Bawaan

- **auto_code_reviewer** — Audit kode otomatis (bug, keamanan, best practice)
- **auto_generate_tools** — Panduan membuat tool baru sesuai standar sistem
- **random_file_gen** — Generate file random untuk testing
- **react_uiux** — Standar pembuatan UI/UX dengan React

### Membuat Skill Baru

EMORA bisa **otomatis mendeteksi pola** penggunaan tools yang berulang. Setelah 5 kali pengulangan pola yang sama, EMORA akan menyarankan pembuatan skill baru dari pola tersebut.

Kamu juga bisa meminta EMORA membuat skill secara manual:

```
"Buatkan skill untuk workflow yang baru saja kita lakukan"
```

---

## 🏭 EMORA Hub

EMORA Hub adalah komunitas resmi untuk berbagi dan mengunduh tools & skills custom. Akses langsung dari dalam EMORA:

```
"Cari tool untuk integrasi Spotify di EMORA Hub"
"Download tool spotify_search dari Hub"
```

EMORA akan otomatis mengunduh, mengekstrak, dan mendaftarkan tool baru ke sistem.

---

## 📁 Struktur Proyek

```
emora/
├── main.js              # Entry point utama
├── setup.js             # Setup wizard interaktif
├── package.json
├── .env                 # Konfigurasi (buat dari .env.example)
├── core/
│   ├── chat.js          # Logika percakapan & tool loop
│   ├── cmd.js           # Handler perintah khusus
│   ├── memory.js        # Manajemen memori sesi
│   └── tools.js         # Registrasi semua tools
├── tools/               # Semua built-in tools
├── gateway/
│   ├── telegram.js      # Telegram Bot gateway
│   └── sendfile.js      # Pengiriman file via Telegram
├── webui/
│   ├── server.js        # Web UI backend (Express, REST API /api/*)
│   └── src/             # Frontend (Vite + vanilla JS) — lihat webui/README.md
├── skill/               # Skill library
├── skill_factory/       # Data pola untuk Skill Factory
├── memory/              # Penyimpanan memori percakapan
├── utils/
│   ├── eventBus.js      # Event bus untuk background tasks
│   ├── patternTracker.js # Pelacak pola penggunaan tools
│   └── workspace.js     # Manajemen workspace
└── workspaces/          # Direktori kerja proyek
```

---

## ⚙️ Provider AI yang Didukung

| Provider | Gratis | Catatan |
|----------|--------|---------|
| **Groq** | ✅ | Rekomendasi — cepat & gratis |
| **NVIDIA NIM** | ✅ | Model-model powerful |
| **OpenRouter** | ✅ | Akses banyak model |
| **Google Gemini** | ✅ | Via Google AI Studio |
| **Ollama** | ✅ | Lokal, tanpa internet |
| **OpenAI** | ❌ | Berbayar |

---

## 🤝 Kontribusi

Kontribusi sangat welcome! Kamu bisa:

- Membuat tool baru dan bagikan ke komunitas via EMORA Hub
- Membuat skill baru dan share ke komunitas
- Melaporkan bug atau request fitur via Issues
- Pull request untuk perbaikan kode

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah **MIT License** — bebas digunakan, dimodifikasi, dan didistribusikan.

---

<div align="center">
  Made with ❤️ by the EMORA Community · <a href="https://t.me/EMORAGENT">Join Telegram</a>
</div>
