# Konsep & Fitur Inti (EMORA Core Features)

Berdasarkan analisis arsitektur (*source code* di folder `core/`, `tools/`, `swarm/`, `gateway/`, dll), EMORA memiliki fitur-fitur kompleks berikut:

## 1. Arsitektur Multi-Antarmuka (Omnichannel)
- **TUI (Terminal UI):** Dibangun dengan komponen interaktif, mendukung navigasi *history*, auto-complete *slash command*, mode presentasi, dan mode persetujuan persisten (Y/N/Always).
- **Gateway (Messenger Bridge):** Mendukung bot untuk Telegram, WhatsApp, Discord, Slack, dan Matrix. Beroperasi lewat skrip `gateway/manager.js` yang memungkinkan banyak sesi dari berbagai pengguna berjalan secara paralel.
- **Web UI:** Tersedia dashboard lewat browser untuk pengelolaan status agent (`emora --web`).

## 2. Multi-Agent & Swarm (Delegation Engine)
EMORA bukan hanya satu agen AI, melainkan konduktor dari "Swarm" (sekumpulan agen):
- **ag_subagent_engine.js / tools/ag_subagents.js:** Memungkinkan pembuatan *sub-agent* AI di memori (RAM) untuk mengerjakan tugas sekunder (misalnya riset web) secara asinkron tanpa menahan proses utama.
- **Bot Mesh (`tools/bot_mesh.js`) & Swarm Manager (`swarm/manager.js`):** Memungkinkan manajemen jaringan agen dalam bentuk kontainer/workspace terpisah. Agen bisa melempar tugas ke agen dengan peran spesifik.

## 3. Ekosistem Artifact Terisolasi (Session-Scoped)
File panjang (seperti kode program, dokumen laporan, atau struktur markdown) dikelola melalui `core/artifactManager.js`:
- Menyimpan hasil AI secara berversi (*version history*).
- **Session-Scoped Isolation:** Artifact disimpan ketat di dalam folder `.emora_artifacts/<session_id>/` sehingga riwayat artifact tidak tumpang tindih antar-proyek atau antar-chat, menjaga konteks bersih 100%.

## 4. Sistem Memori Dinamis & Smart Truncation
Agar EMORA hemat token namun tetap pintar secara jangka panjang:
- **Link Budget (`core/linkBudget.js`):** Pemangkas pesan cerdas. Membuang pesan tertua saat percakapan mulai membengkak melampaui limit.
- **Semantic Compaction:** Sebelum membuang pesan, jika memenuhi syarat, EMORA merangkum seluruh sejarah obrolan tersebut ke dalam satu baris ringkasan padat secara otomatis (memanggil AI di *background*).
- **Session Memory / Durable Facts (`sessionMemory.js`):** Menggali dan mengekstraksi fakta kunci dari obrolan secara persisten (seperti framework favorit user, aturan spesifik user) yang akan selalu diingat lintas sesi.

## 5. Sistem Skill Otonom & Generator (Skill Factory)
- **Instalasi Fleksibel:** Menyimpan instruksi ke dalam direktori `/skills/`.
- **Complex Structure:** Mendukung pemisahan logika (meta.json, SKILL.md, references/, scripts/, assets/).
- **Auto-Learn:** Perintah `/learn <nama>` atau `tools/skill_factory.js` memungkinkan EMORA mencatat riwayat pemecahan masalah (problem-solving) dan menyulapnya menjadi berkas Skill (SKILL.md) tanpa campur tangan teknis manusia.

## 6. Integrasi Eksternal (MCP & Knowledge Library)
- **Model Context Protocol (MCP Bridge):** Menghubungkan EMORA ke sumber luar terstandardisasi, misalnya Obsidian Vault (`obsidian_manual.js`), GitHub, atau *local tool* apa saja yang mengadopsi MCP.
- **Knowledge Library (`tools/knowledge_library.js`):** Basis data dokumen yang bisa dibaca EMORA sebagai sumber referensi tambahan.

## 7. Eksekusi Mandiri & Persetujuan (Gatekeeper)
- Diatur oleh `core/change_mode.js`.
- **Safe Mode:** User harus menyetujui setiap modifikasi file atau perintah shell (*write tools*).
- **Autonomous Mode:** EMORA diberikan kewenangan *auto-approve* untuk bergerak dan mengerjakan modifikasi sistem sendiri.
- **Planned Mode:** EMORA mengunci mode hanya-baca (read-only) untuk berfokus menyusun cetak biru (blueprint) / perencanaan awal.

## 8. Undo Stack Terpadu
- **`tools/undo.js`:** Mendukung pembatalan (*rollback*) modifikasi file. Semua yang ditulis EMORA bisa dibatalkan jika hasilnya tidak sesuai ekspektasi dengan mengetik `/undo`.

## 9. Error Classifier & Self-Healing
- **`core/errorClassifier.js`:** EMORA dilengkapi sistem 'Dokter'. Apabila LLM melakukan halusinasi JSON, salah argumen fungsi, atau token terputus, sistem mendiagnosis jenis error-nya dan memicu AI untuk merevisi formatnya secara otomatis tanpa perlu user memberi tahu.

## 10. Fitur Pelengkap Lainnya
- **Git Manager & Backup:** Fitur pencadangan direktori via zip atau Git.
- **Web Search & Page Fetching:** Mengekstrak teks murni dari situs web dan melakukan pencarian.
- **Scheduler:** Penjadwalan perintah berkala (Cron jobs).
- **System Monitor:** Meninjau penggunaan CPU, RAM, Disk, dsb.
