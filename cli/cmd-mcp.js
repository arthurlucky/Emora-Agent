/**
 * cli/cmd-mcp.js — `emora mcp`
 *
 * Model Context Protocol (MCP) manager untuk EMORA.
 *
 * Sub-commands:
 *   emora mcp list    — Daftar MCP server yang dikonfigurasi
 *   emora mcp add     — Tambah MCP server baru
 *   emora mcp remove  — Hapus MCP server
 *   emora mcp test    — Test koneksi ke MCP server
 *   emora mcp serve   — Jalankan EMORA sebagai MCP server (expose tools via stdio/SSE)
 *
 * Config disimpan di ./mcp.config.json (tidak di .env karena strukturnya
 * JSON kompleks, bukan key=value sederhana).
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { select, confirm, input, sectionHeader, sectionFooter, infoLine, successLine, warnLine, errorLine } from "./select.js";

const CONFIG_PATH = "./mcp.config.json";

// Use chalk instances (chainable) instead of arrow functions
const C = {
  cyan:    chalk.hex("#58a6ff"),
  green:   chalk.hex("#3fb950"),
  yellow:  chalk.hex("#d29922"),
  red:     chalk.hex("#f85149"),
  purple:  chalk.hex("#a371f7"),
  muted:   chalk.hex("#8b949e"),
  dim:     chalk.hex("#6e7681"),
  primary: chalk.hex("#e6edf3"),
};

// ─────────────────────────────────────────────
// Config helpers
// ─────────────────────────────────────────────
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { servers: [], emora_as_server: { enabled: false, port: 3099, transport: "stdio" } };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ─────────────────────────────────────────────
// EMORA sebagai MCP Server
// ─────────────────────────────────────────────
async function runAsServer(cfg) {
  const port      = cfg.emora_as_server?.port || 3099;
  const transport = cfg.emora_as_server?.transport || "stdio";

  sectionHeader("MCP SERVER", `Menjalankan EMORA sebagai MCP Server`);
  infoLine("Transport", transport);
  infoLine("Port",      transport === "sse" ? String(port) : "N/A (stdio)");
  warnLine("Tekan Ctrl+C untuk menghentikan");
  sectionFooter();

  if (transport === "stdio") {
    // MCP via stdio — kirim & terima JSON-RPC lewat stdin/stdout
    // Ini protokol standar MCP yang dipakai Claude Desktop, Cursor, dsb.
    console.log(JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "emora-agent", version: "1.0.0" },
      },
    }));

    // Tools registration — expose semua EMORA tools sebagai MCP tools
    const tools = await import("../core/tools.js").then(m => m.default);
    const mcpTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.schema ? {
        type: "object",
        properties: t.schema.shape ? Object.fromEntries(
          Object.entries(t.schema.shape).map(([k, v]) => [k, { type: "string", description: v.description || "" }])
        ) : {},
        required: [],
      } : { type: "object", properties: {} },
    }));

    // Handler stdin
    process.stdin.setEncoding("utf8");
    let buffer = "";
    process.stdin.on("data", async (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const response = await handleMCPMessage(msg, tools, mcpTools);
          if (response) process.stdout.write(JSON.stringify(response) + "\n");
        } catch (err) {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` },
          }) + "\n");
        }
      }
    });

  } else {
    // SSE transport — HTTP server dengan endpoint MCP
    const { createServer } = await import("http");
    const { createLLM } = await import("../provider/index.js");
    const tools = await import("../core/tools.js").then(m => m.default);

    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      if (req.url === "/sse" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        res.write("data: {\"type\":\"connected\"}\n\n");
        req.on("close", () => {});
        return;
      }

      if (req.url === "/message" && req.method === "POST") {
        let body = "";
        req.on("data", c => { body += c; });
        req.on("end", async () => {
          try {
            const msg  = JSON.parse(body);
            const resp = await handleMCPMessage(msg, tools, []);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
          } catch (err) {
            res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      res.writeHead(404); res.end("Not found");
    });

    server.listen(port, () => {
      console.log(C.green(`\n  ✓ EMORA MCP Server aktif di http://localhost:${port}/sse\n`));
    });

    process.on("SIGINT", () => { server.close(); process.exit(0); });
  }
}

async function handleMCPMessage(msg, tools, mcpTools) {
  const { method, id, params } = msg;

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: mcpTools } };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Tool "${toolName}" tidak ditemukan` } };
    }
    try {
      const result = await tool.invoke(toolArgs);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(result) }] } };
    } catch (err) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: err.message } };
    }
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  return null;
}

// ─────────────────────────────────────────────
// Main command
// ─────────────────────────────────────────────
export async function cmdMcp(argv) {
  const subCmd = argv[0];
  const cfg    = readConfig();

  if (subCmd === "serve") {
    return runAsServer(cfg);
  }

  if (subCmd === "list") {
    sectionHeader("MCP SERVERS", `${cfg.servers.length} server dikonfigurasi`);
    if (!cfg.servers.length) {
      warnLine("Belum ada MCP server. Gunakan `emora mcp add` untuk menambah.");
    } else {
      cfg.servers.forEach((s, i) => {
        infoLine(`[${i + 1}] ${s.name}`, `${s.type === "stdio" ? "stdio" : s.url || "—"}`, "cyan");
      });
    }
    infoLine("EMORA as server", cfg.emora_as_server?.enabled ? "Aktif" : "Nonaktif",
      cfg.emora_as_server?.enabled ? "green" : "yellow");
    sectionFooter();
    return;
  }

  // Interactive menu
  let running = true;
  while (running) {
    const freshCfg = readConfig();
    sectionHeader("MCP MANAGER", `${freshCfg.servers.length} external server  /  EMORA server: ${freshCfg.emora_as_server?.enabled ? "aktif" : "nonaktif"}`);

    const action = await select("Pilih aksi:", [
      { label: "📋  Lihat semua MCP server",              value: "list"   },
      { label: "➕  Tambah MCP server eksternal",          value: "add"    },
      { label: "🗑️   Hapus MCP server",                    value: "remove" },
      { label: "🔌  Konfigurasi EMORA sebagai MCP server", value: "config" },
      { label: "🚀  Jalankan EMORA sebagai MCP server",   value: "serve"  },
      { label: "←   Keluar",                               value: "exit"   },
    ]);

    switch (action) {
      case "list": {
        if (!freshCfg.servers.length) {
          warnLine("Belum ada MCP server dikonfigurasi.");
        } else {
          freshCfg.servers.forEach((s, i) => {
            console.log(C.cyan("  │  ") + C.green(`[${i+1}] `) + C.primary(s.name.padEnd(24)) + C.muted(s.url || s.command || "stdio"));
          });
        }
        console.log();
        break;
      }

      case "add": {
        const transport = await select("Tipe transport:", [
          { label: "stdio   — Jalankan sebagai child process (command)",  value: "stdio" },
          { label: "sse     — HTTP + Server-Sent Events",                 value: "sse"   },
        ]);
        const name = await input("Nama server (unik):");
        let server = { name, type: transport };
        if (transport === "stdio") {
          server.command = await input("Command (mis. npx mcp-server-github):");
          const rawArgs  = await input("Args (pisah spasi, kosongkan jika tidak ada):");
          server.args    = rawArgs ? rawArgs.split(" ").filter(Boolean) : [];
        } else {
          server.url = await input("URL SSE endpoint (mis. http://localhost:3000/sse):");
        }
        const envVarsRaw = await input("Env vars tambahan (format KEY=VALUE, pisah koma):");
        if (envVarsRaw) {
          server.env = Object.fromEntries(envVarsRaw.split(",").map(e => e.split("=").map(s => s.trim())));
        }
        freshCfg.servers.push(server);
        writeConfig(freshCfg);
        successLine(`MCP server "${name}" berhasil ditambahkan`);
        console.log();
        break;
      }

      case "remove": {
        if (!freshCfg.servers.length) { warnLine("Tidak ada server untuk dihapus."); break; }
        const chosen = await select("Pilih server yang akan dihapus:", freshCfg.servers.map(s => ({
          label: s.name, value: s.name,
        })));
        const ok = await confirm(`Hapus "${chosen}"?`, { default: false });
        if (ok) {
          freshCfg.servers = freshCfg.servers.filter(s => s.name !== chosen);
          writeConfig(freshCfg);
          successLine(`Server "${chosen}" dihapus`);
        }
        console.log();
        break;
      }

      case "config": {
        const enable  = await confirm("Aktifkan EMORA sebagai MCP server?", { default: freshCfg.emora_as_server?.enabled || false });
        if (enable) {
          const transport = await select("Transport:", [
            { label: "stdio  — Untuk Claude Desktop / Cursor / Windsurf", value: "stdio" },
            { label: "sse    — Untuk remote / browser client",            value: "sse"   },
          ]);
          const port = transport === "sse" ? await input("Port SSE server:", "3099") : "3099";
          freshCfg.emora_as_server = { enabled: true, transport, port: Number(port) };
          successLine("EMORA dikonfigurasi sebagai MCP server");
          if (transport === "stdio") {
            console.log(C.cyan("  │"));
            warnLine("Tambahkan ini ke claude_desktop_config.json:");
            console.log(C.cyan("  │  ") + C.dim(JSON.stringify({
              "emora": { "command": "emora", "args": ["mcp", "serve"] }
            }, null, 2).split("\n").join("\n" + C.cyan("  │  "))));
          }
        } else {
          freshCfg.emora_as_server = { ...freshCfg.emora_as_server, enabled: false };
        }
        writeConfig(freshCfg);
        console.log();
        break;
      }

      case "serve": {
        running = false;
        return runAsServer(freshCfg);
      }

      case "exit":
        running = false;
        sectionFooter();
        break;
    }
  }
}
