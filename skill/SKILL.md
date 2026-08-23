# 📘 Dokumentasi Sistem Skill (Universal)

## 📁 Struktur Folder

```txt
/skill/
├── auto_code_reviewer/
│   ├── meta.json
│   └── skill.md
├── auto_generate_tools/
│   ├── meta.json
│   └── skill.md
├── <nama_skill_lain>/
│   ├── meta.json
│   ├── skill.md
│   └── run.sh        (opsional, kalau workflow-nya deterministik)
```

Setiap skill adalah satu folder di dalam `/skill/`, berisi minimal `skill.md` (dokumen utama) dan `meta.json` (metadata ringkas dipakai katalog). `run.sh` opsional, hanya ada kalau skill itu punya langkah yang bisa direproduksi sebagai script shell tanpa butuh penilaian LLM di tiap langkahnya.

---

## 🧠 Konsep Skill

Skill adalah unit kemampuan terstruktur yang digunakan untuk menyelesaikan suatu tujuan tertentu di berbagai domain, baik teknis maupun non-teknis.

Skill berfokus pada:
- **hasil** (output) — apa yang dihasilkan di akhir
- **alur kerja** (process) — urutan langkah yang konsisten dan bisa diulang
- **konteks penggunaan** (use case) — kapan skill ini relevan dipakai
- **dokumentasi yang konsisten** — format yang sama di semua skill, supaya gampang dibaca ulang oleh EMORA maupun manusia

Skill BUKAN kode/tool baru — skill adalah *panduan* yang memberi tahu EMORA cara terbaik memakai tool-tool yang sudah ada (read_file, write_file, shell_exec, project_manager, dll) untuk mencapai suatu tujuan secara konsisten.

---

## 🤖 Bagaimana EMORA Menemukan & Memakai Skill

EMORA TIDAK perlu menebak-nebak nama folder skill. Setiap system prompt secara otomatis menyertakan blok `[AVAILABLE SKILLS]` berisi daftar semua skill yang ada (nama + deskripsi singkat, dibaca langsung dari `meta.json` tiap skill). Begitu permintaan user cocok dengan deskripsi salah satu skill di katalog itu, EMORA akan otomatis memanggil `skill_factory` (action: `read_skill`, `skill_name_target: "<nama>"`) untuk membaca isi lengkapnya, lalu mengikuti langkah-langkahnya — **tanpa bertanya dulu ke user apakah boleh memakai skill tersebut.**

Karena itu, kualitas field `description` di `meta.json` sangat penting: itulah satu-satunya hal yang dibaca EMORA di SETIAP turn untuk memutuskan apakah suatu skill relevan atau tidak. Tulis deskripsi yang jelas dan spesifik tentang KAPAN skill ini relevan dipakai.

---

## 📄 Struktur Isi `skill.md`

Setiap file `skill.md` mengikuti format berikut:

```md
# <nama_skill>

**Metadata**
- **name:** <nama_skill>
- **deskripsi:** <satu kalimat fungsi utama skill ini>
- **author:** <pembuat skill, mis. "EMORA Skill Factory (auto-generated)" atau nama manusia>
- **versi:** 1.0.0

## 🎯 Trigger
Kapan skill ini relevan dipakai — daftar contoh permintaan user yang harus memicu skill ini.

## 🛠️ Langkah-langkah (Workflow)
Langkah-langkah konkret, urut, yang harus diikuti EMORA untuk menyelesaikan tugas ini secara konsisten.

## 🧰 Tools yang Digunakan
Daftar tool EMORA yang dipakai di tiap langkah (read_file, write_file, shell_exec, dll).

## 📝 Contoh Penggunaan
Contoh singkat percakapan user -> aksi EMORA.

## ⚠️ Catatan/Limitasi
Batasan, asumsi, atau hal yang perlu diperhatikan saat memakai skill ini.
```

### Penjelasan Field Metadata

#### name
Nama skill yang jelas dan spesifik, snake_case, dipakai juga sebagai nama folder.
Contoh: `auto_code_reviewer`, `changelog_generator`, `bulk_file_organizer`.

#### deskripsi
Penjelasan singkat (idealnya satu kalimat) tentang fungsi utama skill. Fokus pada APA yang skill ini lakukan dan KAPAN relevan dipakai — bukan detail implementasi. Ini yang muncul di katalog `[AVAILABLE SKILLS]`, jadi tulis sejelas mungkin.

#### author
Siapa yang membuat skill ini — `"EMORA Skill Factory (auto-generated)"` untuk skill yang dibuat otomatis lewat pattern/project evaluation, atau nama pembuatnya kalau ditulis manual.

