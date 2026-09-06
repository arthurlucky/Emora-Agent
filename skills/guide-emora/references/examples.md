# Contoh Penggunaan (Use Cases & Examples)

Berikut adalah contoh skenario penggunaan fitur-fitur kompleks EMORA:

### 1. Menciptakan Skill (SOP) dari Sesi yang Sudah Selesai
**Skenario:** Pengguna baru saja mengajarkan EMORA cara memformat *codebase* proyek dengan Prettier secara benar, dan meminta AI tersebut untuk membuat ringkasan.
**Aksi Pengguna:** `/learn frontend_formatter`
**Tindakan EMORA:**
Menganalisis obrolan sebelumnya, lalu membangun berkas `skills/frontend_formatter/SKILL.md` (beserta `meta.json` dan struktur folder pendukungnya). Pada interaksi hari esok, pengguna cukup mengetik "Tolong format proyek ini" dan EMORA akan otomatis meload skill `frontend_formatter` tanpa perlu diajari ulang.

### 2. Pendelegasian ke Subagent
**Skenario:** Pengguna meminta EMORA untuk melakukan riset terhadap 3 topik berbeda secara bersamaan, tanpa ingin mengganggu obrolan di layar TUI utama.
**Perintah:** "Tolong minta subagent untuk mencari dokumentasi React 19, dan jalankan di background."
**Tindakan EMORA:**
Menggunakan alat `ag_subagents` atau `subagent` untuk melahirkan *child-agent* di latar belakang. Saat *child-agent* selesai, ia akan mengirim pesan (notification) ke TUI pengguna bahwa hasil riset sudah siap.

### 3. Membatalkan (Undo) Modifikasi File
**Skenario:** EMORA baru saja memodifikasi `index.js`, namun perubahannya membuat *build* gagal.
**Aksi Pengguna:** Mengetik `/undo`
**Tindakan EMORA:**
Karena *tool* `write_file` dan `patch` dikelola lewat *wrapper* `tools/undo.js`, file `index.js` otomatis dikembalikan ke *state* tepat sebelum AI memodifikasinya. 

### 4. Semantic Compaction
**Skenario:** Percakapan berlangsung sangat lama hingga ratusan pertukaran pesan. Token LLM mulai kepenuhan.
**Tindakan EMORA:** 
Sistem memotong 50 pesan terakhir, merangkumnya menjadi poin penting (Misal: "Pengguna sedang membuat sistem login dengan JWT, database PostgreSQL, warna tema hijau gelap."), dan mengekstrak aturan spesifik ke penyimpanan `sessionMemory`. Pengguna tidak akan merasakan *context loss* mendadak.
