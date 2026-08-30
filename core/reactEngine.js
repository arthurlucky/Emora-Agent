/**
 * core/reactEngine.js
 *
 * ReAct (Reasoning + Acting) Fallback Engine untuk EMORA Agent.
 *
 * Mengaktifkan penggunaan tool berbasis prompt (text-based tool calling) ketika
 * model LLM (misalnya model Ollama lokal / custom GGUF / model 0.1B-0.5B)
 * TIDAK MENDUKUNG native API tool-calling (`tools` parameter di OpenAI format).
 *
 * Format ReAct yang dikenali:
 *   THOUGHT: <alasan/pemikiran agen>
 *   ACTION: <nama_tool>
 *   ARGS: <JSON_arguments>
 *
 * Hasil eksekusi dikembalikan ke LLM sebagai:
 *   OBSERVATION: <hasil_eksekusi_tool>
 */

import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Format petunjuk ReAct & skema daftar tool ke bentuk teks prompt.
 *
 * @param {Array} tools - Array LangChain tools
 * @returns {string} Text prompt ReAct
 */
export function buildReActPrompt(tools = []) {
  if (!tools || !tools.length) return "";

  const toolLines = tools.map((t) => {
    let schemaStr = "";
    try {
      if (t.schema && typeof t.schema === "object") {
        schemaStr = JSON.stringify(t.schema.shape || t.schema);
      }
    } catch {
      schemaStr = "{}";
    }
    return `• ${t.name}: ${t.description || "Tanpa deskripsi"}${schemaStr ? ` | Schema: ${schemaStr}` : ""}`;
  });

  return `
[REACT TOOL CALLING MODE — AKTIF]
Model Anda berjalan dalam mode ReAct karena native tool-calling API tidak tersedia.
Anda TETAP BISA menggunakan semua alat (tools) di bawah ini dengan mengetik format berikut di dalam balasan Anda:

FORMAT PANGGILAN TOOL:
THOUGHT: <jelaskan alasan Anda memilih tool ini>
ACTION: <nama_tool>
ARGS: <JSON object argumen valid, contoh: {"path": "file.txt"}>

DAFTAR TOOL TERSEDIA:
${toolLines.join("\n")}

ATURAN REACT:
1. Jika butuh data/file/eksekusi, tulis THOUGHT, ACTION, dan ARGS. HANYA PANGGIL SATU TOOL PER TURN.
2. Setelah Anda mengirim ACTION & ARGS, sistem akan menjalankan tool dan mengembalikan OBSERVATION.
3. Setelah menerima OBSERVATION, analisis hasilnya lalu berikan jawaban akhir ke user (tanpa ACTION/ARGS lagi).
`;
}

/**
 * Parse output teks dari model untuk menemukan THOUGHT, ACTION, dan ARGS.
 *
 * @param {string} text Output teks dari model LLM
 * @returns {{ hasAction: boolean, thought: string, actionName: string, args: object, rawText: string }}
 */
export function parseReActOutput(text = "") {
  if (typeof text !== "string") text = String(text ?? "");

  const actionMatch = text.match(/ACTION:\s*([a-zA-Z0-9_-]+)/i);
  if (!actionMatch) {
    return { hasAction: false, rawText: text };
  }

  const actionName = actionMatch[1].trim();
  const thoughtMatch = text.match(/THOUGHT:\s*([\s\S]*?)(?=ACTION:|$)/i);
  const thought = thoughtMatch ? thoughtMatch[1].trim() : "";

  // Ambil teks setelah ARGS:
  let args = {};
  const argsMatch = text.match(/ARGS:\s*([\s\S]*?)$/i);
  if (argsMatch) {
    const rawArgs = argsMatch[1].trim();
    // Cari blok JSON di rawArgs (misal {...})
    const jsonMatch = rawArgs.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        args = JSON.parse(jsonMatch[0]);
      } catch {
        // Fallback jika JSON kurang rapi
        args = { input: jsonMatch[0] };
      }
    }
  }

  return {
    hasAction: true,
    thought,
    actionName,
    args,
    rawText: text,
  };
}

/**
 * Jalankan ReAct Loop untuk mengeksekusi tool berbasis teks.
 *
 * @param {object} params
 * @param {object} params.llm - Plain LLM instance (tanpa native tools bound)
 * @param {Array} params.messages - LangChain messages array
 * @param {Array} params.tools - LangChain tools array
 * @param {function} params.executeTool - Fungsi eksekusi tool (toolCall, tools, opts)
 * @param {function} [params.onEvent] - Event callback
 * @param {object} [params.signal] - AbortSignal
 * @param {number} [params.maxIterations=15] - Batas maksimal loop
 * @returns {Promise<string>} Output jawaban akhir
 */
export async function runReActLoop({
  llm,
  messages,
  tools,
  executeTool,
  onEvent,
  signal,
  maxIterations = 15,
}) {
  const workMessages = [...messages];

  // Sisipkan ReAct prompt ke SystemMessage (atau pesan baru)
  const reactInstructions = buildReActPrompt(tools);
  if (workMessages[0] && workMessages[0] instanceof SystemMessage) {
    workMessages[0] = new SystemMessage(workMessages[0].content + "\n\n" + reactInstructions);
  } else {
    workMessages.unshift(new SystemMessage(reactInstructions));
  }

  let iterations = 0;
  let finalText = "";

  while (iterations++ < maxIterations && !signal?.aborted) {
    const response = await llm.invoke(workMessages, { signal });
    const content = typeof response.content === "string"
      ? response.content
      : (response.content?.map?.((c) => c.text || "").join("") || String(response.content ?? ""));

    finalText = content;
    const parsed = parseReActOutput(content);

    if (!parsed.hasAction) {
      // Model sudah memberikan jawaban akhir tanpa memanggil tool
      break;
    }

    if (onEvent) onEvent({ type: "tool_use", name: parsed.actionName, args: parsed.args });

    // Format faux toolCall untuk dimakan oleh executeTool
    const fauxToolCall = {
      id: `react_${Date.now()}_${iterations}`,
      name: parsed.actionName,
      args: parsed.args,
    };

    workMessages.push(new AIMessage(content));

    const t0 = Date.now();
    const resultMessage = await executeTool(fauxToolCall, tools, { signal });
    if (onEvent) onEvent({ type: "tool_result", name: parsed.actionName, durationMs: Date.now() - t0 });

    const obsText = typeof resultMessage.content === "string"
      ? resultMessage.content
      : JSON.stringify(resultMessage.content);

    workMessages.push(new HumanMessage(`OBSERVATION:\n${obsText}`));
  }

  return finalText;
}

export default { buildReActPrompt, parseReActOutput, runReActLoop };
