# Express Project Analysis & API Development with EMORA

## Workflow / Cara Kerja
1. **Masukkan Konteks Proyek**: Jalankan perintah `list folder` atau attach folder proyek (seperti `@My-app coba analisis ini`) agar EMORA dapat merender struktur lengkap.
2. **Analisis Struktur & Arsitektur**: EMORA akan meringkas lapisan proyek (Entry, Routes, Controllers, Services, Utils, Constants), mengidentifikasi pola arsitektur, dan menampilkan daftar file serta konfigurasi keamanan yang sudah ada.
3. **Tentukan Tugas Spesifik**: Jelaskan dengan jelas apa yang ingin dilakukan — misal: "analisis ini", "tambahin 5 api lagi", atau debugging area tertentu.
4. **Eksekusi & Output**: EMORA akan menghasilkan ringkasan struktur, tabel endpoint, temuan, saran perbaikan, dan/atau implementasi API baru dengan integrasi keamanan default.
5. **Integrasi Keamanan & Best Practice**: Output akan mencakup Helmet, Rate Limiter (100 request/15 menit per IP), Morgan (logging), Body Parser (limit 10MB, validasi Content-Type), serta error handling terstruktur (notFoundHandler & errorHandler urutan benar).
6. **Verifikasi & Iterasi**: Jalankan `npm start` atau `npm dev` untuk menguji endpoint. Jika butuh subagent untuk review, pastikan ID subagent valid melalui `emora swarm list` sebelum delegasi.
7. **Informasi Tambahan**: EMORA dapat memberikan tanggal, waktu, atau data lain sesuai permintaan, namun prioritas utama adalah solusi teknis.

## Aturan Penting
- Selalu sertakan struktur folder atau attach project saat meminta analisis mendalam atau penambahan endpoint.
- Spesifikasikan metode HTTP dan path saat menambah API baru; EMORA akan mengikuti pola yang konsisten dengan kode yang sudah ada.
- Keamanan default (Helmet, Rate Limiter, Morgan, Body Parser) diaktifkan secara otomatis; sesuaikan limit dan konfigurasi sesuai kebutuhan produksi.
- Error handling diatur dengan pola unified: 404 handler diletakkan sebelum error handler, menggunakan HTTP_STATUS dan ERROR_CODES dari constants untuk konsistensi respons.
- Delegasi ke subagent hanya dengan ID yang valid dari daftar `emora swarm list`; subagent yang tidak ditemukan akan gagal dan memblokir tugas.
- Fokus pada dokumentasi dan verifikasi setelah perubahan; selalu uji endpoint setelah menambahkan atau mengubah rute.
