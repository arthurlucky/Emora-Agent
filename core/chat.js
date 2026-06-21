import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';

import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import {
  loadSession,
  saveSession,
} from "./memory.js";

import { recordToolSequence, SKILL_THRESHOLD } from "../utils/patternTracker.js";

// ==========================================
// FIX: Resolve paths relative to this file's location
// ==========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let cachedSystemPrompt = null;

// Dipanggil oleh Web UI setelah AGENT.md / SOUL.md disimpan, supaya
// system prompt yang sedang di-cache di memori langsung ke-refresh
// tanpa perlu restart proses EMORA.
export function invalidateSystemPromptCache() {
  cachedSystemPrompt = null;
}

async function getSystemPrompt() {
  if (cachedSystemPrompt) {
    return cachedSystemPrompt;
  }

  try {
    const name = process.env.NAME || "Emora";
    const soulPath = path.join(ROOT_DIR, 'SOUL.md');
    const agentPath = path.join(ROOT_DIR, 'AGENT.md');
    
    const soul = await fs.readFile(soulPath, "utf8");
    const agent = await fs.readFile(agentPath, "utf8");
    
    const Context = `
 user identity
 name: ${name}

 ${soul}

 ${agent}
 `;

    cachedSystemPrompt = Context;
    return cachedSystemPrompt;
  } catch (err) {
    console.error(`[CHAT ERROR] Failed to load system prompt: ${err.message}`);
    console.error(`[CHAT ERROR] Looking for SOUL.md and AGENT.md in: ${ROOT_DIR}`);
    
    // Fallback prompt if files not found
    const name = process.env.NAME || "Emora";
    cachedSystemPrompt = `
 user identity
 name: ${name}

 You are ${name}, an AI assistant.
 `;
    return cachedSystemPrompt;
  }
}

// ==========================================
// PERF #2: Context window.
// Sebelumnya SELURUH riwayat sesi (bisa ratusan pesan) dikirim ulang ke
// LLM di SETIAP turn. Itu bikin prompt makin gemuk makin lama sesi
// berjalan -> makin lambat & makin mahal, padahal model jarang butuh
// detail dari ratusan pesan ke belakang. Memory mentah di disk TETAP
// utuh (lihat memory.js) — yang dipangkas hanya potongan yang dikirim
// ke LLM untuk membentuk jawaban saat ini.
// ==========================================
const MAX_CONTEXT_MESSAGES = 24; // ~12 pertukaran user/assistant terakhir

function memoryToMessages(memory) {
  const windowed = memory.slice(-MAX_CONTEXT_MESSAGES);

  return windowed
    .map((msg) => {
      switch (msg.role) {
        case "user":
          return new HumanMessage(msg.content);
        case "assistant":
          return new AIMessage(msg.content);
        default:
          return null;
      }
    })
    .filter(Boolean);
}

async function executeTool(toolCall, tools) {
  const tool = tools.find((t) => t.name === toolCall.name);

  if (!tool) {
    return new ToolMessage({
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        success: false,
        error: `Tool '${toolCall.name}' tidak ditemukan`,
      }),
    });
  }

  try {
    const result = await tool.invoke(toolCall.args);
    return new ToolMessage({
      tool_call_id: toolCall.id,
      content: typeof result === "string" ? result : JSON.stringify(result, null, 2),
    });
  } catch (err) {
    return new ToolMessage({
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        success: false,
        error: err.message,
      }),
    });
  }
}

async function invokeWithRetry(llm, messages, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await llm.invoke(messages);
    } catch (err) {
      attempt++;
      const isToolError = err?.status === 400 || err?.code === 'tool_use_failed';

      if (isToolError && attempt < maxRetries) {
        console.warn(`\n[LLM WARNING] Malformed tool call detected. Retrying... (Attempt ${attempt}/${maxRetries})`);
        continue;
      }

      throw err;
    }
  }
}

export async function ask(llm, tools, sessionId, input) {
  const systemPrompt = await getSystemPrompt();
  const memory = await loadSession(sessionId);

  const messages = [
    new SystemMessage(systemPrompt + `\n\n[INFO SYSTEM]\nSession ID aktif user ini adalah: ${sessionId}`),
    ...memoryToMessages(memory),
    new HumanMessage(input),
  ];

  let response;

  try {
    response = await invokeWithRetry(llm, messages);
  } catch (err) {
    console.error("\n[LLM ERROR]");
    console.dir(err, { depth: null });
    throw err;
  }

  // ==========================================
  // SKILL FACTORY: Lacak semua tool yang dipanggil di turn ini
  // ==========================================
  const toolsUsedThisTurn = [];

  while (response?.tool_calls?.length) {
    messages.push(response);

    for (const toolCall of response.tool_calls) {
      if (toolCall.name !== "skill_factory") {
        toolsUsedThisTurn.push(toolCall.name);
      }

      const toolResult = await executeTool(toolCall, tools);
      messages.push(toolResult);
    }

    try {
      response = await invokeWithRetry(llm, messages);
    } catch (err) {
      console.error("\n[LLM ERROR DURING TOOL RESPONSE]");
      console.dir(err, { depth: null });
      throw err;
    }
  }

  // ==========================================
  // SKILL FACTORY: Cek pola & inject notifikasi jika threshold tercapai
  // ==========================================
  let finalContent = response.content;

  if (toolsUsedThisTurn.length >= 2) {
    try {
      const triggered = await recordToolSequence(sessionId, toolsUsedThisTurn);
      if (triggered) {
        const sequenceDisplay = triggered.pattern.sequence.join(" → ");
        finalContent +=
          `\n\n---\n` +
          `💡 **[SKILL FACTORY]** Gw nyadar lo udah pake workflow \`${sequenceDisplay}\` sebanyak **${triggered.pattern.count}x**. ` +
          `Gw bisa otomatis buatin skill dari pola ini supaya bisa dipake lagi atau dijadwalin. ` +
          `Ketik **"buat skill untuk pola ini"** kalau mau, atau **"lihat pola terdeteksi"** buat cek semua pola yang ada.`;
      }
    } catch (e) {
      // Pattern tracking gagal jangan sampai ganggu response utama
    }
  }

  memory.push({
    role: "user",
    content: input,
    timestamp: Date.now(),
  });

  memory.push({
    role: "assistant",
    content: finalContent,
    timestamp: Date.now(),
  });

  await saveSession(sessionId, memory);

  return finalContent;
}
