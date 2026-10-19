---
name: obsidian_vault
description: Baca, cari, buat, atau ubah catatan di vault Obsidian user (lewat tool mcp_obsidian__*) — dipakai kapan pun user menyebut Obsidian, 'catatan saya', 'vault', 'daily note', atau minta sesuatu disimpan/dicari di knowledge base pribadinya.
categories: note-taking, research
---

# obsidian_vault

**Metadata**
- **name:** obsidian_vault
- **deskripsi:** Panduan memakai vault Obsidian user lewat tool MCP `mcp_obsidian__*` secara benar dan aman.
- **author:** EMORA (bawaan)
- **versi:** 1.0.0

## 🎯 Trigger

Pakai skill ini kapan pun user:
- Menyebut "Obsidian", "vault", "catatan saya", "knowledge base", "daily note", "second brain".
- Minta sesuatu **disimpan** ke Obsidian ("catet ini di Obsidian", "tambahin ke daily note hari ini").
- Minta sesuatu **dicari/dibaca** dari Obsidian ("cari catatan soal X", "apa isi note Project Y").
- Minta EMORA **mengorganisir/merapikan** catatan (rename, pindah folder, gabung beberapa note).

Kalau user menyebut hal-hal ini tapi tool `mcp_obsidian__*` TIDAK ada di daftar tool yang kamu punya, berarti koneksi belum di-setup — bilang ke user untuk menjalankan `emora obsidian setup` di terminal (butuh plugin community "Local REST API" aktif & Obsidian sedang terbuka), JANGAN coba akses vault lewat `read_file`/`write_file` biasa kecuali user secara eksplisit minta akses filesystem langsung.

## 🧰 Tool yang Tersedia

Semua tool berprefix `mcp_obsidian__` (nama asli tanpa prefix di dalam kurung):

| Tool EMORA | Fungsi |
|---|---|
| `mcp_obsidian__vault_list` (`vault_list`) | List file & subfolder di suatu direktori vault |
| `mcp_obsidian__vault_read` (`vault_read`) | Baca isi, frontmatter, tags, dan stat sebuah note |
| `mcp_obsidian__vault_write` (`vault_write`) | Buat note baru ATAU timpa seluruh isi note yang sudah ada |
| `mcp_obsidian__vault_append` (`vault_append`) | Tambahkan konten ke AKHIR note (aman, tidak menghapus isi lama) |
| `mcp_obsidian__vault_patch` (`vault_patch`) | Edit SURGIS: target heading/block-ref/frontmatter tertentu saja, tanpa sentuh sisa file |
| `mcp_obsidian__vault_delete` (`vault_delete`) | Hapus note (default ke trash, bukan hilang permanen) |
| `mcp_obsidian__vault_move` (`vault_move`) | Rename/pindahkan note ke path lain |
| `mcp_obsidian__vault_copy` (`vault_copy`) | Duplikat note ke path baru |
| `mcp_obsidian__vault_get_document_map` (`vault_get_document_map`) | List semua heading/block-ref/frontmatter field di 1 file — pakai ini SEBELUM patch supaya tahu target yang valid |
| `mcp_obsidian__active_file_get_path` (`active_file_get_path`) | Path note yang SEDANG TERBUKA di Obsidian saat ini |
| `mcp_obsidian__search_simple` (`search_simple`) | Full-text search (fuzzy) ke seluruh vault |
| `mcp_obsidian__search_query` (`search_query`) | Search terstruktur (JsonLogic) berdasar frontmatter/tag/path/isi |
| `mcp_obsidian__tag_list` (`tag_list`) | List semua tag di vault + jumlah pemakaiannya |
| `mcp_obsidian__command_list` (`command_list`) | List command Obsidian yang tersedia |
| `mcp_obsidian__command_execute` (`command_execute`) | Jalankan 1 command Obsidian by ID (seperti pakai command palette) |
| `mcp_obsidian__open_file` (`open_file`) | Buka sebuah note di UI Obsidian |

## 🛠️ Langkah-langkah (Workflow)

1. **SELALU cari dulu sebelum membuat note baru.** Panggil `search_simple` (atau `vault_list` di folder yang relevan) untuk cek apakah sudah ada note yang cocok — jangan bikin note duplikat untuk topik yang sudah ada catatannya, tambahkan (`vault_append`/`vault_patch`) ke note yang sudah ada kalau memang relevan.
2. **Prefer edit surgis (`vault_patch`/`vault_append`) di atas overwrite (`vault_write`).** `vault_write` menimpa SELURUH isi file — hanya pakai untuk note benar-benar baru. Untuk mengubah note yang sudah ada, pakai `vault_get_document_map` dulu untuk lihat struktur heading/frontmatter-nya, baru `vault_patch` ke target yang tepat.
3. **Ikuti gaya markdown Obsidian:** pakai `[[Wikilink]]` untuk menghubungkan antar-note (bukan link markdown biasa `[]()`), pakai `#tag` atau frontmatter `tags:` untuk kategorisasi, dan sertakan frontmatter YAML (`---\nkey: value\n---`) di baris paling atas kalau note butuh metadata (status, tanggal, sumber, dll).
4. **Untuk "daily note" / catatan harian**, cek dulu konvensi path yang user pakai (biasanya `Daily Notes/YYYY-MM-DD.md` atau sejenisnya — tanyakan atau cek lewat `vault_list` kalau belum tahu formatnya) sebelum menebak-nebak.
5. **Sebelum `vault_delete` atau `vault_write` yang menimpa note lama,** konfirmasi dulu ke user kalau notenya kelihatan penting/panjang — sama seperti aturan umum EMORA soal aksi destruktif.
6. **Note yang sedang aktif dibuka user** (`active_file_get_path`) sering relevan buat permintaan ambigu semacam "tambahin ke catatan ini" — cek itu dulu sebelum nanya user note mana yang dimaksud.

## ⚠️ Catatan/Limitasi

- Semua tool ini butuh **Obsidian sedang terbuka** di device tempat plugin Local REST API jalan — kalau semua panggilan tool gagal/timeout, kemungkinan besar Obsidian sedang tertutup, bukan masalah konfigurasi.
- Konten binary (gambar, PDF, dll) di vault bisa dibaca/ditulis lewat `vault_read`/`vault_write`, tapi EMORA tidak otomatis menampilkannya — sebutkan ke user kalau hasil operasinya berupa file binary.
- `vault_delete` defaultnya memindahkan ke trash Obsidian (bisa dipulihkan dari sana), bukan menghapus permanen — tapi tetap konfirmasi ke user dulu untuk note yang kelihatan penting.
