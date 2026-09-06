# Referensi API & Perintah (Commands/Tools)

## Perintah Slash TUI (TUI Commands)
Diketik langsung di TUI dengan awalan garis miring (`/`):
- `/help` : Daftar bantuan TUI.
- `/clear` : Membersihkan layar CLI (sesi tetap hidup).
- `/reset` : Memulai sesi baru dari awal, riwayat chat hilang.
- `/mode <safe|autonomous>` : Menyetel tingkat kebebasan eksekusi.
- `/agentmode <chat|simple|planned|deep>` : Mengganti gaya bahasa & berpikir AI.
- `/stream` : Menyalakan/mematikan efek teks berjalan (typewriter).
- `/setup` (atau `/switch`) : Membuka *wizard* konfigurasi Model/Provider AI.
- `/history` : Membuka penjelajah (browser) percakapan masa lalu.
- `/resume <keyword>` : Melanjutkan percakapan lama.
- `/skills` : Daftar semua skill yang aktif/terpasang.
- `/tasks` : Melihat *background tasks* / Swarm / Subagent yang berjalan.
- `/gateway` : Melihat status integrasi platform chat.
- `/plugin [list|disable|enable|reload|install]` : Manajemen ekstensi / tool eksternal.
- `/artifact [list|get|delete] <id>` : Mengelola artifact *session-scoped*.
- `/learn <nama_skill>` : Membuat Skill (SOP) otomatis dari riwayat *chat* terakhir.
- `/undo` (atau `/redo`) : Membatalkan atau mengembalikan file hasil modifikasi AI.
- `/<nama_skill>` : Menjalankan SKILL / Workflow secara paksa dan instan.

## Daftar Tools (Agent Capabilities)
Tool yang dapat dieksekusi secara otonom oleh LLM *engine* EMORA di latar belakang:

1. **File Operations:**
   - `read_file`, `write_file`, `list_file`, `search_text`, `create_folder`, `delete_folder`, `find_folder`, `patch`
2. **Terminal / Shell:**
   - `shell_exec`
3. **Artifacts:**
   - `artifact_tool`
4. **Multi-Agent / Swarm:**
   - `ag_subagents`, `bot_mesh`, `swarm_delegate`, `subagent`
5. **Session & Knowledge:**
   - `session_memory`, `knowledge_library`, `skill_factory`, `skill_reader`
6. **Project & Backup:**
   - `project_manager`, `backup_manager`, `git_manager`, `zip_compress`, `zip_extract`
7. **Web & External Integration:**
   - `fetch_page`, `search_web`, `mcp_bridge`, `obsidian_manual`
8. **Utilities:**
   - `datetime`, `system_monitor`, `scheduler`, `undo`, `change_mode`, `thinking_mode`, `title_generator`, `verify`

## Cara Kerja Plugin
- Plugins diletakkan di `/plugins/<nama_plugin>/`.
- Mengadopsi standar ekosistem MCP/Codex/Claude.
- Dapat memanggil command tersendiri melalui `/<plugin_id>:<command_name>`.
