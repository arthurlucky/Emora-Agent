# CHANGELOG — Perbaikan & Fitur Baru (menuju paritas Claude Code)

Semua perubahan di bawah dikerjakan sesuai urutan prioritas (tinggi → rendah)
dari hasil audit kode sebelumnya. Tiap item mencantumkan file yang diubah/
ditambahkan, dan (kalau ada) file test barunya. Jalankan `npm test` untuk
memverifikasi semuanya (45/46 test lolos di lingkungan pengembangan ini —
1 kegagalan di `tools/__tests__/verify.test.js` murni karena `node_modules`
belum di-`npm install`, BUKAN regresi dari perubahan ini).

---

## 1. `tools/patch.js` — uniqueness check + diff preview (PRIORITAS TERTINGGI)

**Masalah lama:** kalau `old_string` muncul lebih dari sekali di file, patch
diam-diam mengambil kecocokan PERTAMA tanpa pemberitahuan — risiko nyata
salah edit di file dengan pola berulang. Tidak ada preview sebelum menulis.

**Perbaikan:**
- Ditulis ulang jadi pencocokan **per-baris** bertingkat (bukan whole-string
  regex): `exact` → `trim-trailing` → `whitespace-normalized` →
  `ignore-comments` → `case-insensitive`. Tiap tingkat SEKARANG menghitung
  SEMUA kecocokan, bukan cuma yang pertama.
- Kalau ditemukan >1 kecocokan di satu tingkat → patch DITOLAK, error berisi
  nomor baris tiap kecocokan, minta konteks lebih spesifik ATAU
  `replace_all:true`.
- Setiap patch sukses mengembalikan diff bergaya unified-diff (`@@ ... @@`).
- Fallback lama yang paling longgar (`prefix-anchored`, cocokkan 60% awal
  string) sekarang **HARUS eksplisit** lewat `allow_risky_match:true` —
  sebelumnya otomatis dicoba tanpa sepengetahuan caller.
- `MAX_FILE_LINES` hard-block (500 baris → tolak, paksa `write_file`) DIHAPUS
  — dengan uniqueness check, patch di file besar sudah aman; sekarang cuma
  soft-warning di file >2000 baris.
- **Bonus:** 9 strategi lama disederhanakan jadi 5 (lebih deterministik,
  tidak ada lagi tumpang-tindih strategi yang hasilnya tergantung posisi
  baris di file, bukan pola `old_string` itu sendiri).

**File:** `tools/patch.js` (rewrite total), `tools/__tests__/patch.test.js`
(diperbarui + 2 test baru: ambiguous-match, replace_all).

---

## 2. `tools/search_text.js` — grep sungguhan

**Masalah lama:** substring match linear per baris, baca seluruh file ke
memori satu-satu, tanpa regex/context-line/glob-filter.

**Perbaikan:**
- Pakai `ripgrep` (`rg`) via `child_process.spawn` kalau terpasang di
  sistem (deteksi otomatis, silent fallback kalau tidak ada).
- Fallback JS murni (dipakai kalau `rg` tidak ada) SEKARANG juga mendukung
  hal yang sama: regex (`regex:true`), context line (`context_lines`),
  filter glob (`glob: "**/*.js"`), scope folder (`path`).
- `max_results` bisa diatur (dulu hardcoded 100).
- Tetap mengabaikan `node_modules`/`.git`/`dist`/dll secara default di
  kedua jalur (rg maupun fallback).

**File:** `tools/search_text.js` (rewrite total), `tools/__tests__/search_text.test.js` (baru).

---

## 3. `tools/todo_write.js` — task tracker (BARU, belum ada sama sekali)

Analog `TodoWrite` di Claude Code. Kontrak: kirim SELURUH daftar tiap kali
(bukan diff), field `{content, activeForm, status}`, maksimal 1 item
`in_progress` dalam satu waktu (validasi ditolak kalau lebih). Disimpan per
sesi di `.emora/todos/<sessionId>.json`. Output berupa checklist teks
(☐/▶/☑) supaya tampil rapi di TUI/webui/gateway manapun tanpa perlu UI
khusus.

**File:** `tools/todo_write.js` (baru), `tools/__tests__/todo_write.test.js` (baru).
Didaftarkan ke `core/tools.js` (masuk daftar `ESSENTIAL` — selalu tersedia).

---

## 4. Hook lifecycle `PreToolUse` / `PostToolUse` (BARU)

