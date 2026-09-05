# Node.js Code Audit Checklist Lengkap

## Error Handling
- [ ] Error handler middleware exist dan di posisi terakhir
- [ ] Semua route handler di-wrap try-catch
- [ ] Error di-log dengan context (method, path, body)
- [ ] Error response format konsisten
- [ ] No stack trace di production response

## Input Validation
- [ ] Request body di-validate (joi, zod, validator)
- [ ] Path parameters di-validate
- [ ] Query parameters di-validate
- [ ] Email format di-check strict
- [ ] Whitespace di-trim
- [ ] Array length di-limit

## Security
- [ ] CORS whitelist origin (bukan '*')
- [ ] Rate limiter di-apply ke sensitive endpoints
- [ ] Helmet installed & configured
- [ ] Password hashing (bcrypt/argon2)
- [ ] JWT expiration
- [ ] Input sanitization (prevent injection)
- [ ] SQL/NoSQL injection prevention (parameterized queries)

## Best Practices
- [ ] Morgan atau equivalent logging
- [ ] Environment variables untuk config
- [ ] Graceful shutdown (close DB, clear timers)
- [ ] Request tracing/correlation ID
- [ ] Health check endpoint
- [ ] API versioning (/v1/users)
- [ ] Pagination untuk list endpoints
