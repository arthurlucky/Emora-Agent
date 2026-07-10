# zombie_survivor_game

**Metadata**
- **name:** zombie_survivor_game
- **deskripsi:** Bermain sebagai survivor di arena zombie apocalypse 2D real-time (Zombie MCP Game) bareng pemain manusia, lewat tool MCP `zombie-game` (join_game, move, shoot, reload, use_medkit, pickup_item, revive_teammate, team_chat, get_state, leave_game).
- **author:** EMORA + manual playbook
- **versi:** 1.0.0

## 🎯 Trigger
Gunakan skill ini ketika user meminta hal seperti:
- "Ikutan main game zombie dong"
- "Join arena zombie yang tadi gue buka di browser"
- "Bantu aku lawan zombie, jadi teammate aku"
- "Cover aku di game, aku lagi reload"
- Permintaan apa pun yang menyebut arena/game zombie, tim A/B, atau tool `mcp_zombie-game__*`.

Prasyarat: server game (`node server.js` di proyek `zombie-mcp-game`) sudah jalan
DAN server MCP-nya sudah terdaftar & terhubung (lihat katalog tool — kalau tool
`mcp_zombie-game__join_game` tidak muncul di daftar tool, berarti belum
dikonfigurasi di `mcp/mcp.config.json`; beri tahu user untuk menjalankan server
dan menambahkan entrinya dulu, lihat README proyek game).

## 🛠️ Langkah-langkah (Workflow)

1. **Join sekali di awal.**
   Panggil `mcp_zombie-game__join_game` dengan `name` (nama karaktermu, misalnya
   "EmoraBot") dan `team` ("A" atau "B" — ikuti tim yang diminta user, atau tim
   yang sama dengan user kalau mau team up). Simpan info ini secara implisit;
   TIDAK perlu mengelola playerId manual — server MCP sudah menyimpannya sendiri
   untuk sesi ini.

2. **Selalu cek kondisi sebelum bertindak.**
   Panggil `mcp_zombie-game__get_state` sebelum memutuskan aksi apa pun. Dari situ
   kamu dapat: posisi & HP diri sendiri, posisi semua zombie (+HP mereka), posisi
   player lain (termasuk siapa yang down/butuh revive), item di lantai (medkit/ammo),
   gelombang saat ini, dan log kejadian terbaru. Jangan menebak posisi — selalu
   ambil dari get_state yang terbaru karena arena real-time dan berubah tiap detik.

3. **Loop keputusan tiap giliran:**
   - Kalau HP rendah (< 30%) dan punya medkit di inventory → `use_medkit`.
   - Kalau HP rendah dan TIDAK punya medkit → cari medkit terdekat di `items`
     (get_state), `move` mendekatinya, lalu `pickup_item` begitu jaraknya dekat.
   - Kalau ammo magazine 0 atau rendah → `reload` (butuh reserveAmmo > 0, kalau
     reserve juga habis cari item `ammo` di lantai dulu).
   - Kalau ada zombie dalam jarak dekat/mengancam → `shoot` dengan `targetX/targetY`
     dari posisi zombie yang paling dekat atau paling mengancam teammate.
   - Kalau tidak ada zombie dekat tapi ada zombie jauh mendekat → `move` untuk
     memposisikan diri (jangan berdiri diam kalau dikepung, mundur ke arah yang lebih aman).
   - Kalau ada teammate berstatus `down` di dekatmu → prioritaskan `revive_teammate`
     sebelum aksi lain (nyawa teammate lebih penting daripada damage tambahan),
     asal kamu sendiri dalam kondisi aman (bukan langsung dikelilingi zombie).
   - Sesekali (tidak perlu tiap giliran) kirim `team_chat` singkat untuk koordinasi,
     misalnya kabari kalau HP rendah, ammo habis, atau ada gelombang baru datang.

4. **Perilaku "manusiawi", bukan spam tool.**
   Jangan panggil tool berkali-kali tanpa henti dalam satu balasan sampai puluhan
   kali — itu bikin lambat dan gak natural. Ambil beberapa aksi yang masuk akal per
   giliran obrolan (misal: get_state → move → shoot, atau get_state → revive), lalu
   laporkan singkat ke user apa yang terjadi ("Aku gerak ke medkit di (420,180) terus
   nembak 2 zombie yang ngepung kamu, HP kamu sekarang aman"). Kalau user memberi
   instruksi berkelanjutan ("terus jagain aku"), lanjutkan siklus ini di
   balasan-balasan berikutnya sesuai konteks percakapan, bukan sekaligus di satu
   balasan berulang-ulang.

5. **Saat selesai / diminta berhenti.**
   Panggil `mcp_zombie-game__leave_game` kalau user minta kamu keluar dari arena.

## 🧰 Tools yang Digunakan
Semua lewat MCP server `zombie-game` (prefix tool: `mcp_zombie-game__`):
`join_game`, `get_state`, `move`, `shoot`, `reload`, `use_medkit`, `pickup_item`,
`revive_teammate`, `team_chat`, `leave_game`.

## 📝 Contoh Penggunaan
**User:** "Emora, join arena zombie gue, tim A, terus bantuin gue bertahan."
**Emora:** (join_game name="Emora" team="A" → get_state: lihat 2 zombie dekat user →
shoot ke zombie terdekat 2x sampai mati → get_state lagi: user HP 40% tapi gak
punya medkit, ada medkit 60px di kiri → move left 2x → pickup_item gagal karena
belum cukup dekat → move left sekali lagi → pickup_item berhasil → team_chat
"Ambil medkit nih, standby dulu" ) → lapor ke user: "Aku udah beresin 2 zombie di
deket kamu dan lagi ambil medkit buat jaga-jaga, HP kamu masih 40% coba pakai
medkit kamu sendiri juga kalau ada."

## ⚠️ Catatan/Limitasi
- Skill ini butuh server game (`server.js`) dan MCP bridge (`mcpServer.js`) sudah
  jalan dan terdaftar di `mcp/mcp.config.json` — kalau tool `mcp_zombie-game__*`
  tidak ada di daftar tool, informasikan ke user bahwa integrasi belum aktif,
  jangan pura-pura sudah main.
- Satu proses MCP = satu karakter. Kalau proses MCP mati/restart, karakter lama
  tetap ada di server sampai timeout — panggil `leave_game` dulu sebelum berhenti
  kalau memungkinkan, supaya tidak menyisakan karakter "hantu" di arena.
- Jangan mengarang hasil get_state/aksi — kalau tool gagal (mis. "belum cukup
  dekat untuk pickup"), sampaikan apa adanya ke user dan sesuaikan rencana
  (mis. move lebih dekat dulu), jangan bilang berhasil kalau responsnya `ok:false`.
