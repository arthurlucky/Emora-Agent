/**
 * cli/cmd-obsidian.js — `emora obsidian`
 *
 * Setup terhubung ke Obsidian lewat MCP (Model Context Protocol) — cara
 * standar yang sama dipakai Claude Desktop/Claude Code/CLI agent lain buat
 * ngobrol dengan vault Obsidian.
 *
 * Caranya lewat plugin community "Local REST API" (coddingtonbear), yang
 * sejak beberapa rilis terakhir sudah punya SERVER MCP BAWAAN di endpoint
 * `/mcp/` (Streamable HTTP) — jadi EMORA tidak perlu proses bridge Python/
 * Node terpisah (mis. uvx mcp-obsidian), cukup connect langsung.
 *
 * Prasyarat di sisi Obsidian (dilakukan user sendiri di app Obsidian):
 *   1. Install & aktifkan community plugin "Local REST API".
 *   2. Buka Settings → Local REST API, salin "API Key" yang digenerate.
 *   3. Pastikan Obsidian & vault yang mau dipakai sedang terbuka (server
 *      REST/MCP jalan di dalam proses Obsidian, jadi app-nya harus hidup).
 *
 * Sub-commands:
 *   emora obsidian setup   — wizard interaktif: masukkan API key, tes
 *                             koneksi, simpan ke .env + mcp/mcp.config.json
 *   emora obsidian status  — tampilkan konfigurasi & jumlah tool MCP saat ini
 *   emora obsidian test    — tes ulang koneksi ke server yang sudah dikonfigurasi
 *   emora obsidian remove  — hapus konfigurasi Obsidian
 */

import fs from "fs";
import path from "path";
import https from "https";
import axios from "axios";
import { select, confirm, input, sectionHeader, sectionFooter, infoLine, successLine, warnLine, errorLine } from "./select.js";

const CONFIG_PATH = "./mcp/mcp.config.json";
const ENV_PATH = "./.env";
const SERVER_NAME = "obsidian";

function readMcpConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { servers: [], emora_as_server: { enabled: false, port: 3099, transport: "stdio" } };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeMcpConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/** Simpan/perbarui API key ke .env sebagai OBSIDIAN_API_KEY=... (bukan ditulis mentah di JSON). */
function upsertEnvVar(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    content = content.trimEnd() + (content.trim() ? "\n" : "") + line + "\n";
  }
  fs.writeFileSync(ENV_PATH, content);
}

/** Tes koneksi ke root endpoint Local REST API (`GET /`) — balasannya manifest server + versi. */
async function testRestConnection({ protocol, host, port, apiKey }) {
  const baseUrl = `${protocol}://${host}:${port}`;
  const agent = protocol === "https" ? new https.Agent({ rejectUnauthorized: false }) : undefined;
  const res = await axios.get(`${baseUrl}/`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    httpsAgent: agent,
    timeout: 8000,
    validateStatus: () => true,
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.data, baseUrl };
}

/** Tes koneksi MCP penuh (initialize + tools/list) lewat client HTTP yang sama dipakai runtime. */
async function testMcpConnection({ protocol, host, port, apiKey }) {
  const { createMCPHttpClient } = await import("../mcp/mcp_client.js");
  const client = createMCPHttpClient({
    url: `${protocol}://${host}:${port}/mcp/`,
    headers: { Authorization: `Bearer ${apiKey}` },
    insecureTLS: protocol === "https",
  });
  await client.initialize();
  const tools = await client.listTools();
  client.close();
  return tools;
}

