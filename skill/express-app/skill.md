# Express App Skill: Analisis Struktur & Menambahkan API Baru

## Workflow / Cara Kerja
1. **Explore Struktur Proyek**: Gunakan perintah `list folder` untuk menampilkan isi root dan folder `My-app`. Identifikasi file kunci: `index.js`, `package.json`, `.env`, `routes/`, `controllers/`, `middleware/`, `services/`, `utils/validators.js`, `constants/`.  
2. **Analisis Lapisan Arsitektur**: Susun kode ke lapisan urut: Entry Point (`index.js`) → Routes (`routes/*.js`) → Controllers (`controllers/*.js`) → Services (`services/`) → Utils (`utils/validators.js`) → Constants (`constants/`).  
3. **Review Keamanan & Middleware**: Verifikasi pengaturan berikut di `index.js`: Helmet (headers keamanan HTTP), Rate Limiter (batas 100 request/15 menit per IP), Body Parser (limit 10MB, validasi Content-Type), Morgan (logging permintaan). Pastikan urutan mounting: helmet → rate limit → body parser → morgan → routes → error handler.  
4. **Evaluasi Endpoint & Logika**: Tabel metode, path, dan controller. Catat endpoint tersedia dan gap: folder `services/` belum dibuka, butuh implementasi `findAll`, `findById`, `create`, `emailExists`.  
5. **Tambah API Baru**: Ikuti pola eksisting: definisikan method HTTP & path, panggil controller, validasi input di controller via `validators.js`, validasi DB di service layer. Integrasikan dengan security middleware, body parser, dan error handling unified (404 sebelum error handler).  
6. **Test & Jalankan**: Gunakan `npm start` atau `npm dev` untuk memverifikasi endpoint baru, logging Morgan, serta respons error dan keamanan.

## Aturan Penting
- **Urutan Middleware**: Helmet → Rate Limiter → Body Parser → Morgan → Routes → Error Handler (404 handler harus ditempatkan sebelum error handler global).  
- **Batas Body Parser**: Maksimal 10MB; request harus sesuai Content-Type yang diizinkan.  
- **Rate Limit**: 100 request per 15 menit per IP.  
- **Validasi Ganda**: Lakukan validasi input di controller melalui `validators.js`, dan validasi data di level service (seperti cek `emailExists` di DB).  
- **Error Handling**: Gunakan `HTTP_STATUS` dan `ERROR_CODES` dari `constants/` untuk respons yang konsisten. Timpa `notFoundHandler` sebelum `errorHandler` global.  
- **Modularity**: Pertahankan pemisahan klarah antara controller ↔ route ↔ middleware untuk memudahkan maintenance dan pengembangan fitur baru.
