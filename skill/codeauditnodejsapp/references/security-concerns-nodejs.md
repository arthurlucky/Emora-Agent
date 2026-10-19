# Common Security Issues in Node.js Apps

1. **Middleware Order**: Error handler harus last, body-parser sebelum routes
2. **Unvalidated Input**: Semua input dari user harus di-validate
3. **SQL/NoSQL Injection**: Gunakan parameterized queries atau ORM
4. **No Rate Limiting**: Buat endpoint vulnerable to brute force
5. **Exposed Secrets**: Never hardcode API keys, use env vars
6. **No CORS Validation**: Accept all origins = security risk
7. **Logging Sensitive Data**: Jangan log passwords, tokens, PII
8. **Outdated Dependencies**: Regular `npm audit` dan updates
9. **No Error Boundary**: Unhandled promise rejection crash server
10. **ID Predictability**: Math.max(arr.map(x => x.id)) + 1 = predictable IDs