#### versi
Versi skill, format semver sederhana (`1.0.0`). Naikkan kalau skill di-update signifikan.

---

## ➕ Menambah Skill Baru

Skill baru SELALU dibuat lewat tool `skill_factory` (action: `create_skill`), bukan ditulis manual dengan `write_file` — ini memastikan `meta.json` ikut terbuat dan katalog `[AVAILABLE SKILLS]` otomatis ter-update. Lihat AGENT.md bagian 14A (pattern-based) dan 14B (project-based) untuk protokol lengkapnya.

---

## 📋 Skill Index

Daftar singkat semua skill yang tersedia saat ini (lihat folder masing-masing untuk detail lengkap):

- **auto_code_reviewer**: Melakukan audit kode otomatis untuk mendeteksi bug, keamanan, dan optimasi best practice.
- **auto_generate_tools**: Otomatisasi pembuatan tool baru untuk sistem AI berdasarkan standar DynamicStructuredTool.
- **random_file_gen**: Membuat file dengan konten random untuk keperluan testing.
- **react_uiux**: Panduan komprehensif untuk mengimplementasikan desain UI/UX ke dalam komponen React.js dengan fokus pada aksesibilitas, performa, dan skalabilitas.
- **api_integration_helper**: Integrasikan API pihak ketiga ke dalam project: baca dokumentasinya, buat wrapper module, simpan kredensial di .env, dan uji coba pemanggilannya.
- **env_config_auditor**: Audit keamanan konfigurasi project: cari secret/API key yang ke-hardcode di kode, pastikan .env tidak ter-commit ke git, dan beri rekomendasi perbaikan.
- **changelog_generator**: Membuat atau memperbarui CHANGELOG.md secara terstruktur berdasarkan riwayat commit git terbaru.
- **scheduled_backup_setup**: Setup backup terjadwal otomatis untuk folder/file penting, menggabungkan backup_manager dan scheduler agar berjalan berkala tanpa campur tangan manual.
- **dependency_health_check**: Cek kesehatan dependency project (package.json): versi usang, potensi konflik, dan advisory keamanan yang diketahui publik, tanpa menginstall apapun.
- **log_triage**: Membaca dan menganalisis file log untuk menemukan pola error berulang, meringkas root cause, dan menyarankan perbaikan.
- **markdown_report_writer**: Menyusun laporan atau dokumentasi teknis dalam format Markdown yang rapi dan terstruktur dari data mentah, hasil analisis, kode, atau ringkasan percakapan.
- **bulk_file_organizer**: Mengorganisir sekumpulan file secara massal: rename berdasarkan pola, pindahkan ke subfolder berdasarkan ekstensi/tanggal/konten, dan hapus duplikat atau file sampah.
- **website_health_check**: Cek kesehatan website atau endpoint API: apakah dapat diakses, berapa response time-nya, apakah SSL-nya masih valid, dan apa ada error yang terdeteksi.
- **group_broadcast_announcer**: Menyusun dan mengirimkan pengumuman/broadcast yang terstruktur ke grup Telegram atau WhatsApp aktif, dengan format yang disesuaikan per platform.
- **obsidian_vault**: Baca, cari, buat, atau ubah catatan di vault Obsidian user lewat tool MCP `mcp_obsidian__*` (butuh `emora obsidian setup` dulu — lihat bagian 15 di bawah).
- **guide-emora**: Panduan MASTER cara pakai EMORA — semua perintah CLI, TUI, gateway, sistem skill/plugin, MCP, cron, artifact, dan troubleshooting. Pakai kalau user nanya "gimana cara pakai kamu" atau bingung soal fitur apa saja yang ada.

---

## 🔌 Skill & Command dari Plugin (format standar Claude Code / Hermes Agent)

Selain skill bawaan di folder ini, EMORA juga membaca skill & command yang datang dari **plugin** (`./plugins/<id>/`), memakai layout yang SAMA dengan yang dipakai Claude Code, Hermes Agent, dan CLI agent lain — jadi plugin dari luar bisa langsung dipasang tanpa ditulis ulang:

```txt
plugins/<id>/
├── .claude-plugin/plugin.json   (manifest standar — atau plugin.json di root, legacy)
├── skills/<nama>/SKILL.md       (sama persis konsepnya dengan skill.md di atas)
├── commands/<nama>.md           (satu file = satu slash command, boleh pakai $ARGUMENTS)
├── hooks/hooks.json             (opsional, dicatat tapi belum dieksekusi)
├── .mcp.json                    (MCP server bawaan plugin, otomatis disambungkan)
└── index.js                     (opsional, legacy: tool LangChain EMORA-native)
```

