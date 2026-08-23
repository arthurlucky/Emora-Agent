/**
 * tui/slashCommands.js
 *
 * Daftar & handler slash command di TUI. Beberapa command dari versi Go
 * sengaja disederhanakan/di-drop karena EMORA gak punya mesin di baliknya
 * (lihat catatan per-command) — daripada pura-pura berfungsi, commandnya
 * kasih pesan yang jujur.
 */
import { listSessions, renameSession, deleteSession } from "../core/sessionStore.js";
import { loadSession } from "../core/memory.js";
import { listSkillsForMenu, toggleSkill } from "./skillsMenu.js";
import skillRegistry from "../core/skillRegistry.js";
import { providerChoices, buildStepSequence, createWizardState } from "./wizard.js";
import { getManager } from "../gateway/manager.js";
import { isRunning as daemonIsRunning } from "../gateway/daemon.js";
import pluginManager from "../core/pluginManager.js";
import { invalidateSystemPromptCache } from "../core/chat.js";
import { createLLM, getProviderMeta } from "../provider/index.js";
import artifactManager from "../core/artifactManager.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import fs from "fs";
import path from "path";

export const AVAILABLE_COMMANDS = [
  "/help", "/clear", "/reset", "/mode", "/agentmode", "/stream",
  "/setup", "/switch", "/model", "/skin", "/history", "/resume", "/skills", "/tasks",
  "/gateway", "/undo", "/redo", "/undo-history", "/exit", "/quit",
  "/plugin", "/artifact", "/learn",
];

// ── Cache nama skill/command buat autocomplete ──────────────────────────
// skillRegistry.listAll() itu async (baca disk), sedangkan dropdown
// autocomplete di tui/keys.js `updateSuggestions()` dipanggil SYNC tiap
// keystroke — jadi hasil scan disimpan di cache module-level ini, di-refresh
// di background (fire-and-forget), supaya /guide-emora, skill bawaan
// lainnya, dan command/skill dari plugin ikut nongol di dropdown yang sama
// dengan command bawaan TUI, tanpa bikin tiap ketikan nunggu I/O.
let cachedSkillSlashNames = [];

export function getSkillSuggestionCache() {
  return cachedSkillSlashNames;
}

export async function refreshSkillSuggestionCache() {
  try {
    const all = await skillRegistry.listAll();
    cachedSkillSlashNames = all.map((s) => `/${s.slashName}`);
  } catch {
    // gagal baca disk -> biarin cache lama (atau kosong kalau ini refresh pertama)
  }
}

function helpText() {
  return [
    "Perintah yang tersedia:",
    "  /help            - tampilkan ini",
    "  /clear           - bersihkan layar (sesi tetap)",
    "  /reset           - mulai sesi baru dari nol",
    "  /mode <safe|autonomous> - kebijakan approval tool",
    "  /agentmode <chat|simple|planned|deep> - gaya respons agent",
    "  /stream          - toggle typewriter effect",
    "  /setup           - wizard ganti provider/model AI",
    "  /switch          - alias /setup",
    "  /history         - browser sesi tersimpan",
    "  /resume <judul>  - lanjutkan sesi dari history by keyword",
    "  /skills          - kelola skill (on/off)",
    "  /tasks           - lihat background task",
    "  /gateway         - status gateway Telegram/WhatsApp/Discord",
    "  /plugin [list|disable|enable|reload|install] <nama|url> - kelola tool/plugin",
    "  /artifact [list|get|delete] <id> - kelola Artifact tersimpan",
    "  /learn <nama_skill> - susun sesi chat ini jadi Skill baru",
    "  /<nama_skill_atau_command> [argumen] - jalankan skill/command apa pun (bawaan/plugin) langsung",
    "  /undo /redo /undo-history - lihat catatan di bawah",
    "  /exit, /quit     - keluar",
  ].join("\n");
}

