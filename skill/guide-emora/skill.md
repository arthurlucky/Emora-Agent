---
name: guide-emora
description: Panduan lengkap cara pakai EMORA — semua interface, perintah, dan subsistem.
categories:
---

# guide-emora

**Metadata**
- **name:** guide-emora
- **deskripsi:** Panduan lengkap cara pakai EMORA — semua interface, perintah, dan subsistem.
- **author:** EMORA (bawaan)
- **versi:** 1.0.0

Ini adalah referensi MASTER buat EMORA sendiri (kalau user bertanya soal cara pakai) maupun manusia yang baca langsung. Kalau ada bagian yang bertentangan dengan skill lain yang lebih spesifik (mis. `skill/SKILL.md` soal cara nulis skill baru), yang lebih spesifik itu yang menang untuk topik itu — dokumen ini untuk gambaran besar.

---

## 1. Apa itu EMORA

EMORA adalah AI agent *autonomous*, *self-hosted*, multi-platform, multi-provider. Jalan di mesin sendiri (server/VPS/Termux/laptop), bisa dihubungkan ke banyak channel komunikasi sekaligus (Telegram, WhatsApp, Discord, Slack, Matrix), punya sistem skill & plugin yang bisa berkembang sendiri, dan bisa terhubung ke tool eksternal lewat MCP (Model Context Protocol) — termasuk Obsidian.

Tiga cara utama berinteraksi dengan EMORA:
1. **TUI** (`emora`) — antarmuka terminal interaktif, buat dipakai sendiri langsung dari CLI.
2. **Gateway** (`emora gateway run`) — EMORA nempel ke Telegram/WhatsApp/Discord/Slack/Matrix, orang lain (atau kamu dari HP) chat ke bot-nya.
3. **Web UI** (`emora --web`) — dashboard browser buat monitor & kontrol.

Ketiganya berbagi engine yang sama (`core/chat.js`), jadi skill/plugin/memory yang sama berlaku di mana pun kamu ngobrol dengan EMORA.

---

## 2. Instalasi & Setup Awal

```bash
curl -fsSL https://raw.githubusercontent.com/arthurlucky/Emora-Agent/main/install.sh | bash
```
Skrip ini: install Node.js (kalau belum ada, minimal v20), clone repo, `npm install`, siapkan `.env`, opsional `npm link` (biar command `emora` bisa dipanggil dari folder mana pun), dan opsional langsung jalanin wizard setup.

Kalau sudah punya foldernya (clone manual / dari zip):
```bash
cd emora
npm install
cp .env.example .env
npm link          # opsional, biar 'emora' jadi command global
emora setup       # atau: node setup.js
```

**Wizard setup** (`emora setup`) menu-nya:
- **AI Provider & Model** — pilih provider (Groq/Gemini/OpenRouter/NVIDIA/HuggingFace/Anthropic/OpenAI/Ollama/custom endpoint), masukkan API key, pilih model.
- **Messaging Gateway** — setup Telegram/WhatsApp/Discord/Slack/Matrix (bisa setup lebih dari satu, wizard akan nanya "setup platform lain?" berulang).
- **Obsidian (via MCP)** — hubungkan ke vault Obsidian (opsional, lihat bagian 8).
- **Web UI** — aktifkan dashboard browser + pilih port.
- **Nama & Identitas Agent** — nama yang dipakai EMORA pas ngobrol.

Semua pengaturan tersimpan di `.env` (provider/API key/nama) dan `gateway/gateways.config.json` (kredensial tiap platform gateway) — dua-duanya di-generate otomatis, jangan di-commit ke git kalau fork/push repo sendiri.

---

## 3. Menjalankan EMORA

| Perintah | Fungsi |
|---|---|
| `emora` atau `emora tui` | Buka TUI interaktif (default) |
| `emora gateway run` | Jalankan SEMUA gateway yang aktif di config, foreground (Ctrl+C buat stop) |
| `emora gateway start <platform>` | Jalankan satu platform aja |
| `emora gateway install-service` | Pasang sebagai service OS (systemd dll) — jalan terus di background, auto-restart |
| `emora --web` | Jalankan CLI + Web UI dashboard sekaligus |
| `emora status` | Lihat status semua komponen (provider, gateway aktif, plugin, dll) |

---

## 4. TUI — Perintah Dalam Chat

Semua ini diketik langsung di kolom chat TUI, diawali `/`:

