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
  "/setup", "/model", "/skin", "/history", "/resume", "/skills", "/tasks",
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
    "  /model [nama]    - pakai profile tersimpan; /model list|save|rm",
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

    case "toolset": {
      // /toolset [preset|list] — live-reload tanpa restart.
      const sub = rest[0];
      try {
        const ts = await import("../utils/toolsets.js");
        if (!sub || sub === "list") {
          const groups = await ts.getActiveGroups();
          return { type: "notice", message: `Grup aktif: ${groups.join(", ")}\nPreset: ${Object.keys(ts.PRESETS).join(", ")}\nGanti: /toolset <preset>` };
        }
        if (ts.PRESETS[sub]) {
          await ts.applyPreset(sub);
          const { reloadToolset } = await import("../core/tools.js");
          const n = await reloadToolset();
          return { type: "notice", message: `✓ Preset "${sub}" aktif — ${n} tool live (tanpa restart).` };
        }
        if (["on", "off"].includes(sub) && rest[1]) {
          const cur = await ts.getActiveGroups();
          const next = sub === "on" ? [...new Set([...cur, rest[1]])] : cur.filter((g) => g !== rest[1]);
          await ts.setGroups(next);
          const { reloadToolset } = await import("../core/tools.js");
          const n = await reloadToolset();
          return { type: "notice", message: `✓ Grup ${rest[1]} ${sub} — ${n} tool live.` };
        }
        return { type: "notice", message: "Pakai: /toolset list | /toolset <preset> | /toolset on|off <grup>" };
      } catch (e) {
        return { type: "error", message: e.message };
      }
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
      // DIHAPUS — digabung ke /model <nama> (aturan user: hapus /switch).
      return { type: "error", message: "/switch sudah dihapus. Pakai: /model <nama> untuk pakai profile tersimpan, atau /setup untuk wizard." };
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
      // /model                → daftar provider yang sudah di-setup (profiles + custom endpoints)
      // /model <provider>     → pilih model REALTIME dari provider itu → simpan & pakai
      // /model rm <nama>      → hapus custom endpoint / profile tersimpan
      // /model save <nama>    → simpan config aktif sebagai profile
      const sub = rest[0];
      try {
        const mp = await import("../core/modelProfiles.js");
        const { setEnv, getEnv } = await import("../envHelpers.js");

        // ── rm: hapus profile / custom endpoint ────────────────────────────
        if (sub === "rm" || sub === "remove") {
          const name = rest[1];
          if (!name) return { type: "error", message: "Pakai: /model rm <nama-profile-atau-endpoint>" };
          let removed = false;
          try { await mp.removeProfile(name); removed = true; } catch {}
          try { await mp.removeCustomEndpoint(name); removed = true; } catch {}
          if (!removed) return { type: "error", message: `"${name}" tidak ada di profiles maupun custom endpoints.` };
          return { type: "notice", message: `✓ "${name}" dihapus.` };
        }

        // ── save: snapshot config aktif ─────────────────────────────────────
        if (sub === "save") {
          if (!rest[1]) return { type: "error", message: "Pakai: /model save <nama>" };
          await mp.saveProfile(rest[1]);
          return { type: "notice", message: `✓ Config aktif disimpan sebagai "${rest[1]}". Pakai: /model ${rest[1]}` };
        }

        // ── Tanpa argumen: daftar semua provider yang sudah di-setup ────────
        if (!sub) {
          const profiles = await mp.listProfiles();
          const endpoints = await mp.listCustomEndpoints();
          const lines = ["Provider & model yang sudah di-setup:", ""];
          for (const [n, p] of Object.entries(profiles)) {
            const active = p.provider === process.env.MODEL_PROVIDER && p.model === process.env.MODEL_NAME;
            lines.push(`  ${active ? C.green("●") : " "} ${C.bold("/model " + n)}  ${C.dim(p.provider + "/" + p.model)}`);
          }
          for (const [n, e] of Object.entries(endpoints)) {
            if (profiles[n]) continue;
            lines.push(`  ${C.cyan?.("●") || "●"} ${C.bold("/model " + n)}  ${C.dim("custom/" + (e.models?.[0] || "?"))} ${C.dim(`[${e.compat}]`)}`);
          }
          if (lines.length === 2) {
            lines.push(C.faint("  Belum ada. Jalankan 'emora setup model' atau /setup untuk menambah provider."));
          }
          lines.push("", C.dim("Pilih: /model <nama> — lalu pilih model realtime dari daftar."));
          return { type: "notice", message: lines.join("\n"), big: true };
        }

        // ── /model <nama>: fetch model realtime → user pilih → apply ────────
        const name = sub === "use" ? rest[1] : sub;
        const profiles = await mp.listProfiles();
        const endpoints = await mp.listCustomEndpoints();
        const profile = profiles[name];
        const endpoint = !profile ? endpoints[name] : null;

        // Provider target untuk fetch models.
        let providerKey, url, apiKey, compat;
        if (profile) {
          providerKey = profile.provider; url = profile.url; apiKey = profile.apiKey; compat = profile.compat;
        } else if (endpoint) {
          providerKey = "custom"; url = endpoint.url; apiKey = endpoint.apiKey; compat = endpoint.compat;
        } else {
          return { type: "error", message: `"${name}" tidak ditemukan. Ketik /model untuk lihat daftar.` };
        }

        // Fetch model REALTIME.
        let models = [];
        if (providerKey === "custom") {
          models = await mp.fetchCustomModels(url, apiKey, compat);
        } else {
          try {
            const orp = await import("../provider/openrouter/index.js");
            if (providerKey === "openrouter" && orp.fetchModels) {
              models = (await orp.fetchModels()).map(m => ({ id: m.id, name: m.name }));
            }
          } catch {}
          if (!models.length) {
            const { getProviderModels } = await import("../provider/index.js");
            models = (await getProviderModels(providerKey)).map(m => ({ id: m.id || m, name: m.label || m.id || String(m) }));
          }
        }
        if (!models.length && endpoint?.models?.length) {
          models = endpoint.models.map(m => ({ id: m, name: m }));
        }
        if (!models.length) {
          return { type: "error", message: `Gagal mengambil daftar model dari "${name}" (${compat}). Endpoint offline atau format tidak didukung.` };
        }

        // Simpan pilihan ke wizard state — user pilih via arrow keys di overlay.
        // Handler global untuk apply setelah user pilih model di picker.
        globalThis.__EMORA_MODEL_APPLY__ = async (mp, modelId) => {
          try {
            // 1. Tulis config provider ke .env
            setEnv("MODEL_PROVIDER", mp.providerKey);
            if (mp.url) setEnv("MODEL_URL", mp.url);
            if (mp.apiKey) setEnv("MODEL_API", mp.apiKey);
            setEnv("MODEL_NAME", modelId);
            if (mp.compat && mp.providerKey === "custom") setEnv("MODEL_COMPAT", mp.compat);

            // 2. Simpan/refresh custom endpoint (model baru masuk daftar reuse)
            if (mp.providerKey === "custom") {
              await mp.addCustomEndpoint({
                name: mp.name, url: mp.url, apiKey: mp.apiKey,
                compat: mp.compat || "openai", models: [modelId],
              });
            }

            // 3. Buat LLM baru + update header
            invalidateSystemPromptCache();
            const llm = await createLLM([], mp.providerKey === "custom" ? "custom" : mp.providerKey, {});
            const meta = getProviderMeta(mp.providerKey);
            dispatch({ type: "SET_PROVIDER", provider: { name: meta.label, model: modelId } });
            globalThis.__EMORA_TUI_LLM__ = llm;
            globalThis.__EMORA_MODEL_APPLY__ = null;
            dispatch({ type: "SET_NOTICE", message: `✓ Model "${modelId}" aktif (${mp.name}: ${mp.providerKey}${mp.compat ? "/" + mp.compat : ""}).` });
          } catch (e) {
            dispatch({ type: "SET_ERROR", message: `Gagal apply model: ${e.message}` });
          }
        };

        dispatch({
          type: "MODEL_PICKER",
          payload: {
            name,
            providerKey, url, apiKey, compat,
            models,
            index: 0,
            resolve: null,
          },
        });
        return { type: "handled" };
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
      // Aturan TUI.md #9: tanpa argumen → daftar sesi tabel ala Hermes.
      const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
      const sessions = await listSessions();
      if (!argStr) {
        const lines = [
          "",
          "  Usage: /resume <number|session_id_or_title>",
          "  Recent sessions:",
          "  #   Title                            Preview                                  Last Active   ID",
          "  ─── ──────────────────────────────── ──────────────────────────────────────── ───────────── ────────────────────────",
        ];
        const relTime = (ts) => {
          const diff = Date.now() - (ts || Date.now());
          const m = Math.floor(diff / 60000);
          if (m < 1) return "just now";
          if (m < 60) return `${m}m ago`;
          const h = Math.floor(m / 60);
          if (h < 24) return `${h}h ago`;
          return `${Math.floor(h / 24)}d ago`;
        };
        const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
        sessions.slice(0, 12).forEach((s, i) => {
          const title = cut(s.title || "(tanpa judul)", 32).padEnd(34);
          const preview = cut((s.preview || s.title || ""), 38).padEnd(40);
          const active = relTime(s.updatedAt).padEnd(13);
          lines.push(`  ${(i + 1).toString().padEnd(3)} ${title} ${preview} ${active} ${s.id}`);
        });
        lines.push("");
        lines.push("  Use /resume <number>, /resume <session id>, or /resume <session title> to continue.");
        lines.push("  Example: /resume 2");
        return { type: "resume_menu", message: lines.join("\n") };
      }

      // Argumen: number | id | judul.
      let found = null;
      const asNum = parseInt(argStr, 10);
      if (!isNaN(asNum) && String(asNum) === argStr.trim() && asNum >= 1 && asNum <= sessions.length) {
        found = sessions[asNum - 1];
      } else {
        const q = argStr.toLowerCase();
        found =
          sessions.find((s) => s.id.toLowerCase().includes(q)) ||
          sessions.find((s) => (s.title || "").toLowerCase().includes(q));
      }
      if (!found) return { type: "error", message: `Gak ketemu sesi: "${argStr}".` };
      const messages = await loadSession(found.id);
      dispatch({ type: "LOAD_SESSION", sessionId: found.id, sessionTitle: found.title, messages });
      const userMsgs = messages.filter(m => m.role === "user").length;
      return {
        type: "notice",
        message: `↻ Resumed session ${found.id} "${cut(found.title || "", 40)}" (${userMsgs} user message, ${messages.length} total)`,
      };
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
