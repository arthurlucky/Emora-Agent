---
name: comprehensive_code_review
description: Audit sistematis codebase untuk mengidentifikasi strengths, issues, dan recommendations berdasarkan framework multi-dimensi (struktur, security, error handling, validation, logging, documentation)
categories: code-quality, productivity, devops
---

# Panduan Comprehensive Code Review

## Overview
Skill ini melakukan code review mendalam terhadap project dengan framework standar yang mencakup:
- Struktur & Arsitektur
- Security & Compliance
- Error Handling & Logging
- Input Validation & Sanitization
- Best Practices
- Documentation
- Performance Considerations

## Proses Kerja

### 1. Persiapan
- List semua files di project untuk memahami struktur
- Identifikasi tech stack (dari package.json, Gemfile, requirements.txt, dll)
- Cek folder utama: controllers, services, routes, middleware, config

### 2. Analisis Multi-Dimensi
Gunakan checklist standar untuk setiap kategori:

**Struktur & Arsitektur:**
- Separation of concerns (controllers vs services vs routes)
- Modularitas & reusability
- Konsistensi naming & organization

**Security:**
- Security headers (Helmet, CORS, CSP)
- Rate limiting & throttling
- Input validation & XSS protection
- SQL Injection prevention
- Authentication/Authorization patterns
- Secrets management (.env usage)

**Error Handling:**
- Global error handler middleware
- Consistent error response format
- Proper HTTP status codes
- Error logging & tracing

**Logging & Monitoring:**
- HTTP request logging (Morgan)
- Application logging levels
- Health check endpoints
- Request ID tracing

**Validation & Sanitization:**
- Input validators existence
- Data type checking
- Length/format validation
- XSS/injection prevention

**Documentation:**
- README presence
- API documentation (Swagger/OpenAPI)
- Setup instructions
- Environment variables documentation

**Performance:**
- Database query optimization
- Pagination support
- Caching strategy
- N+1 query patterns

### 3. Scoring & Categorization

**Skala per kategori:** 1-10

**Issue Severity:**
- 🔴 CRITICAL: Security vulnerability, data loss risk, app crash
- 🟡 MEDIUM: Best practice violation, maintainability issue
- 🟢 LOW: Nice-to-have, optimization opportunity

### 4. Output Structure


# 📊 AUDIT KOMPREHENSIF [PROJECT-NAME]

## ✅ STRENGTHS
| Aspek | Score | Penjelasan |

## ⚠️ ISSUES
### 🔴 CRITICAL
### 🟡 MEDIUM
### 🟢 LOW

## 🎯 OVERALL SCORE
| Kategori | Score |

## 🚀 PRIORITY FIXES


### 5. Deliverables
1. Summary strengths dengan scoring
2. Issues terklasifikasi per severity
3. Overall score breakdown per kategori
4. Prioritized action items (urutan eksekusi)
5. Tawarkan implementasi fixes

## Tools & Commands

bash
# List project structure
find . -type f -name '*.js' | head -20

# Check dependencies (Node.js)
cat package.json | grep -A 50 '"dependencies"'

# Find security issues patterns
grep -r 'eval\|exec\|child_process' . --include='*.js'

# Check for .env files
find . -name '.env*' -o -name '*.env'


## Checklist Template

- [ ] Architecture & Structure analyzed
- [ ] Security audit completed
- [ ] Error handling patterns reviewed
- [ ] Validation & sanitization checked
- [ ] Logging & monitoring evaluated
- [ ] Documentation status assessed
- [ ] Performance considerations noted
- [ ] Issues categorized & scored
- [ ] Priority action items created
- [ ] Recommendations communicated

## Tips

1. **Jangan superficial:** Baca actual code, bukan hanya structure
2. **Context matters:** Pahami business logic sebelum suggest improvement
3. **Actionable:** Setiap issue harus punya clear fix atau recommendation
4. **Prioritize:** Fokus pada critical security & data-loss issues dulu
5. **Encourage:** Highlight what's done well, bukan hanya problems

---