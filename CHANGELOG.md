# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versi: [SemVer](https://semver.org/).

## [Unreleased]

## [1.3.0] — 2026-08-23

### Added
- **Toolset system** — preset grup tool (`full/coding/chat/minimal`) via `emora toolset`
- **Model profiles** — simpan banyak konfigurasi provider/model, pindah via `emora model use <nama>` atau `/switch <nama>` di TUI
- **`emora doctor`** — diagnosa mandiri (env, provider, koneksi, disk, test suite)
- **`emora repl`** — REPL ringan (prompt `>`, multi-line, slash command)
- **`emora run "<prompt>"`** — chat one-shot dari CLI
- **`emora -s list|delete|title`** — manajemen sesi (hapus massal, regen judul)
- **`emora -r` by judul/prefix** — resume sesi tanpa UUID penuh
- **Terminal backends** — shell_exec via SSH (`emora backends add`)
- **Obsidian dual mode** — MCP (REST API) atau manual filesystem dengan folder picker interaktif
- **Dual system prompt** — `AGENT_LITE.md` otomatis untuk model kecil (≤1.5B/mini/nano), override `AGENT_MODE=lite`
- **OpenRouter live models** — 422+ model via API, cache 24h
- **Context window presets** di setup + link-budget guard (`MAX_CONTEXT_MESSAGES`, `LINK_BUDGET`)
- **RPG skin** — `/skin rpg` tema manhwa-style (XP/level per aksi agent)
- Tools baru: `patch` (fuzzy edit), `undo`/`redo` (snapshot), `verify` (auto-detect test framework), `change_mode`

### Changed
- `npm start` & `"main"` kini mengarah ke `bin/emora.js` (satu pintu dengan command `emora`)
- TUI restyle ala Hermes: border input box, status bar model+timer, welcome screen, markdown memoize (~25x render lebih cepat), spinner idle fix
- DeepSeek: dual-path — API resmi (tool calling) + scrape fallback; terdaftar di provider registry
- Skill registry: cache mtime-keyed (264ms → 2ms), frontmatter `categories`
- select.js: key tokenizer (fix menu stuck saat input datang tergabung)

### Fixed
- `red` undefined crash di `emora -r` tanpa argumen
- `/guide-emora` tidak terbaca (frontmatter backfill)
- Duplikat nama tool `delegate_to_subagent` (swarm di-rename `delegate_to_swarm`)
- swarm_delegate signature `createLLM` basi
- TUI session title undefined; `/undo`/`/redo` wired ke implementasi nyata
- Setup Skills Hub crash (`cyan`/`path` not defined); exit menu stuck (key tokenizer)

### Removed
- `better-sqlite3` dari deps (tidak buildable di Termux); memory tetap JSON-enhanced
- `main.js` dari jalur eksekusi (dead code)

## [1.2.0] dan sebelumnya

Lihat riwayat commit: https://github.com/arthurlucky/Emora-Agent/commits/main
