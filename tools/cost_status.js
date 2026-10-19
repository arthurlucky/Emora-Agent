/**
 * tools/cost_status.js
 *
 * Tool baca-saja untuk menampilkan pemakaian token sesi ini + akumulasi
 * global — mirip `/cost` di Claude Code. Data diisi otomatis oleh
 * core/costTracker.js setiap kali LLM merespon (lihat core/chat.js).
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getSessionCost, getGlobalCost } from "../core/costTracker.js";

function formatRecord(rec) {
  if (!rec.calls) return "(belum ada data — provider ini mungkin tidak melaporkan token usage)";
  const modelLines = Object.entries(rec.byModel)
    .map(([m, t]) => `    - ${m}: ${t.toLocaleString("id-ID")} token`)
    .join("\n");
  return (
    `  Total token   : ${rec.totalTokens.toLocaleString("id-ID")} (in: ${rec.inputTokens.toLocaleString("id-ID")}, out: ${rec.outputTokens.toLocaleString("id-ID")})\n` +
    `  Jumlah call   : ${rec.calls}\n` +
    `  Per model     :\n${modelLines || "    (tidak diketahui)"}\n` +
    `  Update terakhir: ${rec.updatedAt || "-"}`
  );
}

export const costStatusTool = new DynamicStructuredTool({
  name: "cost_status",
  description:
    "Tampilkan pemakaian token LLM untuk sesi saat ini DAN akumulasi seluruh sesi (global) sejak instalasi. Pakai ini kalau user tanya 'sudah berapa token/biaya yang kepakai', 'cost saya berapa', dsb.",
  schema: z.object({}),
  func: async (_args, config) => {
    const sessionId = config?.configurable?.sessionId || process.env.EMORA_SESSION_ID || "_default";
    const [session, global_] = await Promise.all([getSessionCost(sessionId), getGlobalCost()]);
    return (
      `📊 Pemakaian token — sesi ini:\n${formatRecord(session)}\n\n` +
      `🌐 Pemakaian token — akumulasi global (semua sesi):\n${formatRecord(global_)}`
    );
  },
});

export default costStatusTool;
