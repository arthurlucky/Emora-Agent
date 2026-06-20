import crypto from "crypto";
import fs from "fs";
import path from "path";

export function handleCommand(input, state) {
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
        message: `🤖 EMORA COMMANDS\n\n/new - Buat sesi baru\n/sesi - Lihat sesi aktif\n/sesi <uuid> - Pindah ke sesi lama\n/clear - Hapus semua riwayat sesi\n/help - Bantuan\n/exit - Matikan sistem (Hanya Terminal)` 
      };
    }

    default:
      return false; 
  }
}
