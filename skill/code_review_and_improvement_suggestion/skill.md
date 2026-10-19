---
name: code_review_and_improvement_suggestion
description: Analisis struktur project, identifikasi best practices & issues, beri rekomendasi improvement terstruktur dengan severity levels
categories: code-quality, development, productivity
---

# Skill: Code Review & Improvement Suggestion

## Deskripsi
Skill ini mengotomatisasi proses code review dengan:
1. **Eksplorasi struktur project** - Map folder, files, dan konfigurasi
2. **Analisis best practices** - Cek modularitas, error handling, validation, patterns
3. **Identifikasi issues** - Temukan anti-patterns, missing implementations, security concerns
4. **Kategorisasi & prioritas** - Group issues by severity (Critical, High, Medium, Low)
5. **Generate rekomendasi** - Actionable suggestions dengan implementasi hints

## Proses Langkah Demi Langkah

### 1. Eksplorasi Struktur Project
- Gunakan `list_files` untuk map folder hierarchy
- Baca `package.json` untuk dependencies & project type
- Identifikasi key files: index/main, config, routes, middleware, controllers

### 2. Analisis Best Practices (Cek Checklist)
- **Modularitas**: Controllers/routes/middleware terpisah?
- **Error Handling**: Middleware error handler ada? Try-catch di async?
- **Validation**: Input validation tersedia? Library (express-validator) ada?
- **Logging**: Winston/morgan untuk request logging?
- **Environment Config**: .env file & dotenv library?
- **HTTP Status**: Correct codes (200, 201, 400, 404, 500)?
- **Response Format**: Consistent JSON structure?
- **Database**: Data persistence atau hardcoded?

### 3. Identifikasi Issues
Baca file-file kunci (index.js, controllers, routes) untuk:
- Dummy/hardcoded data
- Missing error handlers
- No validation
- No logging
- Unmounted middleware
- Security issues (no rate limiting, no CORS config)
- Missing dependencies

### 4. Kategorisasi dengan Severity

CRITICAL: Security issues, data loss risks
HIGH: Core functionality broken, major architectural issues
MEDIUM: Performance, maintainability, best practices violation
LOW: Code style, nice-to-haves, documentation


### 5. Format Output

✅ [STRENGTHS SECTION]
- List positive findings dengan emojis

⚠️ [RECOMMENDATIONS SECTION]
| Issue | Severity | Suggestion |
| --- | --- | --- |
| issue_name | CRITICAL/HIGH/MEDIUM/LOW | Actionable recommendation |

🎯 [NEXT STEPS]
Ask user: "Mau aku fix ini semuanya? Atau fokus ke [issue_priority] dulu?"


## Tools Digunakan
- `list_files`: Explore project structure
- `read_file`: Analyze code files
- `search_files`: Find patterns (error handling, validation, logging)

## Best Practices untuk Skill Ini
1. **Jangan terlalu dalam** - Review scope-nya jelas (API, structure, patterns)
2. **Prioritize actionable** - Fokus pada issues yang bisa langsung di-fix
3. **Tawarkan opsi** - Jangan langsung implement, tanya user prioritasnya
4. **Be encouraging** - Highlight strengths sebelum issues
5. **Consistent formatting** - Gunakan table & struktur yang mudah dibaca

## Contoh Penerapan

User: "Review project ku di folder /src"

Assistant:
1. list_files("/src") → explore struktur
2. read_file("package.json") → cek dependencies
3. read_file("index.js") → cek entry point
4. read_file("routes/...") → cek routes & logic
5. Compile findings → Format output dengan checklist


## Exit Criteria
Skill selesai ketika:
- User mendapat clear understanding of project quality
- Issues tercatat dengan prioritas jelas
- Next action di-recommend (fix individual issues atau structural redesign)