async function runSetup() {
  sectionHeader("OBSIDIAN SETUP", "Hubungkan EMORA ke vault Obsidian lewat MCP");
  infoLine("Prasyarat", "Plugin community \"Local REST API\" sudah aktif di Obsidian, dan Obsidian sedang terbuka");
  console.log();

  const protocol = await select("Protokol:", [
    { label: "https — direkomendasikan (port default 27124, sertifikat self-signed OK)", value: "https" },
    { label: "http  — lebih simpel, hanya untuk pemakaian lokal terpercaya (port default 27123)", value: "http" },
  ]);
  const defaultPort = protocol === "https" ? "27124" : "27123";
  const host = (await input("Host:", "127.0.0.1")) || "127.0.0.1";
  const port = (await input("Port:", defaultPort)) || defaultPort;
  const apiKey = await input("API Key (dari Obsidian → Settings → Local REST API):");

  if (!apiKey) {
    errorLine("API Key wajib diisi. Batal setup.");
    sectionFooter();
    return;
  }

  console.log();
  warnLine("Menguji koneksi ke Obsidian...");

  try {
    const rest = await testRestConnection({ protocol, host, port, apiKey });
    if (!rest.ok) {
      errorLine(`Gagal konek (HTTP ${rest.status}). Cek: Obsidian terbuka? API key benar? Port benar?`);
      sectionFooter();
      return;
    }
    successLine(`REST API terjawab (${rest.baseUrl}) — versi: ${rest.data?.versions?.obsidian || rest.data?.service || "?"}`);
  } catch (err) {
    errorLine(`Gagal konek: ${err.message}`);
    sectionFooter();
    return;
  }

  let toolCount = 0;
  try {
    const tools = await testMcpConnection({ protocol, host, port, apiKey });
    toolCount = tools.length;
    successLine(`Endpoint MCP (/mcp/) terjawab — ${toolCount} tool tersedia (read/write/patch/search notes, dll).`);
  } catch (err) {
    warnLine(`REST API jalan, tapi endpoint MCP bawaan (/mcp/) gagal dites: ${err.message}`);
    warnLine("Pastikan versi plugin \"Local REST API\" sudah mendukung MCP server bawaan (update ke versi terbaru).");
    const proceed = await confirm("Tetap simpan konfigurasi ini?", { default: false });
    if (!proceed) { sectionFooter(); return; }
  }

  // Simpan API key di .env (bukan di JSON), reference lewat ${OBSIDIAN_API_KEY}
  upsertEnvVar("OBSIDIAN_API_KEY", apiKey);

  const cfg = readMcpConfig();
  cfg.servers = (cfg.servers || []).filter((s) => s.name !== SERVER_NAME);
  cfg.servers.push({
    name: SERVER_NAME,
    type: "http",
    url: `${protocol}://${host}:${port}/mcp/`,
    headers: { Authorization: "Bearer ${OBSIDIAN_API_KEY}" },
    insecureTLS: protocol === "https",
    enabled: true,
  });
  writeMcpConfig(cfg);

  console.log();
  successLine(`Obsidian terhubung! Tersimpan sebagai MCP server "${SERVER_NAME}" di mcp/mcp.config.json.`);
  infoLine("Tool baru muncul di EMORA", "setelah restart gateway/TUI (batasan LLM function-calling binding-once)");
  infoLine("Skill panduan pemakaian", "otomatis tersedia di skill/obsidian_vault — cek `emora skills`");
  sectionFooter();
}

async function runStatus() {
  const cfg = readMcpConfig();
  const srv = (cfg.servers || []).find((s) => s.name === SERVER_NAME);

  sectionHeader("OBSIDIAN STATUS", srv ? "Terkonfigurasi" : "Belum dikonfigurasi");
  if (!srv) {
    warnLine("Belum ada konfigurasi Obsidian. Jalankan `emora obsidian setup`.");
    sectionFooter();
    return;
  }
  infoLine("Server", srv.name);
  infoLine("URL", srv.url);
  infoLine("Status", srv.enabled !== false ? "Aktif" : "Nonaktif (disabled)", srv.enabled !== false ? "green" : "yellow");
  infoLine("TLS self-signed", srv.insecureTLS ? "diterima" : "ditolak (strict)");
  const hasKey = !!process.env.OBSIDIAN_API_KEY || (fs.existsSync(ENV_PATH) && /^OBSIDIAN_API_KEY=.+/m.test(fs.readFileSync(ENV_PATH, "utf8")));
  infoLine("API Key di .env", hasKey ? "tersimpan" : "TIDAK ADA — jalankan setup ulang", hasKey ? "green" : "red");
  sectionFooter();
}

async function runTest() {
  const cfg = readMcpConfig();
  const srv = (cfg.servers || []).find((s) => s.name === SERVER_NAME);
  if (!srv) {
    errorLine("Belum ada konfigurasi Obsidian. Jalankan `emora obsidian setup` dulu.");
    return;
  }

  sectionHeader("OBSIDIAN TEST", srv.url);
  try {
    const { createMCPHttpClient } = await import("../mcp/mcp_client.js");
    const apiKey = process.env.OBSIDIAN_API_KEY || "";
    const client = createMCPHttpClient({
      url: srv.url,
      headers: { Authorization: `Bearer ${apiKey}` },
      insecureTLS: !!srv.insecureTLS,
    });
    await client.initialize();
    const tools = await client.listTools();
    client.close();
    successLine(`Koneksi OK — ${tools.length} tool tersedia:`);
    for (const t of tools.slice(0, 20)) infoLine(t.name, t.description || "", "muted");
  } catch (err) {
    errorLine(`Gagal konek: ${err.message}`);
    warnLine("Pastikan Obsidian sedang terbuka dan plugin Local REST API aktif.");
  }
  sectionFooter();
}

async function runRemove() {
  const cfg = readMcpConfig();
  const before = (cfg.servers || []).length;
  cfg.servers = (cfg.servers || []).filter((s) => s.name !== SERVER_NAME);
  writeMcpConfig(cfg);
  if (cfg.servers.length < before) successLine("Konfigurasi Obsidian dihapus dari mcp/mcp.config.json.");
  else warnLine("Tidak ada konfigurasi Obsidian untuk dihapus.");
}

export async function cmdObsidian(argv) {
  const sub = argv[0] || "setup";
  switch (sub) {
    case "setup": return runSetup();
    case "status": return runStatus();
    case "test": return runTest();
    case "remove": return runRemove();
    default:
      warnLine(`Sub-command "${sub}" tidak dikenal. Gunakan: setup | status | test | remove`);
  }
}
