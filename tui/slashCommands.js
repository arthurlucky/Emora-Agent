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
import { providerChoices, buildStepSequence, createWizardState } from "./wizard.js";
import { getManager } from "../gateway/manager.js";
import { isRunning as daemonIsRunning } from "../gateway/daemon.js";

export const AVAILABLE_COMMANDS = [
  "/help", "/clear", "/reset", "/mode", "/agentmode", "/stream",
  "/setup", "/switch", "/history", "/resume", "/skills", "/tasks",
  "/gateway", "/undo", "/redo", "/undo-history", "/exit", "/quit",
];

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
      dispatch({ type: "NEW_SESSION", sessionId: created.id, sessionTitle: created.title });
      return { type: "handled" };
    }

    case "mode": {
      const val = (rest[0] || "").toLowerCase();
      if (val !== "safe" && val !== "autonomous") {
        return { type: "notice", message: `Mode saat ini: ${state.mode}. Pakai /mode safe atau /mode autonomous.` };
      }
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

    case "setup":
    case "switch": {
      const wizard = { ...createWizardState(), choices: providerChoices() };
      wizard.sequence = ["provider"];
      dispatch({ type: "SET_WIZARD_VIEW", wizard });
      return { type: "handled" };
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
    case "redo":
    case "undo-history":
      return {
        type: "notice",
        message: "Fitur undo/redo file belum ada di EMORA (belum ada version-tracking otomatis per edit).",
      };

    case "exit":
    case "quit":
      dispatch({ type: "QUIT" });
      return { type: "handled" };

    default:
      return { type: "error", message: `Perintah "/${cmd}" gak dikenal. Ketik /help buat lihat daftar perintah.` };
  }
}

export { renameSession, deleteSession, toggleSkill };
