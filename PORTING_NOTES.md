# Catatan Porting: TUI & Gateway (Go → JavaScript)

Dokumen ini menjelaskan hasil porting `tui/` dan `gateway/` dari sumber Go
(`tui-and-gateway.zip`, modul asalnya bernama **"awas"**) ke JavaScript murni,
terintegrasi ke project **EMORA** yang sudah ada. Brand "emora" dipertahankan
di semua tempat — tidak ada sisa nama "awas" di kode.

## Ringkasan Arsitektur

### TUI baru (`tui/`)
Full-screen terminal app pakai **Ink** (React untuk CLI) + **chalk** (dipakai
apa adanya seperti gaya EMORA yang lama). Ditulis dengan `React.createElement`
langsung (bukan JSX) karena EMORA dijalankan langsung lewat `node bin/emora.js`
tanpa build step.

- `tui/state.js` — state shape + reducer (mirip `model.go` + `update.go`).
- `tui/screen.js` — compose seluruh layar jadi string per-render (mirip
  `lipgloss.JoinVertical` di versi Go). Sudah diuji langsung (lihat bagian
  Testing) terhadap berbagai ukuran terminal supaya tidak ada overflow.
- `tui/markdown.js` — render markdown + syntax highlighting (`cli-highlight`),
  tabel, list, blockquote.
- `tui/keys.js`, `tui/slashCommands.js` — input keyboard & perintah `/...`.
- `tui/wizard.js` — setup wizard, pakai daftar provider ASLI EMORA
  (`provider/index.js`), bukan daftar provider dari versi Go.
- `tui/agentController.js` — jembatan reducer ↔ `core/chat.js` `ask()`.
- Ganti default `emora` (sebelumnya `main.js`) — `main.js` lama masih ada,
  tidak dihapus, tapi tidak lagi dipanggil `bin/emora.js`.

### Gateway baru (`gateway/`)
- `gateway/manager.js` — registry adapter + start/stop/status per platform,
  dipakai bareng oleh CLI (`emora gateway ...`) dan TUI (`/gateway`).
- `gateway/config.js` — config JSON (`gateway/gateways.config.json`), auto-
  migrasi dari `.env` lama supaya instalasi existing tidak perlu setup ulang.
- `gateway/cron/` — scheduler (`node-cron`), termasuk parser bahasa natural
  Indonesia ("jadwalin setiap jam 9 pagi ...") seperti versi Go.
- `gateway/daemon.js` — PID file + lock supaya TUI & daemon terpisah tidak
  dobel-poll platform yang sama.
- `gateway/service/` — installer systemd (Linux) / launchd (macOS) /
  Scheduled Task (Windows) buat jalanin gateway sebagai service.
- **Discord** (`gateway/discord/`) — BARU, pakai `discord.js`. Perintah
  dikirim sebagai teks biasa (`/status`, `/cron`, dst), approval pakai
  tombol (message components) — sengaja tidak pakai slash command Discord
  supaya tidak perlu proses registrasi application command.
- **Telegram** (`gateway/telegram/telegram.js`) — fitur lama (analisis
  foto/video/audio, group management) **dipertahankan semua**, ditambah
  command baru (`/status`, `/mode`, `/yes`/`/no`, `/stop`, `/cron`) + approval
  gate lewat inline keyboard.
- **WhatsApp** (`gateway/whatsapp/handler.js`) — sama, fitur lama
  dipertahankan + command baru ditambahkan.

### Perubahan di `core/chat.js`
Ditambahkan dukungan **opt-in** untuk approval gate & pembatalan (`/stop`):
`ask(llm, tools, sessionId, input, { onEvent, onApproval, mode, signal })`.
Kalau `onApproval` tidak diisi (semua caller lama: webui, dst), perilakunya
**persis sama seperti sebelumnya** — tool langsung jalan tanpa approval.

## Temuan Penting Selama Porting

1. **`gateway/whatsapp/whatsapp.js` (668 baris) ternyata tidak dipakai** —
   `gateway/index.js` sebenarnya mengimpor `whatsapp/main.js` + `handler.js`.
   Saya sempat mengedit `whatsapp.js` sebelum sadar ini, jadi editan di sana
   tetap ada (harmless, cuma gak jalan) tapi command baru yang BENAR-BENAR
   aktif ada di `handler.js`. Kalau file `whatsapp.js` ini memang sisa
   refactor yang ditinggalkan, aman untuk dihapus.
2. Provider Deepseek (`provider/deepseek/index.js`) ada file-nya tapi tidak
   terdaftar di `PROVIDERS`/`PROVIDER_PATHS` — di luar scope porting ini jadi
   tidak disentuh, TUI wizard hanya menampilkan 9 provider yang memang
   terdaftar.

## Simplifikasi yang Disengaja (jujur, bukan pura-pura ada)

