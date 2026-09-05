import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  listSessions,
  getSession,
  deleteSession,
} from "./sessionStore.js";
import { loadSession } from "./memory.js";
import { createLLM } from "../provider/index.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import pluginManager from "./pluginManager.js";
import artifactManager from "./artifactManager.js";

export async function handleCommand(input, state) {
  const [command, ...args] = input.split(" ");

  switch (command) {
    case "/exit":
    case "/quit":
      return { 
        action: "exit", 
        message: `💡 Untuk melanjutkan sesi ini lain kali, jalankan:\n   emora -r ${state.currentSession}\n\nTerima kasih telah menggunakan EMORA.` 
      };

    case "/new": {
      const sessionId = crypto.randomUUID();
      state.currentSession = sessionId;
      return { 
        action: "reply", 
        message: `✅ Session baru dibuat:\n${sessionId}` 
      };
    }

    case "/sesi": {
      const sessionId = args.join(" ").trim();
      
      if (!sessionId) {
        return { 
          action: "reply", 
          message: `ℹ️ Session Aktif saat ini:\n${state.currentSession}` 
        };
      }
      
      state.currentSession = sessionId;
      return { 
        action: "reply", 
        message: `🔄 Berpindah Session ke:\n${sessionId}` 
      };
    }

    case "/clear": {
      try {
        // BUGFIX: Sebelumnya /clear menghapus SEMUA file sesi di memory/
        // tanpa pandang bulu — di Telegram/WhatsApp itu artinya satu user
        // mengetik /clear bisa menghapus riwayat chat SEMUA user lain yang
        // pernah ngobrol dengan bot ini. Sekarang di-scope cuma ke sesi
        // yang sedang aktif milik state ini sendiri.
        const currentId = state.currentSession;
        let deletedCount = 0;

        if (currentId) {
          const result = await deleteSession(currentId);
          deletedCount = result.deletedFiles;
        }

        // Generate sesi baru karena sesi yang sedang dipakai juga ikut terhapus
        const newSessionId = crypto.randomUUID();
        state.currentSession = newSessionId;

        return { 
          action: "reply", 
          message: `🗑️ Riwayat sesi ini berhasil dihapus (${deletedCount} file).\n✅ Session baru otomatis dibuat:\n${newSessionId}` 
        };
      } catch (err) {
        return { 
          action: "reply", 
          message: `❌ Gagal menghapus sesi: ${err.message}` 
        };
      }
    }

    case "/help": {
      return { action: "help", message: "help" };
    }
    
    case "/sesilist": {
  try {
    const sessions = await listSessions();

    if (!sessions.length) {
      return {
        action: "reply",
        message: "📭 Tidak ada sesi."
      };
    }

    const text = sessions
      .map((s, i) => {
        const active =
          s.id === state.currentSession ? " ⭐ AKTIF" : "";

        return `${i + 1}. ${s.id}${active}
   Pesan: ${s.messageCount}
   Update: ${new Date(s.updatedAt).toLocaleString()}`;
      })
      .join("\n\n");

    return {
      action: "reply",
      message: `📚 DAFTAR SESI\n\n${text}`
    };
  } catch (err) {
    return {
      action: "reply",
      message: `❌ ${err.message}`
    };
  }
}

case "/sesiinfo": {
  const sessionId = args[0];

  if (!sessionId) {
    return {
      action: "reply",
      message: "❌ Gunakan: /sesiinfo <uuid>"
    };
  }

  try {
    const session = await getSession(sessionId);

    if (!session) {
      return {
        action: "reply",
        message: "❌ Session tidak ditemukan."
      };
    }

    return {
      action: "reply",
      message:
`📄 INFO SESI

UUID:
${session.id}

Nama:
${session.name}

Pesan:
${session.messageCount}

Dibuat:
${new Date(session.createdAt).toLocaleString()}

Terakhir Aktif:
${new Date(session.updatedAt).toLocaleString()}`
    };
  } catch (err) {
    return {
      action: "reply",
      message: `❌ ${err.message}`
    };
  }
}

case "/sesidel": {
  const sessionId = args[0];

  if (!sessionId) {
    return {
      action: "reply",
      message: "❌ Gunakan: /sesidel <uuid>"
    };
  }

  try {
    await deleteSession(sessionId);

    if (state.currentSession === sessionId) {
      const newSession = crypto.randomUUID();
      state.currentSession = newSession;
    }

    return {
      action: "reply",
      message: `🗑️ Session berhasil dihapus:\n${sessionId}`
    };
  } catch (err) {
    return {
      action: "reply",
      message: `❌ ${err.message}`
    };
  }
}
    
    

    // ═══════════════════════════════════════════════════════════
    // /plugin list|disable|enable|reload — live toggle tool/plugin
    // (lihat core/pluginManager.js untuk penjelasan cara kerja "live"-nya)
    // ═══════════════════════════════════════════════════════════
    case "/plugin": {
      const sub = (args[0] || "list").toLowerCase();
      const name = args[1];

      if (sub === "list") {
        const all = pluginManager.listAll();
        if (all.length === 0) return { action: "reply", message: "📭 Belum ada tool/plugin terdaftar." };
        const text = all
          .map((p) => `${p.enabled ? "✅" : "🚫"} \`${p.name}\` (${p.source})`)
          .join("\n");
        return { action: "reply", message: `🔌 DAFTAR TOOL & PLUGIN\n\n${text}` };
      }

      if (sub === "disable") {
        if (!name) return { action: "reply", message: "❌ Gunakan: /plugin disable <nama_tool>" };
        pluginManager.disable(name);
        return { action: "reply", message: `🚫 Tool "${name}" dinonaktifkan (berlaku instan, tanpa restart).` };
      }

      if (sub === "enable") {
        if (!name) return { action: "reply", message: "❌ Gunakan: /plugin enable <nama_tool>" };
        pluginManager.enable(name);
        return { action: "reply", message: `✅ Tool "${name}" diaktifkan kembali (berlaku instan, tanpa restart).` };
      }

      if (sub === "reload") {
        if (!name) return { action: "reply", message: "❌ Gunakan: /plugin reload <plugin_id>" };
        try {
          const result = await pluginManager.reloadPlugin(name);
          return { action: "reply", message: `🔄 Plugin "${name}" berhasil di-reload (${result.toolCount} tool).` };
        } catch (err) {
          return { action: "reply", message: `❌ Gagal reload: ${err.message}` };
        }
      }

      if (sub === "install") {
        if (!name) return { action: "reply", message: "❌ Gunakan: /plugin install <git_url_atau_path_lokal>" };
        try {
          const isGit = pluginManager.looksLikeGitUrl(name);
          const result = isGit
            ? await pluginManager.installPluginFromGit(name)
            : await pluginManager.installPluginFromPath(name);
          return {
            action: "reply",
            message: `✅ Plugin "${result.id}" berhasil diinstall (${result.toolCount} tool).\n⚠️ Tool baru dari plugin ini baru muncul di skema AI setelah gateway di-restart. Status enable/disable tool yang sudah termuat tetap live tanpa restart.`,
          };
        } catch (err) {
          return { action: "reply", message: `❌ Gagal install: ${err.message}` };
        }
      }

      return { action: "reply", message: "Sub-command tidak dikenal. Gunakan: /plugin list|disable|enable|reload|install <nama>" };
    }

    // ═══════════════════════════════════════════════════════════
    // /artifact list|get|delete — kelola Artifact dari chat
    // (untuk create/update biasanya dilakukan agent lewat tool `artifact`,
    // ini command manual untuk user melihat/mengelola langsung dari chat)
    // ═══════════════════════════════════════════════════════════
    case "/artifact": {
      const sub = (args[0] || "list").toLowerCase();
      const id = args[1];

      try {
        if (sub === "list") {
          const list = artifactManager.listArtifacts();
          if (list.length === 0) return { action: "reply", message: "📭 Belum ada artifact." };
          const text = list.map((a) => `• [${a.id}] ${a.name} (${a.type}, v${a.version})`).join("\n");
          return { action: "reply", message: `📦 DAFTAR ARTIFACT\n\n${text}` };
        }
        if (sub === "get") {
          if (!id) return { action: "reply", message: "❌ Gunakan: /artifact get <id>" };
          const a = artifactManager.getArtifact(id);
          return { action: "reply", message: `📄 ${a.name} (${a.type}, v${a.version})\n\n${a.content}` };
        }
        if (sub === "delete") {
          if (!id) return { action: "reply", message: "❌ Gunakan: /artifact delete <id>" };
          artifactManager.deleteArtifact(id);
          return { action: "reply", message: `✅ Artifact ${id} dihapus.` };
        }
        return { action: "reply", message: "Sub-command tidak dikenal. Gunakan: /artifact list|get|delete <id>" };
      } catch (err) {
        return { action: "reply", message: `❌ ${err.message}` };
      }
    }

    // ═══════════════════════════════════════════════════════════
    // /learn <nama_skill> — pelajari riwayat sesi chat SAAT INI dan
    // susun jadi Skill baru (skill/<nama>/skill.md + meta.json), memakai
    // format yang sama persis dengan skill bawaan EMORA lainnya supaya
    // langsung terbaca `emora skills` dan dipakai agent di percakapan lain.
    // ═══════════════════════════════════════════════════════════
    case "/learn": {
      const skillNameRaw = args.join(" ").trim();
      if (!skillNameRaw) {
        return { action: "reply", message: "❌ Gunakan: /learn <nama_skill>\nContoh: /learn deploy_ke_vps" };
      }

      try {
        const sessionId = state.currentSession;
        const memory = await loadSession(sessionId);
        if (memory.length === 0) {
          return { action: "reply", message: "❌ Sesi ini belum punya riwayat percakapan untuk dipelajari." };
        }

        const transcript = memory
          .map((m) => `${m.role === "user" ? "User" : "EMORA"}: ${m.content}`)
          .join("\n\n");

        const safeName = skillNameRaw
          .toLowerCase()
          .trim()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_-]/g, "");
        if (!safeName) return { action: "reply", message: "❌ Nama skill tidak valid setelah dibersihkan (pakai huruf/angka)." };

        const skillDir = path.resolve("./skill", safeName);
        if (fs.existsSync(skillDir)) {
          return { action: "reply", message: `❌ Skill "${safeName}" sudah ada. Pilih nama lain atau hapus dulu foldernya.` };
        }

        const systemPrompt =
          "Kamu adalah penyusun dokumentasi Skill untuk agent AI bernama EMORA. Tugasmu: baca transkrip " +
          "percakapan yang diberikan, lalu susun ulang menjadi dokumen SKILL dalam format Markdown yang " +
          "mengajarkan agent CARA MENYELESAIKAN masalah serupa di masa depan — bukan sekadar merangkum " +
          "obrolan. Ikuti struktur ini persis:\n\n" +
          "# <Judul Skill>\n\n" +
          "<1 paragraf ringkas tujuan skill ini>\n\n" +
          "## Workflow / Cara Kerja\n" +
          "<langkah-langkah konkret bernomor, sebutkan nama tool spesifik yang dipakai kalau ada, " +
          "berdasarkan pola yang benar-benar terlihat di transkrip>\n\n" +
          "## Aturan Penting\n" +
          "<bullet point batasan/hal yang harus dihindari, kalau ada yang relevan dari transkrip " +
          "(mis. kesalahan yang terjadi dan cara menghindarinya)>\n\n" +
          "Balas HANYA dengan isi markdown-nya, tanpa pembuka/penutup, tanpa code fence pembungkus.";

        const llm = await createLLM([]);
        const response = await llm.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(`Nama skill yang diinginkan: "${skillNameRaw}"\n\nTranskrip percakapan:\n\n${transcript}`),
        ]);

        let skillMdContent = response?.content;
        if (Array.isArray(skillMdContent)) {
          skillMdContent = skillMdContent.map((b) => (typeof b === "string" ? b : b?.text || "")).join("");
        }
        if (!skillMdContent || !skillMdContent.trim()) {
          return { action: "reply", message: "❌ Gagal menyusun skill (respons AI kosong). Coba lagi." };
        }

        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, "skill.md"), skillMdContent.trim() + "\n", "utf8");
        fs.writeFileSync(
          path.join(skillDir, "meta.json"),
          JSON.stringify(
            {
              name: safeName,
              description: `Skill hasil belajar otomatis dari sesi chat (/learn) pada ${new Date().toISOString()}.`,
              version: "1.0.0",
              author: "EMORA /learn",
              created_at: new Date().toISOString().slice(0, 10),
              source_session: sessionId,
            },
            null,
            2
          ),
          "utf8"
        );

        return {
          action: "reply",
          message: `✅ Skill baru *"${safeName}"* berhasil disusun dari riwayat sesi ini!\n📁 skill/${safeName}/skill.md\n\nCek isinya dengan \`emora skills\`, atau langsung dipakai di percakapan berikutnya.`,
        };
      } catch (err) {
        return { action: "reply", message: `❌ Gagal membuat skill: ${err.message}` };
      }
    }

    default:
      return false; 
  }
}