/**
 * @returns {null|{type:'notice'|'error', message:string}|{type:'view', ...}}
 *          null artinya bukan slash command yang dikenal -> lanjut sbg pesan biasa
 */
export async function runSlashCommand(raw, { state, dispatch }) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
  const argStr = rest.join(" ");

  switch (cmd.toLowerCase()) {
    case "help":
      return { type: "notice", message: helpText() };

    case "clear":
      dispatch({ type: "SCROLL_RESET" });
      return { type: "notice", message: "Layar dibersihkan (riwayat tetap tersimpan)." };

    case "reset": {
      const { createSession } = await import("../core/sessionStore.js");
      const created = await createSession("Sesi baru");
      dispatch({ type: "NEW_SESSION", sessionId: created.id, sessionTitle: created.name || "Sesi baru" });
      return { type: "handled" };
    }

    case "mode": {
      const val = (rest[0] || "").toLowerCase();
      if (!["safe", "autonomous", "plan"].includes(val)) {
        return { type: "notice", message: `Mode saat ini: ${state.mode}. Pilihan: autonomous | safe | plan.` };
      }
      // Persist juga ke .emora/mode.json agar gateway/REPL baca nilai sama.
      try { const { setMode } = await import("../tools/change_mode.js"); await setMode(val); } catch {}
      dispatch({ type: "SET_MODE", mode: val });
      return { type: "handled" };
    }

    case "agentmode": {
      const val = (rest[0] || "").toLowerCase();
      if (!["chat", "simple", "planned", "deep"].includes(val)) {
        return { type: "notice", message: `Agent mode saat ini: ${state.agentMode}. Pilihan: chat, simple, planned, deep.` };
      }
      dispatch({ type: "SET_AGENT_MODE", agentMode: val });
      return { type: "handled" };
    }

    case "stream":
      dispatch({ type: "TOGGLE_STREAM" });
      return { type: "handled" };

    case "setup": {
      const wizard = { ...createWizardState(), choices: providerChoices() };
      wizard.sequence = ["provider"];
      dispatch({ type: "SET_WIZARD_VIEW", wizard });
      return { type: "handled" };
    }

    case "switch": {
      // /switch <nama>  → langsung pakai profile tersimpan
      // /switch         → wizard pilih provider (perilaku lama)
      const name = rest[0];
      if (!name) {
        const wizard = { ...createWizardState(), choices: providerChoices() };
        wizard.sequence = ["provider"];
        dispatch({ type: "SET_WIZARD_VIEW", wizard });
        return { type: "handled" };
      }
      try {
        const { useProfile, listProfiles } = await import("../core/modelProfiles.js");
        const profiles = await listProfiles();
        if (!profiles[name]) {
          const avail = Object.keys(profiles).map((n) => "/" + n).join(", ") || "(kosong)";
          return { type: "error", message: `Profile "${name}" tidak ada. Tersimpan: ${avail}` };
        }
        // Terapkan ke .env + runtime, lalu buat LLM baru.
        const { setEnv, getEnv } = await import("../envHelpers.js");
        const p = await useProfile(name, setEnv);
        invalidateSystemPromptCache();
        const llm = await createLLM([], p.provider, {});
        const meta = getProviderMeta(p.provider);
        dispatch({ type: "SET_PROVIDER", provider: { name: meta.label, model: getEnv("MODEL_NAME") } });
        globalThis.__EMORA_TUI_LLM__ = llm;
        return { type: "notice", message: `✓ Beralih ke profile "${name}": ${p.provider}/${p.model}` };
      } catch (err) {
        return { type: "error", message: `Gagal switch: ${err.message}` };
      }
    }

    case "skin": {
      // /skin [clean|rpg] — tema visual. Tanpa argumen: tampil pilihan + status.
      const theme = await import("../tui/theme-rpg.js");
      const val = rest[0]?.toLowerCase();
      if (!val) {
        return { type: "notice", message:
          `SKIN AKTIF: ${theme.getSkin()}\n\n` +
          `Pilihan: ${theme.SKINS.join(", ")}\n` +
          `Ganti: /skin rpg  (manhwa-style) atau /skin clean (default)` };
      }
      try {
        theme.setSkin(val);
        return { type: "notice", message: `✓ Skin diganti ke "${val}". Berlaku penuh di sesi berikutnya; header & welcome sudah bergaya sekarang.` };
      } catch (e) {
        return { type: "error", message: e.message };
      }
    }

    case "model": {
      // /model list | /model save <nama> | /model rm <nama>
      const sub = rest[0];
      try {
        const mp = await import("../core/modelProfiles.js");
        if (!sub || sub === "list") {
          return { type: "notice", message: "MODEL PROFILES\n\n" + mp.formatList(await mp.listProfiles()) +
            "\n\nSimpan config aktif: /model save <nama>\nGanti: /switch <nama>" };
        }
        if (sub === "save") {
          if (!rest[1]) return { type: "error", message: "Pakai: /model save <nama>" };
          await mp.saveProfile(rest[1]);
          return { type: "notice", message: `✓ Config aktif disimpan sebagai "${rest[1]}".` };
        }
        if (sub === "rm" || sub === "remove") {
          if (!rest[1]) return { type: "error", message: "Pakai: /model rm <nama>" };
          await mp.removeProfile(rest[1]);
          return { type: "notice", message: `✓ Profile "${rest[1]}" dihapus.` };
        }
        return { type: "notice", message: "Pakai: /model list | save <nama> | rm <nama>" };
      } catch (err) {
        return { type: "error", message: err.message };
      }
    }

    case "history": {
      const sessions = await listSessions();
      dispatch({ type: "SET_HISTORY_VIEW", sessions });
      return { type: "handled" };
    }

    case "resume": {
      if (!argStr) return { type: "notice", message: "Pakai: /resume <kata kunci judul sesi>" };
      const sessions = await listSessions();
      const found = sessions.find((s) => (s.title || "").toLowerCase().includes(argStr.toLowerCase()));
      if (!found) return { type: "error", message: `Gak ketemu sesi dengan judul mengandung "${argStr}".` };
      const messages = await loadSession(found.id);
      dispatch({ type: "LOAD_SESSION", sessionId: found.id, sessionTitle: found.title, messages });
      return { type: "handled" };
    }

    case "skills": {
      const list = await listSkillsForMenu();
      dispatch({ type: "SET_SKILLS_VIEW", list });
      return { type: "handled" };
    }

    case "tasks":
      dispatch({ type: "SET_TASKS_VIEW", list: [] });
      return {
        type: "notice",
        message: "Belum ada background task aktif. (Task tracking granular per-command belum terhubung ke TUI ini.)",
      };

    case "gateway": {
      const mgr = getManager();
      const sub = (rest[0] || "status").toLowerCase();

      if (sub === "start" || sub === "stop") {
        const platform = rest[1];
        if (!platform) return { type: "error", message: `Sebutkan platform. Contoh: /gateway ${sub} telegram` };
        if (sub === "start" && daemonIsRunning()) {
          return { type: "error", message: "Ada daemon gateway terpisah yang lagi jalan ('emora gateway run'). Stop itu dulu supaya gak dobel-poll." };
        }
        try {
          if (sub === "start") await mgr.start(platform);
          else await mgr.stop(platform);
          return { type: "notice", message: `Gateway '${platform}' ${sub === "start" ? "dijalankan" : "dihentikan"}.` };
        } catch (err) {
          return { type: "error", message: err.message };
        }
      }

      const status = mgr.status();
      dispatch({ type: "SET_GATEWAY_STATUS_VIEW", status: { platforms: status } });
      return { type: "handled" };
    }

    case "undo":
    case "redo": {
      const { undoTool, redoTool } = await import("../tools/undo.js");
      const out = cmd === "undo" ? await undoTool.invoke({}) : await redoTool.invoke({});
      return { type: "notice", message: out };
    }
    case "undo-history": {
      const fsSync = await import("fs");
      try {
        const session = "_default";
        const dir = `.emora/undo/${session}`;
        const snaps = fsSync.readdirSync(dir).filter(f => f !== "_stack.json");
        if (!snaps.length) return { type: "notice", message: "Belum ada snapshot undo." };
        const stack = JSON.parse(fsSync.readFileSync(`${dir}/_stack.json`, "utf8"));
        return {
          type: "notice",
          message: `Undo stack: ${stack.undo.length} · Redo stack: ${stack.redo.length}\nSnapshot tersimpan: ${snaps.length}`,
        };
      } catch {
        return { type: "notice", message: "Belum ada snapshot undo." };
      }
    }

    case "exit":
    case "quit":
      dispatch({ type: "QUIT" });
      return { type: "handled" };

    case "plugin":
    case "plugins": {
      const sub = (rest[0] || "list").toLowerCase();
      const name = rest[1];

      if (sub === "list") {
        const all = pluginManager.listAll();
        if (all.length === 0) return { type: "notice", message: "Belum ada tool/plugin terdaftar." };
        const text = all.map((p) => `${p.enabled ? "✅" : "🚫"} ${p.name} [${p.source}]`).join("\n");
        return { type: "notice", message: `DAFTAR TOOL & PLUGIN\n\n${text}` };
      }
      if (sub === "disable") {
        if (!name) return { type: "error", message: "Pakai: /plugin disable <nama_tool>" };
        pluginManager.disable(name);
        return { type: "notice", message: `Tool "${name}" dinonaktifkan (instan, tanpa restart).` };
      }
      if (sub === "enable") {
        if (!name) return { type: "error", message: "Pakai: /plugin enable <nama_tool>" };
        pluginManager.enable(name);
        return { type: "notice", message: `Tool "${name}" diaktifkan kembali (instan, tanpa restart).` };
      }
      if (sub === "reload") {
        if (!name) return { type: "error", message: "Pakai: /plugin reload <plugin_id>" };
        try {
          const result = await pluginManager.reloadPlugin(name);
          return { type: "notice", message: `Plugin "${name}" di-reload (${result.toolCount} tool).` };
        } catch (err) {
          return { type: "error", message: err.message };
        }
      }
      if (sub === "install") {
        if (!name) return { type: "error", message: "Pakai: /plugin install <git_url_atau_path_lokal>" };
        try {
          const isGit = pluginManager.looksLikeGitUrl(name);
          const result = isGit
            ? await pluginManager.installPluginFromGit(name)
            : await pluginManager.installPluginFromPath(name);
          return {
            type: "notice",
            message: `Plugin "${result.id}" berhasil diinstall (${result.toolCount} tool). Tool baru muncul di skema AI setelah restart gateway.`,
          };
        } catch (err) {
          return { type: "error", message: err.message };
        }
      }
      return { type: "error", message: "Sub-command: /plugin list|disable|enable|reload|install <nama>" };
    }

    case "artifact": {
      const sub = (rest[0] || "list").toLowerCase();
      const id = rest[1];

      try {
        if (sub === "list") {
          const list = artifactManager.listArtifacts();
          if (list.length === 0) return { type: "notice", message: "Belum ada artifact." };
          const text = list.map((a) => `• [${a.id}] ${a.name} (${a.type}, v${a.version})`).join("\n");
          return { type: "notice", message: `DAFTAR ARTIFACT\n\n${text}` };
        }
        if (sub === "get") {
          if (!id) return { type: "error", message: "Pakai: /artifact get <id>" };
          const a = artifactManager.getArtifact(id);
          return { type: "notice", message: `${a.name} (${a.type}, v${a.version})\n\n${a.content}` };
        }
        if (sub === "delete") {
          if (!id) return { type: "error", message: "Pakai: /artifact delete <id>" };
          artifactManager.deleteArtifact(id);
          return { type: "notice", message: `Artifact ${id} dihapus.` };
        }
        return { type: "error", message: "Sub-command: /artifact list|get|delete <id>" };
      } catch (err) {
        return { type: "error", message: err.message };
      }
    }

    case "learn": {
      const skillNameRaw = argStr.trim();
      if (!skillNameRaw) return { type: "error", message: "Pakai: /learn <nama_skill>" };

      try {
        const memory = await loadSession(state.sessionId);
        if (!memory || memory.length === 0) {
          return { type: "error", message: "Sesi ini belum punya riwayat percakapan untuk dipelajari." };
        }

        const transcript = memory.map((m) => `${m.role === "user" ? "User" : "EMORA"}: ${m.content}`).join("\n\n");
        const safeName = skillNameRaw.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
        if (!safeName) return { type: "error", message: "Nama skill tidak valid (pakai huruf/angka)." };

        const skillDir = path.resolve("./skill", safeName);
        if (fs.existsSync(skillDir)) return { type: "error", message: `Skill "${safeName}" sudah ada.` };

        const systemPrompt =
          "Kamu adalah penyusun dokumentasi Skill untuk agent AI bernama EMORA. Tugasmu: baca transkrip " +
          "percakapan yang diberikan, lalu susun ulang menjadi dokumen SKILL dalam format Markdown yang " +
          "mengajarkan agent CARA MENYELESAIKAN masalah serupa di masa depan — bukan sekadar merangkum " +
          "obrolan. Ikuti struktur: # <Judul>, ## Workflow / Cara Kerja (langkah bernomor, sebutkan nama " +
          "tool spesifik kalau ada), ## Aturan Penting (batasan yang relevan). Balas HANYA markdown-nya, " +
          "tanpa pembuka/penutup, tanpa code fence.";

        const llm = await createLLM([]);
        const response = await llm.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(`Nama skill: "${skillNameRaw}"\n\nTranskrip:\n\n${transcript}`),
        ]);
        let content = response?.content;
        if (Array.isArray(content)) content = content.map((b) => (typeof b === "string" ? b : b?.text || "")).join("");
        if (!content || !content.trim()) return { type: "error", message: "Respons AI kosong, coba lagi." };

        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, "skill.md"), content.trim() + "\n", "utf8");
        fs.writeFileSync(
          path.join(skillDir, "meta.json"),
          JSON.stringify({
            name: safeName,
            description: `Skill hasil belajar otomatis dari sesi chat (/learn) pada ${new Date().toISOString()}.`,
            version: "1.0.0",
            author: "EMORA /learn",
            created_at: new Date().toISOString().slice(0, 10),
            source_session: state.sessionId,
          }, null, 2),
          "utf8"
        );

        return { type: "notice", message: `Skill "${safeName}" berhasil disusun dari sesi ini!\nskill/${safeName}/skill.md` };
      } catch (err) {
        return { type: "error", message: `Gagal membuat skill: ${err.message}` };
      }
    }

    default: {
      // Bukan salah satu command bawaan TUI di atas — cek apakah ini
      // skill/command (bawaan ATAU dari plugin) yang bisa dipanggil manual
      // lewat "/<nama>" atau "/<plugin>:<nama>" (lihat core/skillRegistry.js
      // & skill/SKILL.md #15). Pakai resolveCandidates (bukan resolve)
      // supaya kasus ambigu (>1 plugin punya nama sama) TETAP diteruskan ke
      // ask() — di sana yang akan kasih pesan "sebutkan salah satu", bukan
      // "perintah tidak dikenal" yang menyesatkan.
      const candidates = await skillRegistry.resolveCandidates(cmd);
      if (candidates.length) return null;
      return { type: "error", message: `Perintah "/${cmd}" gak dikenal. Ketik /help buat lihat daftar perintah, atau /skills buat lihat daftar skill.` };
    }
  }
}

export { renameSession, deleteSession, toggleSkill };