- **`/undo`, `/redo`, `/undo-history`, `/indexing`** — EMORA belum punya
  version-tracking file otomatis atau code-symbol index, jadi command ini
  cuma kasih pesan informatif, bukan pura-pura berfungsi.
- **`/agentmode` (chat/simple/planned/deep)** — disimpan sebagai preferensi
  & note di prompt, TAPI tidak mengubah strategi eksekusi agent secara
  mendalam seperti kemungkinan di versi Go (EMORA cuma punya satu alur
  eksekusi tool-calling, tidak ada mesin "planned mode" terpisah).
- **`/stream`** — toggle tersimpan, tapi TUI belum streaming token-per-token
  asli (LLM call masih non-streaming, ditampilkan langsung setelah selesai).
  Bisa ditambahkan nanti lewat `.stream()` LangChain kalau dibutuhkan.
- **`/tasks`** — scaffolding UI ada, tapi belum terhubung ke tracking
  background-job granular (scheduler tool EMORA beda konsep dengan
  "background shell command" di versi Go).
- **State `askUser`** (agent nanya balik ke user) — scaffolding reducer +
  UI-nya sudah ada, tapi tidak ada yang memicunya karena EMORA belum punya
  tool `ask_user`. Siap dipakai kalau tool itu dibuat nanti.
- **WhatsApp start/stop dari Manager** — start/stop-nya best-effort (lihat
  komentar di `gateway/whatsapp/adapter.js`); Baileys tidak punya API restart
  bersih di tengah proses yang sama tanpa risiko korup state auth. Untuk
  restart total, matikan & jalankan ulang proses gateway-nya.
- **Discord tanpa slash command native** — pakai command teks biasa (lihat
  di atas), jadi tidak butuh proses invite ulang / app command registration.

## Dependency Baru

Ditambahkan ke `package.json`: `ink`, `react`, `discord.js`, `cli-highlight`.
Jalankan `npm install` sebelum coba `emora`.

## Testing

Sandbox ini tidak ada akses network (tidak bisa `npm install`), jadi:
- Semua logic yang cuma butuh Node builtin (parser jadwal cron + NLP bahasa
  Indonesia, JSON store, session manager, reducer, layout `screen.js`) **sudah
  dieksekusi & diuji langsung**, termasuk stress-test overflow layar di
  berbagai ukuran terminal (40x12 s/d 120x40) — semua lolos.
- File yang butuh `chalk`/`ink`/`react`/`discord.js`/`telegraf`/`node-cron`/
  `@whiskeysockets/baileys` divalidasi lewat `node --check` (syntax-only) +
  review manual cross-reference nama fungsi/export, karena package-nya belum
  ter-install di sandbox ini. **Disarankan jalankan `npm install` lalu coba
  `emora` dan `emora gateway setup` secara langsung** setelah menerima file
  ini, dan kabari kalau ada error runtime yang kelewat.

## Bug Fix: Pesan Kosong (Telegram & CLI/TUI)

Root cause-nya ada di `core/chat.js` (`ask()`), dipakai bareng oleh
TUI/CLI, Telegram, WhatsApp, Discord, cron, dan webui: `finalContent =
response.content` diambil apa adanya dari LLM. Ada 2 skenario yang bikin ini
jadi "kosong" waktu ditampilkan/dikirim:

1. **Completion beneran kosong** — kadang provider/model balikin `content: ""`
   walau `tool_calls`-nya sudah habis (paling sering muncul abis serangkaian
   tool call). Ini quirk provider/model, bukan sesuatu yang bisa "dicegah"
   dari sisi prompt.
2. **`content` berupa array of content block** (gaya sebagian integrasi
   Anthropic: `[{type:"text", text:"..."}]`) alih-alih string polos — kalau
   gak dinormalisasi, nyangkut jadi bukan-string di semua caller.

**Perbaikan** (sudah dites langsung dengan mock LLM, termasuk kombinasi
dengan tool-calling & approval flow — semua skenario lolos):
- `core/chat.js`: normalisasi array→string, dan kalau hasil akhir tetap
  kosong, **retry sekali** dengan nudge ke model, baru kalau masih kosong
  juga pakai fallback message yang jujur ("Maaf, aku belum nemu jawaban
  yang jelas..."). `ask()` sekarang dijamin gak pernah balikin string kosong.
- Lapisan pertahanan kedua di masing-masing pengirim (jaga-jaga kalau ada
  jalur lain yang lolos): `tui/agentController.js`,
  `gateway/telegram/sender.js` (`sendSafeMessage`), `gateway/whatsapp/handler.js`,
  `gateway/discord/index.js` — semua sekarang cek `.trim()` sebelum kirim,
  bukan cuma cek null/undefined.

## Cara Coba
```bash
npm install
emora setup          # kalau provider AI belum dikonfigurasi
emora                # buka TUI baru
emora gateway setup  # konfigurasi Telegram/WhatsApp/Discord
emora gateway run    # jalankan gateway sebagai daemon foreground
```
