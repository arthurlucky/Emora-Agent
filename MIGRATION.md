/**
 * Migration Guide: JSON to SQLite
 * 
 * EMORA sekarang menggunakan SQLite untuk memory management yang lebih performant.
 * 
 * LANGKAH MIGRASI:
 * 
 * 1. Backup data lama (opsional tapi disarankan):
 *    cd /data/data/com.termux/files/home/EMORA
 *    cp -r memory memory.backup
 * 
 * 2. Install dependency baru:
 *    npm install
 *    (akan install better-sqlite3 secara otomatis)
 * 
 * 3. Jalankan migrasi:
 *    emora migrate
 * 
 * 4. Verifikasi:
 *    emora
 *    Cek apakah semua sesi & history masih ada via /history
 * 
 * 5. Cleanup (opsional, setelah verifikasi OK):
 *    rm memory/*.json
 *    rm memory/*.facts.json
 *    (Tapi SIMPAN memory/sessions.db!)
 * 
 * PERUBAHAN API:
 * 
 * Semua import dari core/memory.js dan core/sessionStore.js sekarang
 * bisa diganti dengan core/memoryDB.js:
 * 
 * BEFORE:
 * import { loadSession, saveSession } from "../core/memory.js";
 * import { createSession, listSessions } from "../core/sessionStore.js";
 * 
 * AFTER:
 * import { loadSession, saveSession, createSession, listSessions } from "../core/memoryDB.js";
 * 
 * NEW FEATURES:
 * 
 * 1. Full-text search (FTS5):
 *    searchHistory("kubernetes deployment")
 *    // Returns sessions matching keyword dengan ranking
 * 
 * 2. Auto-generated titles:
 *    touchSession(sessionId, firstPrompt)
 *    // Sub-agent akan generate judul yang bermakna
 * 
 * 3. Facts management terintegrasi:
 *    rememberFact(sessionId, "User prefers React over Vue")
 *    listFacts(sessionId)
 * 
 * 4. Resume session via CLI:
 *    emora -r abc12345-6789-...
 *    // Langsung lanjutkan session terakhir
 * 
 * TROUBLESHOOTING:
 * 
 * Q: Error "better-sqlite3 not found"
 * A: npm install (pastikan di root project EMORA)
 * 
 * Q: Error "database is locked"
 * A: Pastikan tidak ada instance EMORA lain yang running
 * 
 * Q: Ingin kembali ke JSON?
 * A: git checkout core/memory.js core/sessionStore.js
 *    (tapi SQLite jauh lebih cepat!)
 * 
 * Q: Judul tidak auto-generate
 * A: Pastikan tool "generate_conversation_title" ada di tools list
 *    Check: grep titleGeneratorTool core/tools.js
 */