**Masalah lama:** cuma ada `SessionStart` & `UserPromptSubmit`. Plugin tidak
bisa intercept/audit/blokir tool call individual. **Bug tersembunyi yang
ikut ditemukan:** field `matcher` di `hooks.json` didokumentasikan tapi
TIDAK PERNAH benar-benar dicek — semua hook di suatu event selalu jalan
tanpa peduli matcher-nya.

**Perbaikan:**
- `hookEntryMatches()` baru — `matcher` (regex atau nama tool exact, `*`/
  kosong = semua) sekarang benar-benar difilter, dipakai di SEMUA event
  (termasuk yang lama).
- `runPreToolUseHooks()` — dijalankan tepat sebelum tool call. Hook boleh
  mengembalikan `{hookSpecificOutput:{permissionDecision:"deny", permissionDecisionReason:"..."}}`
  untuk MEMBLOKIR tool call. Fail-open kalau hook error/timeout.
- `runPostToolUseHooks()` — dijalankan setelah tool call selesai;
  `additionalContext`-nya ditempel ke `ToolMessage` yang dikirim balik ke
  model.
- Diintegrasikan ke `core/chat.js` `executeTool()`.
- **Bug lain yang ditemukan & diperbaiki:** `runOneHookCommand` menulis ke
  `child.stdin` tanpa listener `error` — kalau command hook tidak membaca
  stdin sama sekali (mis. `echo '...'`), ini bisa memicu `EPIPE` yang jadi
  `uncaughtException` dan meng-crash proses. Sekarang di-handle.

**File:** `core/pluginHooks.js`, `core/chat.js`, `core/__tests__/pluginHooks.test.js` (baru).

---

## 5. `tools/bash.js` — klasifikasi risiko 3 tingkat

**Masalah lama:** blacklist regex 1 tingkat. Sebagian pola TERLALU SEMPIT
(cuma menangkap `rm -rf /` literal, tidak `rm -rf /etc`, `rm -rf ~`,
`rm -rf *`). Sebagian lain TERLALU LEBAR (`eval`, `python3 -c`, `bash -c`
diblokir permanen tanpa jalan keluar, padahal sering dipakai legit).
**Bug tersembunyi yang ikut ditemukan:** regex deteksi fork bomb
(`:\(\)\s*\{.*fork`) mensyaratkan kata "fork" muncul literal di command —
padahal sintaks fork bomb asli (`:(){ :|:& };:`) TIDAK mengandung kata itu
sama sekali. Blacklist lama SECARA EFEKTIF TIDAK PERNAH mendeteksi fork
bomb sungguhan sejak awal.

**Perbaikan:**
- Logic dipindah ke modul terpisah `tools/lib/riskClassifier.js` (pure
  logic, tanpa `child_process`/gateway — supaya bisa diuji tanpa dependency
  berat).
- 3 tingkat: **HIGH** (hard block, tidak bisa di-override — fork bomb versi
  diperbaiki, `mkfs`, `dd`/raw write ke `/dev/sd*`, `shutdown`/`reboot`/dll,
  wipe literal `/` atau `~`), **MEDIUM** (soft block, perlu
  `confirm_risky:true` — hapus rekursif direktori sistem/`*`/`.`,
  `chmod 777`, `curl|wget` pipe ke shell, `base64 -d` pipe ke shell, `eval`,
  `bash -c`/`python3 -c`/`perl -e`/`ruby -e`, `git push --force`, `sudo su`,
  `crontab -r`, `iptables -F`, `history -c`, kill PID 1, `passwd`), **LOW**
  (jalan normal).
- Normalisasi command sebelum diklasifikasi (`rm "-rf" /` dengan kutip di
  sekitar flag tetap terdeteksi — celah bypass paling sederhana ditutup).
- **PENTING:** ini TETAP BUKAN sandbox sungguhan — filter level aplikasi,
  bukan isolasi proses/container. Didokumentasikan eksplisit di kode &
  AGENT.md supaya tidak disalahpahami sebagai pertahanan mutlak.

**File:** `tools/bash.js`, `tools/lib/riskClassifier.js` (baru),
`tools/lib/__tests__/riskClassifier.test.js` (baru).

---

## 6. `core/tools.js` — lazy tool loading

**Masalah lama:** `resolveLazyTools` regex-keyword-based; tool kritis
(`change_mode`, `verify`, `undo`, `redo`) TIDAK ada di `ESSENTIAL`, jadi bisa
"hilang" dari daftar tool begitu SATU kategori lain match (mis. user
menyebut kata soal file → tool ganti-mode jadi tidak terlihat sampai giliran
berikutnya).