```
/help                      - tampilkan daftar perintah
/clear                     - bersihkan layar (sesi tetap)
/reset                     - mulai sesi baru dari nol
/mode <safe|autonomous>    - kebijakan approval sebelum tool dijalankan
/agentmode <chat|simple|planned|deep> - gaya respons agent
/stream                    - toggle efek ketik (typewriter)
/setup (atau /switch)      - wizard ganti provider/model AI
/history                   - browser sesi tersimpan
/resume <judul>            - lanjutkan sesi lama by keyword
/skills                    - kelola skill (nyala/mati, lihat daftar lengkap termasuk dari plugin)
/tasks                     - lihat background task yang jalan
/gateway                   - status gateway
/plugin [list|disable|enable|reload|install] <nama|url> - kelola tool/plugin
/artifact [list|get|delete] <id> - kelola file/output tersimpan (Artifact)
/learn <nama_skill>        - ubah sesi chat SEKARANG jadi Skill baru (lihat bagian 6)
/undo /redo /undo-history  - batalkan/redo perubahan file yang dibuat EMORA
/exit, /quit               - keluar
```

**Yang paling sering dipakai dan gampang kelewat:** `/<nama_skill_atau_command>` — jalankan skill ATAU command apa pun (bawaan maupun dari plugin) langsung, tanpa nunggu EMORA memutuskan sendiri. Detail lengkap di bagian 5.

---

## 5. Menjalankan Skill/Command Manual — `/<nama>`

EMORA punya 2 cara pakai skill:
- **Otomatis** — EMORA baca katalog skill yang tersedia tiap giliran chat, dan pakai sendiri kalau relevan sama yang kamu minta. Kamu gak perlu ngapa-ngapain.
- **Manual** — kamu ketik langsung nama skill/command-nya diawali `/`, EMORA jalankan SEKARANG, gak nanya-nanya dulu.

**Skill bawaan** (folder `./skill/`, termasuk dokumen ini sendiri) — nama polos aja, gak perlu prefix:
```
/frontend-design
/obsidian_vault cari catatan soal onboarding
/changelog_generator
```

**Skill/command dari PLUGIN** — begitu plugin selesai diinstall, langsung bisa dipakai, TANPA restart, dengan format **namespaced** (persis kayak Claude Code/Antigravity CLI/OpenClaw):
```
/<id_plugin>:<nama>
```
Contoh: plugin `ponytail` yang punya command `ponytail-audit` → `/ponytail:ponytail-audit`.

Bentuk pendek `/<nama>` (tanpa prefix plugin) JUGA jalan, SELAMA namanya unik di antara semua plugin yang terpasang. Kalau ada 2+ plugin dengan nama yang sama persis, EMORA gak akan menebak — dia kasih daftar pilihan dan minta kamu sebutkan salah satu pakai bentuk lengkap `plugin:nama`.

Ini berlaku di **SEMUA antarmuka** — TUI, Telegram, WhatsApp, Discord, Slack, Matrix — mekanismenya sama persis di semua tempat.

Cek skill/command apa aja yang tersedia: `/skills` (TUI) atau `emora skills list` (CLI).

---

## 6. Membuat Skill Baru

Tiga cara:

1. **Otomatis dari sesi chat** — abis ngobrol/ngerjain sesuatu yang berguna dan mau diulang, ketik `/learn <nama_skill>` di TUI. EMORA susun instruksi dari sesi itu jadi skill baru di `./skill/<nama_skill>/`.
2. **Otomatis dari pola yang terdeteksi** — EMORA (lewat tool `skill_factory`) memantau pola pemakaian tool yang berulang dan bisa menyarankan skill baru sendiri.
3. **Manual** — buat folder `./skill/<nama>/` isinya `skill.md` (instruksi, format bebas markdown) + `meta.json` (`{"description": "...", "version": "1.0.0"}`). Begitu foldernya ada, otomatis kebaca — gak perlu restart.

Detail lengkap format skill & filosofinya ada di `skill/SKILL.md`.

---

## 7. Plugin — Instal Kapabilitas dari Luar

Plugin = paket yang nambahin skill/command/tool/koneksi MCP ke EMORA, formatnya DISTANDARKAN mengikuti ekosistem Claude Code/Codex/Hermes Agent, jadi plugin yang dibuat buat tools lain (mis. dari GitHub) bisa langsung dipasang di EMORA tanpa modifikasi.

```bash
emora plugin install <url_github_atau_path_lokal>
emora plugin list                    # lihat semua plugin & tool terpasang
emora plugin disable <nama_tool>     # matikan 1 tool tertentu (live, gak perlu restart)
emora plugin enable <nama_tool>
emora plugin reload <plugin_id>      # reload kode plugin yang sudah di-edit
```

