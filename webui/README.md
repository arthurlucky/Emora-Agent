# EMORA Web UI

Panel kontrol berbasis browser buat EMORA. Dipisah jadi dua bagian:

- **`server.js`** — backend Express. Jalan **di dalam proses Node yang sama** dengan `main.js` (di-import secara dinamis saat web mode aktif), jadi status gateway (Telegram/WhatsApp) yang ditampilkan selalu akurat dan gak ada resiko gateway ke-load dua kali. Expose REST API di `/api/*`.
- **`src/`** — frontend, dibangun pakai **Vite + vanilla JavaScript** (gak ada framework runtime kayak Vue/React). Di-build jadi static file di `webui/dist/`, lalu disajikan langsung oleh `server.js`.

## Fitur

1. **Chat** (`/`) — sidebar daftar sesi (buat baru, rename inline, hapus) + panel chat dengan prompt input ala CLI (`[xxxxxxxx] You >`).
2. **Gateway** (`/gateway`) — lihat status live Telegram & WhatsApp gateway, toggle aktif/nonaktif, edit token/nomor/allowlist. Perubahan ditulis ke `.env` dan butuh restart EMORA buat aktif (gateway cuma di-init sekali pas proses start).
3. **Config** (`/settings`) — editor AGENT.md & SOUL.md langsung dari browser, dengan indikator unsaved-changes per file. Simpan langsung invalidate cache system prompt — gak perlu restart.

## Setup

Dari root project:

```bash
npm install                 # dependency utama EMORA
npm run webui:install       # install dependency frontend (Vite) di webui/
npm run webui:build         # build frontend -> webui/dist/
npm start --web          # jalanin EMORA dengan web UI aktif
```

Setelah itu buka `http://localhost:5090` (atau port lain sesuai `WEBUI_PORT` di `.env`).

> Kalau lupa build dulu, `server.js` tetap jalan tapi route non-API bakal balikin pesan 503 yang ngingetin buat `npm run webui:build`.

## Mode development (hot-reload frontend)

Buat ngedit tampilan tanpa build ulang tiap kali:

**Terminal 1** — jalanin backend EMORA (otomatis nge-load `webui/server.js`):
```bash
npm start --web
```

**Terminal 2** — jalanin Vite dev server (hot-reload, proxy `/api` ke backend di terminal 1):
```bash
npm run webui:dev
```

Buka URL yang ditampilkan Vite (biasanya `http://localhost:5173`). Request ke `/api/*` otomatis di-proxy ke `http://localhost:5090` (lihat `vite.config.js`, bisa diubah lewat env var `EMORA_API_PROXY` kalau port backend-nya beda).

## Cara mengaktifkan Web UI

Web UI gak gantiin CLI — keduanya bisa jalan bareng. Tiga cara mengaktifkan:

- `npm start --web`
- `node main.js --web`
- set `WEBUI=true` di `.env`, lalu `npm start` biasa

## Struktur

```
webui/
├── server.js              # Backend Express + REST API
├── index.html             # Entry HTML (Vite)
├── vite.config.js         # Config build & dev proxy
├── public/                # Asset statis (favicon, dll)
└── src/
    ├── main.js             # Entry point, bootstrap shell + router
    ├── style.css           # Design system (terminal/operator-console theme)
    ├── router.js           # Router ringan berbasis History API
    ├── api.js              # Wrapper fetch ke /api/*
    ├── toast.js             # Notifikasi toast
    ├── dom.js / format.js   # Helper kecil
    ├── components/
    │   ├── nav.js           # Nav bar atas
    │   ├── sessionList.js   # Sidebar daftar sesi
    │   └── chatPanel.js     # Panel chat + input
    └── pages/
        ├── chat.js           # Halaman chat (gabung sessionList + chatPanel)
        ├── gateway.js        # Halaman kelola gateway
        └── settings.js       # Halaman editor AGENT.md / SOUL.md
```

## Catatan teknis

- Frontend pakai pola `create<Komponen>(container, handlers) -> { render(state) }`: event listener dipasang sekali lewat event delegation di container, `render()` cuma update `innerHTML` — jadi gak butuh virtual DOM/diffing buat skala UI ini.
- Nama sesi disimpan terpisah dari riwayat chat, di `memory/sessions.meta.json` (lihat `core/sessionStore.js`), karena `core/memory.js` aslinya cuma nyimpen array pesan tanpa metadata.
- Gateway Telegram/WhatsApp di kode EMORA didesain auto-start sekali pas modul di-import saat proses boot — Web UI ini sengaja **tidak** mencoba start/stop gateway secara live (resikonya tinggi, terutama untuk WhatsApp/Baileys), jadi toggle di UI cuma nulis ke `.env` dan minta restart manual.
