/**
 * core/costTracker.js
 *
 * Pelacak token usage per-sesi & global — SEBELUMNYA tidak ada sama sekali
 * (lihat CHANGELOG.md). EMORA mendukung banyak provider berbayar (OpenAI,
 * Anthropic, OpenRouter, dll) tapi user tidak punya cara mengetahui sudah
 * berapa banyak token/biaya terpakai dalam satu sesi maupun total — mirip
 * `/cost` di Claude Code.
 *
 * SENGAJA RINGAN: cuma menjumlahkan token in/out yang sudah dilaporkan
 * provider di response (usage_metadata / response_metadata.tokenUsage),
 * BUKAN kalkulasi biaya dalam uang (harga per-token beda-beda per provider
 * & berubah dari waktu ke waktu — kalau nanti mau ditambah, taruh tabel
 * harga di sini per provider/model dan kalikan di getSessionCost()).
 *
 * Disimpan di .emora/cost/<sessionId>.json (per sesi) + .emora/cost/_global.json
 * (akumulasi semua sesi, umur hidup instalasi).
 */
import fs from "fs/promises";
import path from "path";

const COST_ROOT = ".emora/cost";
const GLOBAL_FILE = path.join(COST_ROOT, "_global.json");

function sessionFile(sessionId) {
  return path.join(COST_ROOT, `${sessionId || "_default"}.json`);
}

function emptyRecord() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, byModel: {}, updatedAt: null };
}

async function readJson(fp) {
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(fp, data) {
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(data, null, 2));
}

/**
 * Ekstrak angka token dari response LLM (LangChain AIMessage), mendukung
 * beberapa bentuk yang dipakai provider berbeda — pola ini sudah dipakai
 * parsial di tools/subagent.js, di sini disatukan & dilengkapi input/output
 * terpisah (bukan cuma total).
 */
export function extractUsage(response) {
  const um = response?.usage_metadata;
  if (um) {
    return {
      inputTokens: um.input_tokens ?? 0,
      outputTokens: um.output_tokens ?? 0,
      totalTokens: um.total_tokens ?? (um.input_tokens ?? 0) + (um.output_tokens ?? 0),
    };
  }
  const tu = response?.response_metadata?.tokenUsage;
  if (tu) {
    return {
      inputTokens: tu.promptTokens ?? 0,
      outputTokens: tu.completionTokens ?? 0,
      totalTokens: tu.totalTokens ?? (tu.promptTokens ?? 0) + (tu.completionTokens ?? 0),
    };
  }
  return null;
}

async function addUsageTo(fp, usage, model) {
  const rec = (await readJson(fp)) || emptyRecord();
  rec.inputTokens += usage.inputTokens || 0;
  rec.outputTokens += usage.outputTokens || 0;
  rec.totalTokens += usage.totalTokens || 0;
  rec.calls += 1;
  if (model) {
    rec.byModel[model] = (rec.byModel[model] || 0) + (usage.totalTokens || 0);
  }
  rec.updatedAt = new Date().toISOString();
  await writeJson(fp, rec);
  return rec;
}

/**
 * Catat 1 kali pemanggilan LLM. Fire-and-forget dari core/chat.js —
 * dibungkus try/catch di sisi caller supaya kegagalan tracker TIDAK PERNAH
 * mengganggu alur chat utama.
 */
export async function recordUsage(sessionId, response, model) {
  const usage = extractUsage(response);
  if (!usage) return null; // provider tidak melaporkan usage sama sekali -> tidak ada yang dicatat
  await addUsageTo(sessionFile(sessionId), usage, model);
  await addUsageTo(GLOBAL_FILE, usage, model);
  return usage;
}

export async function getSessionCost(sessionId) {
  return (await readJson(sessionFile(sessionId))) || emptyRecord();
}

export async function getGlobalCost() {
  return (await readJson(GLOBAL_FILE)) || emptyRecord();
}