**Perbaikan:**
- `ESSENTIAL` diperluas: `change_mode`, `verify`, `undo`, `redo`,
  `todo_write` sekarang SELALU ikut, berapa pun kategori yang match.
- **Bypass total** untuk model context besar (>= `LAZY_TOOLS_BYPASS_TOKENS`,
  default 32.000 token, dari `MODEL_CONTEXT_TOKENS` env atau parsing nama
  model) — model besar langsung dapat toolset penuh, regex filtering cuma
  dipakai untuk model kecil yang benar-benar butuh penghematan token.
- Registrasi `todo_write` dan `cost_status` ke tools bawaan + kategori
  keyword yang relevan.

**File:** `core/tools.js`. (Tidak ada test otomatis terpisah — modul ini
melakukan I/O berat & top-level `await` plugin-loading saat diimpor,
sehingga tidak cocok untuk unit test terisolasi tanpa dependency penuh
ter-install; disarankan verifikasi manual/integrasi.)

---

## 7. Housekeeping

- `package.json`: script `"test"` resmi ditambahkan (sebelumnya TIDAK ADA
  sama sekali meski sudah ada 6+ file `*.test.js`). **Catatan:**
  `node --test tools core` (path direktori bare) GAGAL di Node 22 — bare
  nama tanpa `./` di-resolve sebagai bare module specifier, bukan direktori.
  Harus pakai glob eksplisit: `node --test "tools/**/*.test.js" "core/**/*.test.js"`.
- `cli/cmd-doctor.js`: sekarang menjalankan test suite sebagai bagian dari
  diagnosa (melaporkan jumlah lolos/gagal), dan mendeteksi file `*.deprecated`
  yang tertinggal di repo.
- **File yang disarankan DIHAPUS MANUAL** (sudah dikonfirmasi tidak
  direferensikan kode manapun — hanya disebut di komentar/log yang mengakui
  deprecation-nya): `core/memoryDB.js.deprecated`,
  `core/memoryDB_fallback.js.deprecated`. Tidak disertakan di paket ini
  karena deletion tidak bisa direpresentasikan lewat file tambahan di zip.

---

## 8. `core/costTracker.js` + `tools/cost_status.js` — cost/token observability (BARU)

Sebelumnya EMORA sama sekali tidak melacak pemakaian token walau mendukung
banyak provider berbayar. Sekarang:
- `core/costTracker.js`: `recordUsage()` mengekstrak token in/out dari
  response LLM (`usage_metadata` atau `response_metadata.tokenUsage`,
  mendukung kedua bentuk yang dipakai provider berbeda di LangChain),
  diakumulasi per-sesi (`.emora/cost/<sessionId>.json`) DAN global
  (`.emora/cost/_global.json`), per model.
- Diintegrasikan (fire-and-forget, tidak pernah mengganggu alur chat kalau
  gagal) ke `core/chat.js` setelah setiap respons LLM (initial call MAUPUN
  tiap iterasi tool loop).
- `tools/cost_status.js`: tool baru, mirip `/cost` Claude Code — laporkan
  pemakaian token sesi ini + akumulasi global saat user bertanya.

**File:** `core/costTracker.js` (baru), `tools/cost_status.js` (baru),
`core/__tests__/costTracker.test.js` (baru). Didaftarkan ke `core/tools.js`.

---

## 9. Dokumentasi (`AGENT.md` / `CLAUDE.md` / `AGENT_LITE.md`)

`AGENT.md` dan `CLAUDE.md` (identik) ditulis ulang jadi lebih panjang &
lebih rinci: melengkapi Section 3 & 4 yang sebelumnya kosong (Tool
Development Standards, Testing & Quality Gates), dan mendokumentasikan
semua perubahan #1–#8 di atas sebagai bagian dari invariant arsitektur,
bukan cuma catatan changelog terpisah.

`AGENT_LITE.md` dibuat lebih KOMPLEKS (aturan baru soal patch ambiguity,
bash risk tier, todo_write, cost_status, subagent headless) tapi TETAP
ringkas/terse — gaya bullet-point pendek, bukan prosa panjang, karena
target modelnya kecil dan butuh instruksi padat, bukan konteks luas.

---

## Cara verifikasi

```bash
npm install        # kalau belum
npm test           # 45/46 lolos di lingkungan dev ini; 46/46 dengan deps lengkap
emora doctor       # sekarang ikut menjalankan test suite & cek file .deprecated
```
