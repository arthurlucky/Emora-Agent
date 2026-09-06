# guide-emora

**Metadata**
- **name:** guide-emora
- **deskripsi:** Panduan lengkap cara pakai EMORA — semua interface, perintah, dan subsistem.
- **author:** EMORA Core
- **versi:** 2.0.0

Ini adalah skill utama (Master Guide) yang memandu Anda tentang seluruh kemampuan EMORA. Skill ini telah diperbarui untuk mencerminkan arsitektur termutakhir EMORA, serta dipecah ke dalam struktur "Complex Skill" agar detail tidak saling bertumpuk.

## 📁 Struktur Referensi di Skill Ini
Skill ini memiliki direktori `references/` yang memuat dokumentasi rinci tentang fitur EMORA:
- **`references/concepts.md`** — Analisis keseluruhan fitur (Core Features), Arsitektur, Multi-Agent Swarm, Manajemen Artifact Terisolasi, Memori Semantik, dll. (PENTING DIBACA!)
- **`references/api.md`** — Daftar referensi command TUI (slash commands) dan kapabilitas Tools EMORA (mulai dari Git, Scheduler, hingga Undo).
- **`references/rules.md`** — Aturan dasar pengoperasian (Approval Modes, Link Budget).
- **`references/examples.md`** — Contoh *use-case* penggunaan.

## 🎯 Trigger
- Saat user bertanya "apa saja fitur emora?" atau "tolong analisis semua fitur emora".
- Saat user meminta panduan cara menjalankan EMORA.
- Saat user bertanya cara mengatur provider AI atau Gateway (Telegram/WA/Discord).

## 🛠️ Langkah-langkah (Workflow)
1. **Analisis Pertanyaan:** Jika user bertanya tentang keseluruhan fitur, wajib membaca isi dari `references/concepts.md`.
2. **Penjelasan Command:** Jika user bertanya cara menjalankan perintah, rujuk ke `references/api.md`.
3. **Penyajian Data:** Jelaskan kepada user secara rapi (menggunakan Markdown atau daftar poin) tanpa membanjiri layar. Sebutkan bahwa EMORA punya TUI, Web UI, Multi-Agent Swarm, Artifact Terisolasi, dan Undo Stack.
4. **Validasi:** Pastikan tidak menyebut fitur yang tidak ada di dalam `references/concepts.md`.

## 🧰 Tools yang Sering Digunakan
- `read_skill` (untuk membaca metadata dan skill lain)
- `session_memory` (untuk memahami konteks lama user)
- `knowledge_library` (basis data tambahan)