Plugin skill & command otomatis masuk katalog `[AVAILABLE SKILLS]` (LLM bisa pakai otomatis) DAN bisa dipanggil manual — lihat bagian 15.

### Hooks — "selalu aktif setiap turn" (bukan cuma command manual)

Beberapa plugin (mis. **ponytail**) gak cuma nambah command — mereka juga punya `hooks/hooks.json` yang bikin perilakunya AKTIF TERUS di setiap turn tanpa perlu dipanggil manual (mis. mode yang disuntik ke context di SETIAP prompt). EMORA menjalankan hook ini persis sesuai kontrak Claude Code:

- `SessionStart` — jalan sekali di awal sesi.
- `UserPromptSubmit` — jalan di SETIAP prompt user.
- Command hook dijalankan lewat shell, boleh pakai `${CLAUDE_PLUGIN_ROOT}`/`${PLUGIN_ROOT}` (di-substitusi ke path absolut folder plugin), dapat input JSON lewat stdin (`hook_event_name`, `session_id`, `cwd`, `prompt`), dan output-nya (JSON `hookSpecificOutput.additionalContext`, ATAU teks polos) disuntik ke system prompt turn itu.

**PENTING — soal keamanan:** hook = command shell arbitrary yang jalan OTOMATIS. EMORA TIDAK PERNAH menjalankan hook plugin manapun sampai user secara eksplisit **trust** plugin itu — muncul prompt konfirmasi otomatis (menampilkan persis command apa yang bakal jalan) saat `emora plugin install`, atau kelola manual lewat:
```
emora plugin trust-hooks <id>
emora plugin untrust-hooks <id>
emora plugin list-hooks
```
Plugin yang belum di-trust TETAP bisa dipakai skill/command/tool-nya secara normal — cuma hook-nya aja yang gak jalan sampai di-trust.

---

## 15. ⌨️ Menjalankan Skill/Command Secara Manual — `/<nama>`

SEMUA skill (bawaan ATAU dari plugin) dan command (dari plugin) bisa dijalankan langsung oleh user, tanpa menunggu EMORA memutuskan sendiri.

**Skill bawaan** (folder `./skill/`) — cukup nama polos, gak perlu prefix apa-apa, karena sumbernya cuma satu jadi gak mungkin tabrakan nama:
```
/<nama_skill> [argumen opsional]
```
Contoh: `/obsidian_vault cari semua note soal onboarding`.

**Command/skill dari PLUGIN** — begitu plugin selesai diinstall (`emora plugin install <url>` / `/plugin install <url>`), SEMUA command & skill di dalamnya LANGSUNG bisa dipanggil, tanpa restart, dengan format **namespaced** persis seperti Claude Code / Antigravity CLI / OpenClaw:
```
/<id_plugin>:<nama_command_atau_skill> [argumen opsional]
```
Contoh: install plugin dari `github.com/DietrichGebert/ponytail` (jadi `plugins/ponytail/`, punya `commands/ponytail-audit.md`) → langsung bisa dipanggil `/ponytail:ponytail-audit`.

Bentuk pendek `/<nama>` (tanpa prefix `plugin:`) JUGA jalan untuk command/skill dari plugin, SELAMA namanya unik di antara semua plugin yang terpasang. Kalau ada 2+ plugin yang kebetulan punya command/skill dengan nama sama, EMORA gak akan menebak salah satu — dia balas daftar pilihan dan minta pakai bentuk lengkap `/plugin:nama` untuk memperjelas. Bentuk namespaced (`plugin:nama`) SELALU jalan dan gak pernah ambigu, jadi itu yang paling aman dipakai kalau ragu.

Ini berlaku di **SEMUA antarmuka** — TUI, Telegram, WhatsApp, Discord, Slack, dan Matrix — dengan mekanisme yang sama: EMORA mendeteksi `/<nama>` (atau `/plugin:nama`) yang cocok dengan entry di katalog skill/command (lihat `core/skillRegistry.js`, dibaca langsung dari disk tiap kali — jadi plugin baru langsung "kebaca" tanpa restart), lalu menyuntikkan isi skill/command tersebut sebagai instruksi WAJIB-dijalankan-sekarang ke giliran itu (bukan sekadar hint seperti katalog otomatis) — argumen setelah nama disisipkan ke placeholder `$ARGUMENTS` kalau command-nya punya, atau ditambahkan sebagai konteks tambahan kalau tidak. Kalau `/<nama>` tidak cocok dengan skill/command manapun, EMORA memperlakukannya sebagai pesan chat biasa.
