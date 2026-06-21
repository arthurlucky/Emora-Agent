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
        const memoryDir = path.resolve("./memory");
        let deletedCount = 0;
        
        // Baca direktori dan hapus semua file JSON
        if (fs.existsSync(memoryDir)) {
          const files = fs.readdirSync(memoryDir);
          for (const file of files) {
            if (file.endsWith(".json")) {
              fs.unlinkSync(path.join(memoryDir, file));
              deletedCount++;
            }
          }
        }

        // Generate sesi baru karena sesi yang sedang dipakai juga ikut terhapus
        const newSessionId = crypto.randomUUID();
        state.currentSession = newSessionId;

        return { 
          action: "reply", 
          message: `🗑️ Berhasil menghapus ${deletedCount} riwayat sesi.\n✅ Session baru otomatis dibuat:\n${newSessionId}` 
        };
      } catch (err) {
        return { 
          action: "reply", 
          message: `❌ Gagal menghapus sesi: ${err.message}` 
        };
      }
    }

    case "/help": {
      return { 
        action: "reply", 
        message: `🤖 EMORA COMMANDS

/new - Buat sesi baru
/sesi - Lihat sesi aktif
/sesi <uuid> - Pindah sesi
/sesilist - Lihat semua sesi
/sesiinfo <uuid> - Detail sesi
/sesidel <uuid> - Hapus sesi
/clear - Hapus semua sesi
/help - Bantuan
/exit - Keluar` 
      };
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
