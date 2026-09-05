/**
 * core/chatWithTitleGen.js
 *
 * Wrapper untuk ask() yang otomatis generate judul conversation
 * menggunakan sub-agent saat pesan pertama di session baru.
 */

import { generateTitle } from "../tools/title_generator.js";
import { touchSession } from "./sessionStore.js";

export async function askWithTitleGen(llm, tools, sessionId, userPrompt, options = {}) {
  const { ask } = await import("./chat.js");
  const { loadSession } = await import("./memory.js");
  
  // Check if this is first message in session
  const messages = await loadSession(sessionId);
  const isFirstMessage = messages.length === 0;

  // Call original ask function
  const result = await ask(llm, tools, sessionId, userPrompt, options);

  // Generate title for first message (in background, non-blocking)
  if (isFirstMessage && userPrompt && userPrompt.trim().length > 3) {
    // Fire-and-forget: generate title in background
    generateTitle(userPrompt).then((title) => {
      if (title) {
        touchSession(sessionId, userPrompt);
      }
    }).catch((err) => {
      console.error('[chatWithTitleGen] Error generating title:', err.message);
    });
  }

  return result;
}

export default askWithTitleGen;
