/**
 * tools/mcp_bridge.js
 *
 * Membaca ./mcp/mcp.config.json, menyalakan semua MCP server eksternal
 * yang dikonfigurasi — baik "stdio" (child process, mis. autocad-mcp,
 * mcp-server-github) MAUPUN "http" (Streamable HTTP, mis. server MCP
 * bawaan plugin Obsidian Local REST API di https://127.0.0.1:27124/mcp/)
 * — lalu convert tool-tool yang mereka expose jadi DynamicStructuredTool
 * biar bisa langsung dipanggil LLM EMORA kayak tool native lainnya.
 *
 * Selain server dari mcp.config.json, modul ini juga menerima server yang
 * "dititipkan" oleh plugin lewat `.mcp.json` (format standar Claude Code —
 * lihat core/pluginManager.js `registerPendingMcpServers`), supaya install
 * 1 plugin sekaligus otomatis menyalakan MCP server yang dibawanya, tanpa
 * user harus mengedit mcp.config.json manual.
 *
 * Nama tool hasil bridge diberi prefix "mcp_<server>__<tool>" supaya
 * gak tabrakan dengan tool lokal dan jelas asalnya dari MCP server mana.
 *
 * Server bertipe "sse" (legacy, sebelum Streamable HTTP jadi standar)
 * belum di-bridge versi ini.
 */

import fs   from "fs";
import path from "path";

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import { createMCPClient, createMCPHttpClient } from "../mcp/mcp_client.js";

const CONFIG_PATH = "./mcp/mcp.config.json";

// Klien aktif disimpan supaya bisa di-close saat EMORA exit.
const activeClients = [];

// Server yang "dititipkan" oleh plugin lewat .mcp.json — diisi
// core/pluginManager.js SEBELUM loadMCPTools() dipanggil (lihat urutan di
// core/tools.js: loadAllPlugins() dulu, baru loadMCPTools()).
const pendingPluginServers = [];

/**
 * Ganti placeholder `${VAR_NAME}` di string dengan process.env.VAR_NAME.
 * Dipakai supaya secret (API key dll) disimpan di .env, BUKAN ditulis
 * mentah di mcp.config.json / .mcp.json plugin — konsisten dengan
 * konvensi EMORA yang lain (semua kredensial provider AI juga di .env).
 */
function interpolateEnv(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? "");
}

function interpolateObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = interpolateEnv(v);
  return out;
}

/**
 * Normalisasi 1 entry `.mcp.json` (format Claude Code: key = nama server,
 * value = { command, args, env } untuk stdio ATAU { url, headers, type }
 * untuk http) menjadi bentuk internal EMORA `{ name, type, ... }`.
 */
function normalizeMcpJsonEntry(name, def) {
  if (def.url || def.type === "http" || def.type === "streamable-http") {
    return { name, type: "http", url: def.url, headers: def.headers || {}, insecureTLS: !!def.insecureTLS };
  }
  return { name, type: "stdio", command: def.command, args: def.args || [], env: def.env || {}, cwd: def.cwd };
}

/**
 * Dipanggil dari core/pluginManager.js saat sebuah plugin punya `.mcp.json`
 * atau field `mcpServers` di manifest-nya. `mcpServersObj` formatnya persis
 * seperti isi `.mcp.json` Claude Code: `{ "<namaServer>": { ...def } }`.
 * Return jumlah server yang berhasil didaftarkan.
 */
export function registerPendingMcpServers(pluginId, mcpServersObj) {
  let count = 0;
  for (const [name, def] of Object.entries(mcpServersObj || {})) {
    const prefixedName = `${pluginId}_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    pendingPluginServers.push({ ...normalizeMcpJsonEntry(prefixedName, def), _fromPlugin: pluginId });
    count++;
  }
  return count;
}

// ─────────────────────────────────────────────
// JSON Schema (MCP inputSchema) → Zod
// ─────────────────────────────────────────────
function jsonSchemaToZod(schema) {
  if (!schema || schema.type !== "object" || !schema.properties) {
    return z.object({}).passthrough();
  }

  const shape    = {};
  const required = new Set(schema.required || []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    let field;

    if (Array.isArray(prop.enum)) {
      field = z.enum(prop.enum);
    } else {
      switch (prop.type) {
        case "string":  field = z.string(); break;
        case "number":  field = z.number(); break;
        case "integer": field = z.number().int(); break;
        case "boolean": field = z.boolean(); break;
        case "array":   field = z.array(z.any()); break;
        case "object":  field = z.record(z.any()); break;
        default:        field = z.any();
      }
    }

    if (prop.description) field = field.describe(String(prop.description));
    if (!required.has(key)) field = field.optional();

    shape[key] = field;
  }

  return z.object(shape);
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { servers: [] };
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { servers: [] };
  }
}

/**
 * Nyalakan semua MCP server yang dikonfigurasi & enabled — dari
 * mcp.config.json (stdio ATAU http) DAN dari plugin yang menitipkan
 * `.mcp.json` (lihat registerPendingMcpServers) — lalu kembalikan array
 * DynamicStructuredTool siap pakai.
 *
 * Dipanggil sekali saat startup dari core/tools.js (top-level await),
 * SETELAH pluginManager.loadAllPlugins() supaya server titipan plugin
 * ikut kebaca.
 */
export async function loadMCPTools({ verbose = true } = {}) {
  const cfg = readConfig();
  const configServers = (cfg.servers || []).filter(
    (s) => (s.type === "stdio" || s.type === "http") && s.enabled !== false
  );
  const servers = [...configServers, ...pendingPluginServers];

  if (!servers.length) return [];

  const dynamicTools = [];

  for (const srv of servers) {
    try {
      const client =
        srv.type === "http"
          ? createMCPHttpClient({
              url: interpolateEnv(srv.url),
              headers: interpolateObject(srv.headers || {}),
              insecureTLS: !!srv.insecureTLS,
            })
          : createMCPClient({
              command: srv.command,
              args: srv.args || [],
              env: interpolateObject(srv.env || {}),
              cwd: srv.cwd,
            });

      await client.initialize();
      const remoteTools = await client.listTools();
      activeClients.push(client);

      for (const rt of remoteTools) {
        const toolName = `mcp_${srv.name}__${rt.name}`.replace(/[^a-zA-Z0-9_]/g, "_");

        dynamicTools.push(
          new DynamicStructuredTool({
            name: toolName,
            description: `[MCP:${srv.name}] ${rt.description || rt.name}`.slice(0, 1024),
            schema: jsonSchemaToZod(rt.inputSchema),
            func: async (args) => {
              try {
                return await client.callTool(rt.name, args);
              } catch (err) {
                return `❌ MCP "${srv.name}.${rt.name}" error: ${err.message}`;
              }
            },
          })
        );
      }

      if (verbose) {
        console.log(
          `  ✓ MCP server "${srv.name}" (${srv.type}) tersambung — ${remoteTools.length} tool dimuat` +
          (srv._fromPlugin ? ` [dari plugin: ${srv._fromPlugin}]` : "")
        );
      }
    } catch (err) {
      if (verbose) {
        console.error(`  ✗ Gagal connect MCP server "${srv.name}" (${srv.type}): ${err.message}`);
      }
    }
  }

  return dynamicTools;
}

/** Tutup semua child process MCP server. Panggil saat EMORA exit. */
export function closeMCPClients() {
  for (const c of activeClients) {
    try { c.close(); } catch {}
  }
  activeClients.length = 0;
}
