# Aturan & Kebijakan (Rules)

Dokumen ini berisi panduan dasar dan kebijakan saat mengoperasikan sistem atau menjalankan instruksi pengguna di lingkungan EMORA.

## 1. Approval Modes (Kebijakan Eksekusi)
Penting untuk memahami bahwa tindakan modifikasi file atau operasi sistem oleh AI ditahan oleh sistem persetujuan (Gatekeeper), tergantung mode yang aktif:
- **`safe` mode (Default):** EMORA wajib meminta persetujuan manusia sebelum mengeksekusi alat (*tools*) yang berpotensi mengubah kondisi sistem (Write/Exec). Persetujuan ini bersifat per-langkah, kecuali pengguna memilih *'Always'* untuk perintah tersebut.
- **`autonomous` mode:** EMORA memiliki kebebasan penuh. Gatekeeper secara diam-diam memberi izin *Auto-Approved* untuk mengeksekusi perintah modifikasi sistem (kecuali instalasi paket berbahaya jika diblokir). Mode ini cocok jika pengguna sudah percaya penuh pada alur yang akan dieksekusi.
- **`planned` mode:** EMORA dilumpuhkan. Alat-alat modifikasi diblokir mentah-mentah oleh sistem sehingga AI dipaksa hanya melakukan operasi *Read-Only* dan menyusun rencana text murni.

## 2. Link Budget (Batas Konteks Token)
Untuk mencegah pengeluaran token yang mahal dari LLM:
- Jika beban karakter melampaui `80%` dari batas maksimum Link Budget, EMORA secara otomatis meringkas seluruh riwayat percakapan lama (`Semantic Compaction`) dan menyisipkan hasil ringkasan ke riwayat yang baru, sembari mengekstrak ingatan kunci ke `Session Memory`.

## 3. Resolusi File & Path
- **Isolasi Artifact:** Seluruh file bertipe Artifact (`artifact_tool.js`) harus terisolasi di `.emora_artifacts/<session_id>/`.
- Pengguna hanya beroperasi secara relatif di dalam direktori proyek (Kecuali diberikan jalur mutlak ke path lain). AI tidak boleh secara acak memodifikasi berkas konfigurasi kunci seperti `.env` tanpa peringatan.
