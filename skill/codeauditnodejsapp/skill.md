---
name: code-audit-nodejs-app
description: Audit komprehensif aplikasi Node.js untuk mengevaluasi struktur kode, error handling, input validation, security, dan best practices. Menghasilkan laporan terstruktur dengan scoring dan rekomendasi prioritas.
categories: code-review, quality-assurance, nodejs
---

# Code Audit untuk Aplikasi Node.js

## Gambaran Umum
Skill ini melakukan audit menyeluruh terhadap proyek Node.js, menganalisis berbagai dimensi kualitas kode dan memberikan rekomendasi yang diprioritaskan.

## Langkah-Langkah

### 1. Persiapan & Eksplorasi Struktur
- List semua file/folder di proyek target
- Identifikasi jenis proyek (Express, Fastify, dll)
- Baca `package.json` untuk dependencies dan scripts

### 2. Audit Dimensi Utama

#### A. Struktur Kode
- Apakah folder terorganisir dengan baik (controllers, routes, middleware, services)?
- Apakah ada separation of concerns yang jelas?
- Apakah naming convention konsisten?

#### B. Error Handling
- Apakah ada error handler middleware?
- Posisi error handler middleware (harus paling akhir)
- Apakah semua async/await di-wrap dengan try-catch?
- Apakah error di-log atau hanya di-return?

#### C. Input Validation
- Apakah input di-validate sebelum processing?
- Apakah ada input sanitization (trim, type check)?
- Apakah email, URL, atau format khusus di-validate?
- Apakah ada validasi ukuran request body?

#### D. Security
- Apakah CORS di-configure dengan aman?
- Apakah ada rate limiting?
- Apakah ada helmet atau headers security?
- Apakah sensitive data di-expose di logging?
- Apakah environment variables di-gunakan untuk secrets?

#### E. Best Practices
- Apakah ada request logging (morgan, pino, dll)?
- Apakah error handling di-standardisasi?
- Apakah dependencies up-to-date dan minimal?
- Apakah ada documentation API (JSDoc, swagger, dll)?

### 3. Kategorisasi Findings

Gunakan prioritas:
- **Kritis (MUST FIX)**: Bug dalam logic, security vulnerability, crash risk
- **High Priority**: Pattern anti, missing best practice yang berdampak performa/security
- **Low Priority**: Code style, optimization minor, documentation

### 4. Penyajian Hasil

Buat tabel scoring:

| Kategori | Score | Status |
|----------|-------|--------|
| Struktur Kode | X/10 | ✅/⚠️ |
| Error Handling | X/10 | ✅/⚠️ |
| Input Validation | X/10 | ✅/⚠️ |
| Security | X/10 | ✅/⚠️ |
| Best Practices | X/10 | ✅/⚠️ |
| **Overall** | **X/10** | ✅/⚠️ |


Tulis findings dalam format:
1. **🔥 Issue Kritis (Harus Diperbaiki)**
   - Nomor, deskripsi, lokasi file
2. **⚡ Improvement High Priority**
   - Nomor, deskripsi, konteks
3. **📝 Low Priority**
   - Nomor, deskripsi, alasan

### 5. Penawaran Tindak Lanjut
Tanyakan kepada user:
- Apakah mereka ingin fixes diimplementasikan segera?
- Fokus ke critical dulu atau semua sekaligus?
- Ada preferensi library untuk logging, validation, dll?

## Contoh Checklist Audit


□ Folder structure terorganisir
□ Middleware order benar (body-parser → routes → error handler)
□ Error handler middleware ada dan di posisi akhir
□ Try-catch wrapping semua async operations
□ Input validation sebelum database query
□ Input sanitization (trim, type check)
□ Email validation ketat (case-insensitive, valid TLD)
□ CORS dikonfigurasi (whitelist origin)
□ Rate limiting implemented
□ Helmet atau security headers
□ Environment variables untuk secrets
□ Request logging (morgan/pino)
□ Consistent error response format
□ API documentation (JSDoc/Swagger)
□ No console.log di production (gunakan logger)
□ Package.json dependencies reasonable
□ README dengan setup instructions


## Output yang Diharapkan
Laporan terstruktur dengan scoring, findings prioritas, dan rekomendasi actionable yang siap diimplementasikan.
