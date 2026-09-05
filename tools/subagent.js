/**
 * tools/subagent.js
 *
 * Universal sub-agent delegation tool.
 * Spawn isolated agent dengan konteks terbatas untuk tugas spesifik:
 * - Research & analysis
 * - Code review
 * - Content generation
 * - Data processing
 * 
 * Subagent ini murni "brain-in-a-vat" (tidak memiliki akses ke tools apapun)
 * untuk mencegah infinite recursion. Pastikan semua data yang dibutuhkan
 * dikirimkan ke dalam `task` atau `context`.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLLM } from "../provider/index.js";
import { SystemMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

async function delegateToSubagent({ task, context = "", maxTokens = 4000, timeout = 300_000, allowedTools = [] }) {
  try {
    let subagentTools = [];
    if (allowedTools && allowedTools.length > 0) {
      const toolsMod = await import("../core/tools.js");
      const allTools = toolsMod.default || [];
      // Mencegah rekursi subagent memanggil subagent lagi
      subagentTools = allTools.filter(t => allowedTools.includes(t.name) && t.name !== "delegate_to_subagent");
    }

    // Create isolated LLM
    const llm = await createLLM(subagentTools, null, { maxTokens });

    const systemPrompt = `Kamu adalah sub-agent spesialis yang diutus untuk menyelesaikan tugas.
${subagentTools.length > 0 
  ? `Kamu HANYA memiliki akses ke alat (tools) berikut: ${subagentTools.map(t => t.name).join(", ")}. Gunakan alat tersebut dengan bijak.` 
  : `Kamu murni TERISOLASI (brain-in-a-vat) dan TIDAK memiliki akses ke tools (tidak bisa membaca file, tidak bisa mengeksekusi script, tidak bisa search web).`
}

ATURAN UTAMA:
- Selesaikan tugas HANYA berdasarkan instruksi dan konteks yang diberikan di bawah.
- Jangan pernah menyuruh user atau main agent untuk memberikan akses atau menjalankan command jika kamu tidak punya toolsnya.
- Jika ada informasi yang kurang, buat asumsi yang masuk akal dan cantumkan asumsi tersebut.
- Berikan hasil yang sudah final, lengkap, dan dapat langsung digunakan oleh main agent.
- Langsung ke poin permasalahan, tidak perlu basa-basi.

${context ? `KONTEKS TAMBAHAN:\n${context}\n` : ""}
TUGAS KAMU:`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(task)
    ];

    let response;
    let tokensUsed = 0;
    const maxKicks = 15;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      for (let i = 0; i < maxKicks; i++) {
        if (controller.signal.aborted) throw new Error("Timeout: Sub-agent memakan waktu terlalu lama.");

        response = await llm.invoke(messages, { signal: controller.signal });

        if (response?.usage_metadata?.total_tokens) {
          tokensUsed = response.usage_metadata.total_tokens;
        } else if (response?.response_metadata?.tokenUsage?.totalTokens) {
          tokensUsed = response.response_metadata.tokenUsage.totalTokens;
        }

        messages.push(response);

        if (!response.tool_calls || response.tool_calls.length === 0) {
          break; // Selesai, tidak ada alat yang dipanggil
        }

        // Eksekusi alat secara lokal
        for (const tc of response.tool_calls) {
          const toolInstance = subagentTools.find(t => t.name === tc.name);
          if (!toolInstance) {
            messages.push(new ToolMessage({ tool_call_id: tc.id, content: `Error: Tool ${tc.name} tidak ditemukan.` }));
            continue;
          }
          try {
            const result = await toolInstance.invoke(tc.args, { signal: controller.signal });
            messages.push(new ToolMessage({ tool_call_id: tc.id, content: typeof result === 'string' ? result : JSON.stringify(result) }));
          } catch (err) {
            messages.push(new ToolMessage({ tool_call_id: tc.id, content: `Error: ${err.message}` }));
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    let result = '';
    // Ambil pesan terakhir (yang berupa teks akhir)
    const finalMsg = messages[messages.length - 1];
    if (finalMsg?.content != null) {
      result = typeof finalMsg.content === 'string' ? finalMsg.content : JSON.stringify(finalMsg.content);
    } else {
      result = String(finalMsg?.text || "");
    }

    if (tokensUsed === 0) {
      tokensUsed = Math.floor(result.split(/\s+/).length * 1.3);
    }

    return {
      success: true,
      result: result.trim(),
      tokensUsed
    };

  } catch (err) {
    return {
      success: false,
      error: err.name === "AbortError" ? "Timeout: Sub-agent memakan waktu terlalu lama." : err.message,
      stack: err.stack
    };
  }
}

// Subagent murni sebagai Internal Engine (bukan public tool)
export { delegateToSubagent };
