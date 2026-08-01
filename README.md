# 🌟 EMORA Autonomous Agent

EMORA adalah sistem AI cerdas dan *autonomous* yang dirancang untuk beroperasi secara lokal (via Termux/Linux) dengan kemampuan multi-platform dan *multi-skill*. Sistem ini dilengkapi dengan antarmuka **Web UI** modern, manajemen agen, penjadwalan otomatis (*Cron*), sistem pencarian web, serta basis pengetahuan (Knowledge Library/RAG).

## 🚀 Fitur Utama

- **🧠 Advanced Knowledge Base (RAG)**
  Sistem basis pengetahuan internal dengan pembacaan indeks otomatis (TF-IDF scoring). EMORA dapat mencari, membaca, dan menyimpan pengetahuan secara permanen tanpa terhalang *token limit* LLM.
- **🌐 Multi-Gateway Integration**
  EMORA bisa terhubung secara bersamaan ke berbagai platform komunikasi:
  - Telegram
  - WhatsApp
  - Discord
  - Slack
  - Matrix
- **⚡ Real-time Web UI (SPA)**
  Dashboard pengontrol agen berbasis web lokal yang mendukung *Server-Sent Events* (SSE) untuk melihat proses berpikir AI secara *real-time* (streaming & tool execution badges).
- **⏱️ Cron Scheduler Dashboard**
  Tugaskan EMORA untuk berjalan di latar belakang secara berkala (misal: "Setiap jam 8 pagi cek cuaca dan kirim ke grup WhatsApp") melalui visual *Cron Dashboard*.
- **📊 Interactive Widgets (Mermaid & Chart.js)**
  Web UI EMORA mampu merender diagram *flowchart* (Mermaid) dan grafik data (*Chart.js*) langsung dari respon agen. Termasuk fitur pemutar *voice notes*/audio otomatis.
- **🕵️ Web Research Skill**
  EMORA dapat menggunakan *search engine* (Tavily/Google) dan melakukan *scraping* konten halaman web secara instan untuk mencari informasi terbaru.

## 📁 Struktur Direktori

\`\`\`text
EMORA/
├── core/
│   ├── chat.js            # Engine LLM utama
│   ├── tools.js           # Pendaftaran tools/skill
│   └── cmd.js             # Parser slash commands
├── gateway/
│   ├── manager.js         # Gateway Manager terpusat
│   ├── telegram/          # Adapter Telegram
│   ├── whatsapp/          # Adapter WhatsApp
│   ├── discord/           # Adapter Discord
│   ├── slack/             # Adapter Slack (Baru)
│   ├── matrix/            # Adapter Matrix (Baru)
│   └── cron/              # Sistem penjadwalan cron
├── skill/                 # Daftar modul *Skill* otonom (mis. web_research)
├── library/               # Knowledge Base Data
├── webui/
│   ├── server.js          # Express.js Server
│   ├── src/               # Front-end React-like SPA
│   └── index.html         # Entry point UI
└── bin/emora.js           # CLI entry point
\`\`\`

## 🛠️ Cara Menjalankan

### 1. Menjalankan Web UI & Backend Server
\`\`\`bash
npm run start --prefix webui
\`\`\`
*(Akses dashboard di `http://localhost:3000`)*

### 2. Menjalankan Gateway Platform
Lewat CLI:
\`\`\`bash
node bin/emora.js gateway --platform telegram
\`\`\`
Atau langsung jalankan dan kelola melalui halaman **Gateway Manager** di Web UI.

## 🧩 Sistem Skill & Tools

EMORA beroperasi menggunakan konsep *Dynamic Tools* dari LangChain. Beberapa tools penting meliputi:
- `search_web` & `fetch_page`: Untuk mencari dan membaca halaman web.
- `knowledge_library`: RAG tool untuk membaca/menulis ke penyimpanan pintar.
- `shell_exec`: Menjalankan command sistem secara aman.
- `system_monitor`: Memantau metrik performa (CPU, RAM).

Skill baru dapat didefinisikan dengan menambahkan folder baru di direktori `skill/` beserta file `meta.json` dan `skill.md` berisi instruksi.

## 🤝 Kontribusi & Pengembangan Lanjutan
Rencana fase selanjutnya:
- Mengubah *Single Agent* menjadi **Multi-Agent / Swarm Architecture** di mana beberapa *sub-agents* akan saling berkomunikasi di *background* untuk menyelesaikan masalah kompleks.
- Eksplorasi mode kontrol multi-modal (Melihat gambar via Termux API).

## 📄 Lisensi
MIT License - Bebas digunakan dan dimodifikasi untuk pengembangan AI mandiri.
