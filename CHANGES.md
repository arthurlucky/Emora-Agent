# Perbaikan bug TUI EMORA

Isi zip ini **cuma 6 file yang diubah** (bukan seluruh project) — tinggal
timpa ke folder `tui/` di project aslinya:

```
tui/state.js
tui/keys.js
tui/agentController.js
tui/App.js
tui/index.js
tui/slashCommands.js
```

Semua logika baru sudah diverifikasi dengan test terisolasi (59 test total,
jalan langsung terhadap kode asli yang sudah diedit — bukan kode tiruan)
karena sandbox saya gak ada akses network buat install dependency (`ink`,
`react`, `chalk`, dst) dan gak bisa buka sesi TTY interaktif buat nyoba
UI-nya langsung. Jadi sudah saya pastikan logikanya bener secara terisolasi,
tapi **tetap disarankan dites sendiri secara interaktif** sebelum dipakai
sehari-hari.

---

## 0. `✘ C is not defined` pas `/model` (dan laporan "disemua hal")

**Penyebab:** `tui/slashCommands.js` pakai `C.green()`, `C.bold()`,
`C.dim()`, `C.faint()` buat nge-render daftar provider tersimpan di command
`/model` (tanpa argumen) — tapi **file ini gak pernah import `C`** dari
`tui/styles.js` sama sekali (statis maupun dynamic). Jadi begitu `/model`
dijalankan tanpa argumen, baris pertama yang nyentuh `C` langsung lempar
`ReferenceError: C is not defined`. Karena SEMUA baris di cabang "daftar
provider" (list kosong maupun ada isinya) pakai `C`, command ini gagal total
di semua variannya — cocok sama laporan "disemua hal".

Saya juga nyisir **seluruh codebase** (tui/, core/, tools/, provider/,
gateway/, swarm/, mcp/, utils/) nyari pola yang sama (variabel/helper lokal
dipakai tapi gak pernah diimpor) pakai checker otomatis + baca manual
`slashCommands.js` baris per baris. Ketemu beberapa kandidat lain
(`setEnv`, `resolveAgentPath`, `classifyError`, `enforceLinkBudget`,
`isRunning` x2) tapi semuanya **false positive** setelah ditelusuri — sudah
di-import lewat `await import(...)` dinamis di scope yang sama (closure-nya
valid), atau ternyata cuma method class dengan nama kebetulan sama. Cuma
`C` di `slashCommands.js` yang bug nyata.

**Perbaikan:** tambah satu baris `import { C } from "./styles.js";` di
`tui/slashCommands.js`. Sudah dites end-to-end (bukan cuma cek syntax) —
manggil `/model` beneran dan pastikan hasilnya notice yang benar berisi
daftar provider, bukan crash. Command lain (`/help`, `/clear`, `/mode`, dll)
juga dites ulang buat mastiin gak ada regresi dari penambahan import ini.

---

## 1. Ctrl+C: pertama stop respons, kedua keluar

**Sebelum:** Ctrl+C cuma ditangani di dalam chat view. Kalau status
`"thinking"` → stop respons. Kalau bukan → **langsung keluar di penekanan
PERTAMA**, tanpa konfirmasi. Yang lebih parah: dialog approval tool
(`handleApprovalKeys`) dan view lain (history/skills/wizard/model-picker)
**sama sekali gak dengerin Ctrl+C** — kalau agent lagi nunggu approval tool
dan Ctrl+C dipencet, gak ada efek apa pun. Ini akar dari **bug "stuck, gak
bisa keluar"**: `ask()` di `core/chat.js` nyangkut selamanya di
`await onApproval(...)`, dan satu-satunya cara ngelepas promise itu ya lewat
`resolve()` — bukan `abort()`. Ctrl+C yang diabaikan = nyangkut permanen.

**Sesudah** (`tui/keys.js`, `tui/agentController.js`, `tui/state.js`):
- Ctrl+C ditangani **global**, di paling atas `handleKey()`, sebelum routing
  ke view manapun — jadi selalu nyala di semua state/view.
- Ctrl+C **pertama**: hentikan apa pun yang lagi jalan (thinking, tool-loop,
  streaming, ATAU nunggu approval — `isBusyStatus()` cek semuanya). Kalau
  idle, cuma "arm" tombol keluar + tampilkan hint di footer.
- `controller.stop()` sekarang **juga otomatis menolak approval yang
  pending** (`resolveApproval(false)`) sebelum abort — ini yang bikin
  approval prompt gak nyangkut lagi.