Plugin bisa menyediakan (boleh gabungan beberapa):
- **skills/** — sama seperti skill bawaan, otomatis + bisa dipanggil manual `/plugin:nama`.
- **commands/** — slash command manual, isi `.md` atau `.toml` (format Codex), boleh pakai placeholder argumen `$ARGUMENTS` (khusus command — skill seperti dokumen ini tidak memprosesnya, jadi aman disebut sebagai teks biasa).
- **tool JS** (`index.js`, format lama EMORA-native) — fungsi LangChain yang dipanggil LLM langsung.
- **`.mcp.json`** — mendaftarkan server MCP otomatis (lihat bagian 8).
- **hooks/** — lihat sub-bagian di bawah.

### Hooks (Plugin yang "Selalu Aktif")

Sebagian plugin (mis. yang mengubah gaya coding EMORA secara terus-menerus) gak cuma nambah command — mereka aktif TERUS di setiap giliran chat lewat `hooks/hooks.json`. Karena hook = command shell yang jalan OTOMATIS, EMORA gak pernah menjalankannya sampai kamu **trust** eksplisit:

```bash
emora plugin install <url>        # kalau plugin ini punya hooks, muncul prompt konfirmasi
                                    # (nunjukin PERSIS command apa yang bakal jalan)
emora plugin list-hooks            # lihat plugin mana yang punya hooks & status trust-nya
emora plugin trust-hooks <id>      # aktifkan setelah kamu review
emora plugin untrust-hooks <id>    # matikan lagi kapan saja
```
Plugin yang belum di-trust TETAP bisa dipakai skill/command/tool-nya secara normal — cuma hook-nya aja yang gak jalan sampai di-trust.

---

## 8. MCP Server — Menghubungkan Tool Eksternal

MCP (Model Context Protocol) adalah standar terbuka buat menyambungkan AI agent ke tool/data eksternal — dipakai juga oleh Claude Desktop/Claude Code. EMORA bisa jadi CLIENT (konsumsi tool dari server MCP luar) lewat dua transport: `stdio` (child process lokal) dan `http` (Streamable HTTP, buat server remote/lokal berbasis web).

```bash
emora mcp                # kelola server MCP (add/list/remove)
```
Tool dari server MCP yang tersambung otomatis muncul dengan nama `mcp_<server>__<tool>`.

### Obsidian

EMORA bisa baca/tulis/cari catatan di vault Obsidian secara langsung, lewat server MCP bawaan plugin community **"Local REST API"** (bukan akses file mentah — jadi tetap sinkron sama apa yang kelihatan di app Obsidian).

Prasyarat: install & aktifkan plugin "Local REST API" di Obsidian, salin API key-nya (Settings → Local REST API), pastikan Obsidian sedang terbuka.

```bash
emora obsidian setup     # wizard: protokol, host, port, API key, tes koneksi
emora obsidian status    # cek konfigurasi tersimpan
emora obsidian test      # tes ulang koneksi & lihat daftar tool
emora obsidian remove    # putuskan koneksi
```
Setelah tersambung, skill bawaan `obsidian_vault` otomatis ngajarin EMORA cara pakai tool-nya dengan benar (cari dulu sebelum bikin catatan baru, prefer edit surgis daripada timpa seluruh isi, dst) — lihat `/obsidian_vault`.

---

## 9. Gateway — Chat Lewat Telegram/WhatsApp/Discord/Slack/Matrix

Setup lewat wizard (`emora setup` → Messaging Gateway) atau langsung:
```bash
emora gateway setup      # pilih platform, isi kredensial
emora gateway run        # jalankan semua platform yang aktif (foreground)
emora gateway status     # lihat platform mana yang aktif & daemon jalan atau enggak
emora gateway users      # lihat sesi/user yang lagi aktif
```

Kredensial yang dibutuhkan tiap platform:
- **Telegram** — Bot Token dari [@BotFather](https://t.me/BotFather).
- **WhatsApp** — nomor WhatsApp (pairing code muncul di terminal saat pertama connect, bukan QR code).
- **Discord** — Bot Token + (opsional) Guild ID, dari [Discord Developer Portal](https://discord.com/developers/applications).
- **Slack** — Bot Token (`xoxb-...`) + App-Level Token (`xapp-...`, butuh Socket Mode aktif), dari [api.slack.com/apps](https://api.slack.com/apps).
- **Matrix** — Homeserver URL, Access Token, User ID (Element → Settings → Help & About → Advanced).

Di dalam chat gateway, perintah dasar yang sama tersedia: `/status`, `/reset`, `/mode`, `/<nama_skill_atau_command>`, dan sebagainya (ketik `/help` di platform manapun buat daftar lengkap platform itu).

**Jalankan permanen (production):**
```bash
emora gateway install-service    # pasang sebagai systemd service, auto-start & auto-restart
emora gateway service-status
emora gateway restart-service
emora gateway uninstall-service
```

**Kirim pesan one-shot** (cocok buat dipanggil dari cron job/script lain):
```bash
emora send "Deploy berhasil ✅"                         # ke platform aktif
emora send --to=telegram "Hei dari cron job"
emora send --to=whatsapp --number=6281xxxxxxx "Hello"
echo "$(df -h)" | emora send --to=telegram               # pipe stdout
```

---

## 10. Cron — Jadwal Otomatis

Dari dalam chat gateway manapun, gunakan `/cron` (cek `/cron help` untuk sintaks lengkap) buat menjadwalkan EMORA menjalankan sesuatu berkala — mis. "tiap jam 8 pagi cek cuaca dan kirim ke grup". Dikelola juga lewat `emora gateway cron <sub-command>` dari CLI.

---

## 11. Artifact

Artifact = file/output yang EMORA hasilkan dan simpan (laporan, kode, gambar, dll), bisa diambil lagi kapan saja tanpa minta EMORA generate ulang.
```
/artifact list             - lihat semua artifact tersimpan
/artifact get <id>         - ambil satu artifact
/artifact delete <id>      - hapus
```

---

## 12. Swarm / Container

```bash
emora swarm create <nama>   # buat sub-agent baru yang jalan terisolasi
emora swarm start <nama>
emora swarm stop <nama>
emora swarm list
```
Dipakai buat menjalankan beberapa instance EMORA yang saling terpisah (mis. beda konteks/project) dari satu instalasi.

---

## 13. EMORA Hub — Community Skill & Tool

```bash
emora community --setkey=<apikey>            # simpan API key EMORA Hub (dari akun Hub kamu)
emora install:skill <@user/nama>              # install skill orang lain
emora install:tool <@user/nama>
emora publish:skill --namaskill=<nama> [--desc=<desc>] [--tags=<t1,t2>]
emora publish:tool --namatool=<nama> [--desc=<desc>] [--tags=<t1,t2>]
```

---

## 14. Memory & Sesi

Tiap percakapan (per chat/channel) punya `sessionId` sendiri, riwayatnya disimpan di `./memory/`. Perintah terkait (TUI): `/history` (lihat semua sesi tersimpan), `/resume <judul>` (lanjutkan sesi lama), `/reset` (mulai sesi baru dari nol tanpa menghapus histori lama), `/clear` (bersihkan layar terminal saja, sesi tetap jalan).

Riwayat mentah per sesi otomatis dipotong ke ~24 pesan terakhir tiap turn (biar gak makin lambat/mahal makin panjang obrolan) — tapi ada 2 lapisan tambahan yang gak ikut kepotong, dipakai EMORA secara **otomatis & proaktif** tanpa perlu diminta:

- **Fakta durable per sesi** — begitu kamu sebut sesuatu yang kemungkinan besar masih relevan puluhan pesan ke depan (preferensi, keputusan yang disepakati, detail konteks kerja), EMORA menyimpannya lewat tool internal `session_memory` (action `remember`) dan menyuntikkannya ulang ke tiap turn berikutnya — jadi gak "lupa" walau riwayat mentahnya sudah kegeser keluar window.
- **Pencarian lintas-sesi** — kalau kamu menyebut sesuatu yang terasa seperti kelanjutan obrolan lama (sesi yang berbeda/sudah lama), EMORA bisa mencari lintas semua sesi tersimpan (`session_memory` action `search_history`) sebelum minta kamu mengulang dari awal.

---

## 15. Troubleshooting Cepat

| Gejala | Kemungkinan penyebab & solusi |
|---|---|
| `emora plugin list` kosong padahal baru install | Pastikan pakai versi EMORA terbaru — versi lama tidak scan ulang dari disk tiap invocation CLI |
| `/plugin:command` gak jalan / gak ketemu | Cek `emora plugin list` — pastikan plugin ke-install dengan skill/command count > 0. Coba bentuk lengkap `plugin:nama` kalau bentuk pendek bilang ambigu |
| Plugin ada hooks tapi kelihatannya gak ngefek | Hook TIDAK auto-jalan — jalankan `emora plugin trust-hooks <id>` dulu (lihat bagian 7) |
| Tool baru dari plugin/MCP gak muncul di LLM | Restart gateway/TUI — tool baru cuma "dikenal" LLM saat proses start (batasan arsitektur function-calling, bukan bug) |
| WhatsApp gak connect | Jalankan `emora gateway run`, tunggu pairing code muncul di terminal, masukkan di app WhatsApp → Linked Devices |
| Provider API key salah/expired | `emora setup` → AI Provider & Model, masukkan ulang |
| Obsidian tool gagal konek | Pastikan app Obsidian sedang TERBUKA, plugin "Local REST API" aktif, lalu `emora obsidian test` |

Kalau masih stuck, jalankan `emora status` buat lihat kondisi semua komponen sekaligus.
