import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  listSessions,
  getSession,
  deleteSession,
} from "./sessionStore.js";

export async function handleCommand(input, state) {
  const [command, ...args] = input.split(" ");

  switch (command) {
    case "/exit":
      return { 
        action: "exit", 
        message: "Terima kasih telah menggunakan EMORA." 
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
        const memoryDir = path.resolve("./memory");
        let deletedCount = 0;

        if (currentId && fs.existsSync(memoryDir)) {
          const filesToDelete = fs
            .readdirSync(memoryDir)
            .filter((f) => f === `${currentId}.json` || f.startsWith(`${currentId}_bg_`));

          for (const file of filesToDelete) {
            fs.unlinkSync(path.join(memoryDir, file));
            deletedCount++;
          }
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
    
    

    default:
      return false; 
  }
}