- Ctrl+C **kedua** dalam 2 detik (`EXIT_CONFIRM_MS`) setelah state balik
  idle → betulan keluar (`dispatch({type:"QUIT"})`).
- `tui/index.js`: ditambah **jaring pengaman** — 1.5 detik setelah proses
  quit (`app.waitUntilExit()` selesai), paksa `process.exit(0)` kalau ada
  handle yang entah kenapa masih nyangkut (pakai `.unref()` supaya gak
  nunda exit yang udah bersih).

## 2. Teks/notice command lama gak pernah hilang

**Sebelum:** reducer `SUBMIT_START` (dipanggil tiap kirim pesan baru) cuma
clear `state.error`, **lupa clear `state.notice`**. Notice dari command lama
(`/thinking off`, `/mode`, dll) numpuk terus di footer, nongol lagi di bawah
spinner turn yang baru — persis kayak contoh yang dikasih:
```
● ⠋ sedang berpikir...
✅ Thinking mode diubah ke "off".        <- notice BASI, harusnya udah hilang
```

**Sesudah** (`tui/state.js`): `SUBMIT_START` sekarang clear `notice`,
`noticeBig`, DAN `exitArmedAt` (biar gak ada sisa "armed" nyangkut ke turn
baru juga). `CLEAR_TRANSIENT` (Escape) ikut clear `exitArmedAt`.

## 3. TUI kelap-kelip pas AI merespon

Dua penyebab konkret, dua-duanya diperbaiki:

**a) Streaming token demi token** (`tui/agentController.js`) — provider
ngirim chunk kecil dgn frekuensi tinggi (puluhan/detik). Kode lama
dispatch `STREAM_CHUNK` di **tiap chunk** → Ink render ulang **full-screen**
tiap chunk (Ink gak diff per-baris buat konten non-`<Static>`, semua di-erase
& ditulis ulang tiap render). Sekarang chunk ditampung di buffer dan di-flush
ke reducer maks tiap 80ms — kerasa tetep "ngetik" real-time, tapi jumlah
repaint layar/detik jauh berkurang. Sudah dites: teks hasil rekonstruksi
tetap 100% utuh (gak ada karakter hilang/kepotong), termasuk saat di-Ctrl+C
di tengah jalan.

**b) `console.warn`/`console.error` langsung ke terminal** (`core/chat.js`
dkk, buat retry/compaction/dst) — kalau ini kejadian pas Ink lagi pegang
layar (alt-screen), tulisannya nyelip di luar area yang di-track Ink, bikin
layar "lompat"/kelap-kelip dan potensi sisa teks yang gak ke-clear.
**Sengaja gak diubah satu-satu di `core/chat.js`**, karena file itu dipakai
bareng sama gateway Telegram/WhatsApp/Discord/dll yang jalan headless (di
sana `console.error` justru berguna). Solusinya di `tui/index.js`: selama
sesi TUI aktif, semua `console.*` dialihkan ke file log
(`.emora/logs/emora.log`, sama yang dibaca `emora doctor`) lewat
`installConsoleGuard()`, dikembalikan lagi pas TUI keluar (jadi ringkasan
exit tetap kecetak normal). `render()` juga dipanggil dengan
`patchConsole:false` biar gak dobel sama mekanisme Ink sendiri.

**Tambahan kecil** (`tui/App.js`): interval tick spinner 120ms → 150ms
(masih halus di mata, repaint/detik berkurang), dan resize terminal
di-debounce 60ms (sebagian terminal ngirim banyak event resize beruntun pas
di-drag, tiap event = 1 repaint full-screen kalau gak ditahan).

## Bug lain yang ditemukan tapi CUMA dicatat (gak diubah)

Biar scope tetep fokus & risiko rendah, ini yang saya notice tapi sengaja
gak disentuh:

- Ada `console.log`/`console.warn`/`console.error` tersebar di beberapa
  file lain (`core/pluginHooks.js`, `core/tools.js`, `core/memoryDB*.js`,
  dst) yang **juga** bisa kejadian pas TUI aktif. `installConsoleGuard()` di
  `tui/index.js` (poin 3b di atas) nutup celah ini **secara umum** tanpa
  perlu ubah file-file itu satu-satu — jadi seharusnya udah ke-cover.
- `tui/App.js` punya satu `useEffect` tanpa dependency array (buat "pickup"
  LLM baru dari wizard) yang jalan tiap render — ini cara yang agak
  nyeleneh tapi sepertinya disengaja (satu-satunya cara nge-poll variabel
  global dari luar siklus render React), jadi gak saya utak-atik.
