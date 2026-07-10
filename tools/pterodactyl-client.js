import "dotenv/config";
import fs from "fs";
import path from "path";
import axios from "axios";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveWorkspacePath } from "../utils/workspace.js";

// ===================== KONFIGURASI =====================
const PTERODACTYL_URL = process.env.PTERODACTYL_URL ;
const PTERODACTYL_API_KEY = process.env.PTERODACTYL_API_KEY;

// Validasi: HANYAKAN menerima Client API Key (ptlc_)
if (!PTERODACTYL_API_KEY) {
  throw new Error("❌ PTERODACTYL_API_KEY tidak ditemukan di environment variables.");
}

if (!PTERODACTYL_API_KEY.startsWith("ptlc_")) {
  throw new Error(
    "❌ API Key tidak valid. Tool ini khusus untuk Client API Key (prefix 'ptlc_'). " +
    "Key dengan prefix 'ptla_' adalah Application API Key dan tidak didukung."
  );
}

// ===================== HELPERS =====================
async function pterodactylRequest(endpoint, method = "GET", data = null, extraHeaders = {}) {
  const url = `${PTERODACTYL_URL}/api${endpoint}`;
  const headers = {
    Authorization: `Bearer ${PTERODACTYL_API_KEY}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  const config = { method, url, headers, data };
  const response = await axios(config);
  return response.data;
}

async function powerAction(serverId, signal) {
  const endpoint = `/client/servers/${serverId}/power`;
  return pterodactylRequest(endpoint, "POST", { signal });
}

async function downloadFile(serverId, filePath, localFolder = "downloads") {
  const endpoint = `/client/servers/${serverId}/files/download?file=${encodeURIComponent(filePath)}`;
  const url = `${PTERODACTYL_URL}/api${endpoint}`;
  const headers = {
    Authorization: `Bearer ${PTERODACTYL_API_KEY}`,
  };
  const response = await axios({
    method: "GET",
    url,
    headers,
    responseType: "stream",
  });
  const fileName = path.basename(filePath);
  const destDir = resolveWorkspacePath(localFolder);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const destPath = path.join(destDir, fileName);
  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  return destPath;
}

async function uploadFile(serverId, localFilePath, remoteDirectory = "/") {
  const endpoint = `/client/servers/${serverId}/files/upload`;
  const url = `${PTERODACTYL_URL}/api${endpoint}?directory=${encodeURIComponent(remoteDirectory)}`;
  const fileStream = fs.createReadStream(localFilePath);
  const formData = new FormData();
  formData.append("files", fileStream, path.basename(localFilePath));
  const headers = {
    Authorization: `Bearer ${PTERODACTYL_API_KEY}`,
    ...formData.getHeaders(),
  };
  const response = await axios.post(url, formData, { headers });
  return response.data;
}

// ===================== TOOL UTAMA =====================
export const pterodactylManager = new DynamicStructuredTool({
  name: "pterodactyl_manager",
  description: `Kelola server Pterodactyl melalui Client API. Mendukung:
- Server: list, get, resources, power (start/stop/restart/kill), reinstall, websocket
- Console: send command, read logs
- Files: list, read, write, rename, copy, compress, decompress, delete, create folder, upload, download, chmod
- Backups: list, create, restore, delete, download
- Databases: list, rotate password
- Network: list allocations, set primary allocation
- Startup: get variables, set variable
- Account: info, api keys, permissions
Gunakan action sesuai prefix (misal: server_list, files_read, backups_create, account_info).`,
  schema: z.object({
    action: z.enum([
      // Server
      "server_list",
      "server_get",
      "server_get_resources",
      "server_start",
      "server_stop",
      "server_restart",
      "server_kill",
      "server_reinstall",
      "server_websocket",
      // Console
      "console_send_command",
      "console_read_logs",
      // Files
      "files_list",
      "files_read",
      "files_write",
      "files_rename",
      "files_copy",
      "files_compress",
      "files_decompress",
      "files_delete",
      "files_create_folder",
      "files_upload",
      "files_download",
      "files_chmod",
      // Backups
      "backups_list",
      "backups_create",
      "backups_restore",
      "backups_delete",
      "backups_download",
      // Databases
      "databases_list",
      "databases_rotate_password",
      // Network
      "network_list_allocations",
      "network_set_primary_allocation",
      // Startup
      "startup_get_variables",
      "startup_set_variable",
      // Account
      "account_info",
      "account_api_keys",
      "account_permissions",
    ]).describe("Tindakan yang akan dilakukan"),
    // Parameter umum
    serverId: z.string().optional().describe("ID server (untuk aksi yang membutuhkan server)"),
    filePath: z.string().optional().describe("Path file di dalam server (untuk file operations)"),
    fileName: z.string().optional().describe("Nama file (untuk rename/copy)"),
    content: z.string().optional().describe("Konten file (untuk files_write)"),
    folder: z.string().optional().describe("Nama folder (untuk files_create_folder)"),
    backupId: z.string().optional().describe("ID backup (untuk backups_*)"),
    databaseId: z.string().optional().describe("ID database (untuk databases_rotate_password)"),
    allocationId: z.string().optional().describe("ID alokasi (untuk network_set_primary_allocation)"),
    variable: z.string().optional().describe("Nama variabel startup (untuk startup_set_variable)"),
    value: z.string().optional().describe("Nilai variabel startup (untuk startup_set_variable)"),
    command: z.string().optional().describe("Perintah console (untuk console_send_command)"),
    localPath: z.string().optional().describe("Path file lokal (untuk files_upload)"),
    remoteDir: z.string().optional().describe("Direktori remote tujuan upload (untuk files_upload)"),
    downloadFolder: z.string().optional().describe("Folder lokal untuk menyimpan download (default: downloads)"),
  }),

  func: async ({
    action,
    serverId,
    filePath,
    fileName,
    content,
    folder,
    backupId,
    databaseId,
    allocationId,
    variable,
    value,
    command,
    localPath,
    remoteDir,
    downloadFolder,
  }) => {
    try {
      // ---------- SERVER ----------
      if (action === "server_list") {
        const data = await pterodactylRequest("/client/servers");
        const servers = data.data || [];
        if (servers.length === 0) return "ℹ️ Tidak ada server.";
        const list = servers.map((s) => {
          const attrs = s.attributes;
          return `- ${attrs.name} (ID: ${attrs.identifier}, status: ${attrs.status || "unknown"})`;
        }).join("\n");
        return `📡 Daftar Server:\n${list}`;
      }

      if (action === "server_get") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const data = await pterodactylRequest(`/client/servers/${serverId}`);
        const attrs = data.attributes || {};
        return `📄 Server ${attrs.name || serverId}:
- ID: ${attrs.identifier}
- UUID: ${attrs.uuid}
- Status: ${attrs.status || "unknown"}
- CPU: ${attrs.limits?.cpu || "N/A"}
- Memory: ${attrs.limits?.memory || "N/A"}
- Disk: ${attrs.limits?.disk || "N/A"}`;
      }

      if (action === "server_get_resources") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const data = await pterodactylRequest(`/client/servers/${serverId}/resources`);
        const stats = data.attributes || {};
        return `📊 Resources untuk server ${serverId}:
- CPU: ${stats.cpu_absolute || 0}%
- Memory: ${stats.memory_bytes || 0} bytes
- Disk: ${stats.disk_bytes || 0} bytes
- Network RX: ${stats.network_rx_bytes || 0} bytes
- Network TX: ${stats.network_tx_bytes || 0} bytes`;
      }

      if (action === "server_start") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        await powerAction(serverId, "start");
        return `✅ Server ${serverId} start command sent.`;
      }
      if (action === "server_stop") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        await powerAction(serverId, "stop");
        return `✅ Server ${serverId} stop command sent.`;
      }
      if (action === "server_restart") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        await powerAction(serverId, "restart");
        return `✅ Server ${serverId} restart command sent.`;
      }
      if (action === "server_kill") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        await powerAction(serverId, "kill");
        return `✅ Server ${serverId} kill command sent.`;
      }

      if (action === "server_reinstall") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        await pterodactylRequest(`/client/servers/${serverId}/reinstall`, "POST");
        return `✅ Server ${serverId} reinstall initiated.`;
      }

      if (action === "server_websocket") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const data = await pterodactylRequest(`/client/servers/${serverId}/websocket`);
        const token = data.data?.token || "N/A";
        const socketUrl = data.data?.socket || "N/A";
        return `🔌 WebSocket Token: ${token}\nSocket URL: ${socketUrl}`;
      }

      // ---------- CONSOLE ----------
      if (action === "console_send_command") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!command) return "❌ Parameter command diperlukan.";
        await pterodactylRequest(`/client/servers/${serverId}/command`, "POST", { command });
        return `✅ Perintah "${command}" dikirim ke server ${serverId}.`;
      }

      if (action === "console_read_logs") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const data = await pterodactylRequest(`/client/servers/${serverId}/logs`);
        const logs = data.data || "Tidak ada log.";
        return `📜 Logs server ${serverId}:\n${logs}`;
      }

      // ---------- FILES ----------
      if (action === "files_list") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) filePath = "/";
        const data = await pterodactylRequest(
          `/client/servers/${serverId}/files/list?directory=${encodeURIComponent(filePath)}`
        );
        const files = data.data || [];
        if (files.length === 0) return `ℹ️ Tidak ada file di ${filePath}.`;
        const list = files.map((f) => {
          const isDir = f.attributes?.is_file === false ? "[DIR]" : "[FILE]";
          return `${isDir} ${f.attributes?.name} (${f.attributes?.size || 0} bytes)`;
        }).join("\n");
        return `📂 Daftar file di ${filePath}:\n${list}`;
      }

      if (action === "files_read") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath diperlukan.";
        const data = await pterodactylRequest(
          `/client/servers/${serverId}/files/contents?file=${encodeURIComponent(filePath)}`
        );
        return `📄 Isi file ${filePath}:\n${data}`;
      }

      if (action === "files_write") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath diperlukan.";
        if (content === undefined) return "❌ Parameter content diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/files/write?file=${encodeURIComponent(filePath)}`,
          "POST",
          { content }
        );
        return `✅ File ${filePath} berhasil ditulis.`;
      }

      if (action === "files_rename") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath (sumber) diperlukan.";
        if (!fileName) return "❌ Parameter fileName (tujuan) diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/files/rename`,
          "PUT",
          { root: "/", files: [{ from: filePath, to: fileName }] }
        );
        return `✅ File ${filePath} berhasil direname menjadi ${fileName}.`;
      }

      if (action === "files_copy") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath (sumber) diperlukan.";
        if (!fileName) return "❌ Parameter fileName (tujuan) diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/files/copy`,
          "POST",
          { location: filePath, target: fileName }
        );
        return `✅ File ${filePath} berhasil disalin ke ${fileName}.`;
      }

      if (action === "files_compress") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath (folder/file) diperlukan.";
        const name = fileName || "archive.zip";
        await pterodactylRequest(
          `/client/servers/${serverId}/files/compress`,
          "POST",
          { root: "/", files: [filePath], name }
        );
        return `✅ Kompresi ${filePath} menjadi ${name} berhasil dimulai.`;
      }

      if (action === "files_decompress") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath (file zip) diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/files/decompress`,
          "POST",
          { root: "/", file: filePath }
        );
        return `✅ Dekompresi ${filePath} berhasil dimulai.`;
      }

      if (action === "files_delete") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/files/delete`,
          "POST",
          { root: "/", files: [filePath] }
        );
        return `✅ File/folder ${filePath} berhasil dihapus.`;
      }

      if (action === "files_create_folder") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath (path folder baru) diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/files/create-folder`,
          "POST",
          { root: "/", name: filePath }
        );
        return `✅ Folder ${filePath} berhasil dibuat.`;
      }

      if (action === "files_upload") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!localPath) return "❌ Parameter localPath diperlukan.";
        if (!fs.existsSync(localPath)) return `❌ File lokal ${localPath} tidak ditemukan.`;
        const remoteDirectory = remoteDir || "/";
        await uploadFile(serverId, localPath, remoteDirectory);
        return `✅ File ${localPath} berhasil diupload ke ${remoteDirectory} pada server ${serverId}.`;
      }

      if (action === "files_download") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath diperlukan.";
        const folder = downloadFolder || "downloads";
        const destPath = await downloadFile(serverId, filePath, folder);
        return `✅ File ${filePath} berhasil didownload ke ${destPath}.`;
      }

      if (action === "files_chmod") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!filePath) return "❌ Parameter filePath diperlukan.";
        if (!value) return "❌ Parameter value (mode chmod) diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/files/chmod`,
          "POST",
          { root: "/", files: [{ file: filePath, mode: value }] }
        );
        return `✅ Mode ${value} diterapkan pada ${filePath}.`;
      }

      // ---------- BACKUPS ----------
      if (action === "backups_list") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const data = await pterodactylRequest(`/client/servers/${serverId}/backups`);
        const backups = data.data || [];
        if (backups.length === 0) return `ℹ️ Tidak ada backup untuk server ${serverId}.`;
        const list = backups.map((b) => {
          const attrs = b.attributes;
          return `- ${attrs.name || attrs.uuid} (ID: ${attrs.uuid}, size: ${attrs.bytes || 0} bytes, created: ${attrs.created_at})`;
        }).join("\n");
        return `📦 Daftar Backup server ${serverId}:\n${list}`;
      }

      if (action === "backups_create") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const name = fileName || `backup-${Date.now()}`;
        const data = await pterodactylRequest(
          `/client/servers/${serverId}/backups`,
          "POST",
          { name, is_locked: false }
        );
        const backup = data.attributes || {};
        return `✅ Backup "${backup.name || name}" dibuat dengan ID: ${backup.uuid}`;
      }

      if (action === "backups_restore") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!backupId) return "❌ Parameter backupId diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/backups/${backupId}/restore`,
          "POST"
        );
        return `✅ Restore backup ${backupId} untuk server ${serverId} dimulai.`;
      }

      if (action === "backups_delete") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!backupId) return "❌ Parameter backupId diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/backups/${backupId}`,
          "DELETE"
        );
        return `✅ Backup ${backupId} berhasil dihapus.`;
      }

      if (action === "backups_download") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!backupId) return "❌ Parameter backupId diperlukan.";
        const endpoint = `/client/servers/${serverId}/backups/${backupId}/download`;
        const url = `${PTERODACTYL_URL}/api${endpoint}`;
        const headers = { Authorization: `Bearer ${PTERODACTYL_API_KEY}` };
        const response = await axios({
          method: "GET",
          url,
          headers,
          responseType: "stream",
        });
        const destDir = resolveWorkspacePath(downloadFolder || "downloads");
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, `backup-${backupId}.zip`);
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });
        return `✅ Backup ${backupId} didownload ke ${destPath}`;
      }

      // ---------- DATABASES ----------
      if (action === "databases_list") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const data = await pterodactylRequest(`/client/servers/${serverId}/databases`);
        const dbs = data.data || [];
        if (dbs.length === 0) return `ℹ️ Tidak ada database untuk server ${serverId}.`;
        const list = dbs.map((db) => {
          const attrs = db.attributes;
          return `- ${attrs.name} (ID: ${attrs.id}, host: ${attrs.host})`;
        }).join("\n");
        return `🗄️ Database server ${serverId}:\n${list}`;
      }

      if (action === "databases_rotate_password") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!databaseId) return "❌ Parameter databaseId diperlukan.";
        const data = await pterodactylRequest(
          `/client/servers/${serverId}/databases/${databaseId}/rotate-password`,
          "POST"
        );
        const password = data.attributes?.password || "Tidak tersedia";
        return `✅ Password database ${databaseId} dirotasi. Password baru: ${password}`;
      }

      // ---------- NETWORK ----------
      if (action === "network_list_allocations") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const data = await pterodactylRequest(`/client/servers/${serverId}/network/allocations`);
        const allocations = data.data || [];
        if (allocations.length === 0) return `ℹ️ Tidak ada alokasi untuk server ${serverId}.`;
        const list = allocations.map((a) => {
          const attrs = a.attributes;
          return `- ${attrs.ip}:${attrs.port} (primary: ${attrs.is_primary ? "✅" : "❌"})`;
        }).join("\n");
        return `🌐 Alokasi server ${serverId}:\n${list}`;
      }

      if (action === "network_set_primary_allocation") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!allocationId) return "❌ Parameter allocationId diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/network/allocations/${allocationId}/primary`,
          "POST"
        );
        return `✅ Alokasi ${allocationId} dijadikan primary untuk server ${serverId}.`;
      }

      // ---------- STARTUP ----------
      if (action === "startup_get_variables") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        const data = await pterodactylRequest(`/client/servers/${serverId}/startup`);
        const vars = data.data || [];
        if (vars.length === 0) return `ℹ️ Tidak ada variabel startup untuk server ${serverId}.`;
        const list = vars.map((v) => {
          const attrs = v.attributes || v;
          return `- ${attrs.name}: ${attrs.value} (env: ${attrs.env_variable})`;
        }).join("\n");
        return `⚙️ Startup Variables server ${serverId}:\n${list}`;
      }

      if (action === "startup_set_variable") {
        if (!serverId) return "❌ Parameter serverId diperlukan.";
        if (!variable) return "❌ Parameter variable (nama env) diperlukan.";
        if (value === undefined) return "❌ Parameter value diperlukan.";
        await pterodactylRequest(
          `/client/servers/${serverId}/startup/variable`,
          "PUT",
          { key: variable, value }
        );
        return `✅ Variabel ${variable} diatur ke "${value}" untuk server ${serverId}.`;
      }

      // ---------- ACCOUNT ----------
      if (action === "account_info") {
        const data = await pterodactylRequest("/account");
        const attrs = data.attributes || {};
        return `👤 Informasi Akun:
- ID: ${attrs.id}
- Nama: ${attrs.first_name} ${attrs.last_name}
- Email: ${attrs.email}
- Username: ${attrs.username}
- 2FA: ${attrs["2fa_enabled"] ? "Enabled" : "Disabled"}`;
      }

      if (action === "account_api_keys") {
        const data = await pterodactylRequest("/api-keys");
        const keys = data.data || [];
        if (keys.length === 0) return "ℹ️ Tidak ada API key.";
        const list = keys.map((k) => {
          const attrs = k.attributes || k;
          return `- ${attrs.identifier} (created: ${attrs.created_at})`;
        }).join("\n");
        return `🔑 API Keys:\n${list}`;
      }

      if (action === "account_permissions") {
        const data = await pterodactylRequest("/permissions");
        const permissions = data.data || [];
        if (permissions.length === 0) return "ℹ️ Tidak ada permission khusus.";
        const list = permissions.join("\n");
        return `📋 Permissions:\n${list}`;
      }

      return `❌ Action "${action}" tidak dikenali.`;
    } catch (err) {
      let errorMsg = err.message;
      if (err.response) {
        errorMsg = `${err.response.status} - ${err.response.statusText}: ${JSON.stringify(err.response.data)}`;
      }
      return `❌ Error di pterodactyl_manager: ${errorMsg}`;
    }
  },
});

export default pterodactylManager;