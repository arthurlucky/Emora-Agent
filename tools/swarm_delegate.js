// tools/swarm_delegate.js
// Delegasi tugas ke swarm container (subagent persistent dengan SOUL/AGENT.md
// dan memory sendiri). Beda dengan tools/subagent.js (in-memory, sekali pakai):
// swarm container dibuat via `emora swarm create` dan konfigurasinya persisten.
//
// Nama tool: delegate_to_swarm (dulu "delegate_to_subagent" — bentrok dengan
// tools/subagent.js yang menyebabkan satu nama dua tool di registry).

import path from "path";
import { fileURLToPath } from "url";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createLLM } from "../provider/index.js";
import { ask, invalidateSystemPromptCache } from "../core/chat.js";
import { getContainerConfig } from "../swarm/manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const CONTAINERS_DIR = path.join(ROOT_DIR, ".emora", "containers");

// Mutex: env global di-override saat delegasi — dua delegasi concurrent
// akan saling timpa env. Antrekan sequential (satu per satu).
let _swarmQueue = Promise.resolve();
function enqueueSwarm(fn) {
  const run = _swarmQueue.then(fn, fn); // lanjut walau sebelumnya error
  _swarmQueue = run.catch(() => {});
  return run;
}

export const swarmDelegateTool = new DynamicStructuredTool({
  name: "delegate_to_swarm",
  description:
    "Delegasikan tugas ke swarm container (subagent PERSISTEN dengan SOUL/AGENT.md, memory, " +
    "dan model sendiri — dibuat via `emora swarm create <nama>`). Beda dengan delegate_to_subagent " +
    "(in-memory sekali pakai): gunakan ini kalau butuh kepribadian/konteks yang konsisten antar panggilan.",
  schema: z.object({
    subagentId: z.string().describe("Nama/ID container (mis. agent-sales, bot-riset). Lihat `emora swarm list`."),
    task: z.string().describe("Instruksi/tugas spesifik untuk container."),
  }),
  func: async ({ subagentId, task }) => {
    // Mutex: env global di-override saat delegasi — antrekan sequential.
    return enqueueSwarm(() => runDelegate(subagentId, task));
  },
});

async function runDelegate(subagentId, task) {
    try {
      const dir = path.join(CONTAINERS_DIR, subagentId);
      const config = await getContainerConfig(subagentId);

      const envOverride = {
        EMORA_MEMORY_DIR: path.join(dir, "memory"),
        EMORA_AGENT_PATH: path.join(dir, "AGENT.md"),
        EMORA_SOUL_PATH: path.join(dir, "SOUL.md"),
        NAME: `Emora-${subagentId}`,
      };

      if (config.model_provider) envOverride.MODEL_PROVIDER = config.model_provider;
      if (config.model_name) envOverride.MODEL_NAME = config.model_name;
      if (config.model_url) envOverride.MODEL_URL = config.model_url;
      if (config.model_api) envOverride.MODEL_API = config.model_api;

      const opts = {
        apiKey: config.model_api || undefined,
        model: config.model_name,
        url: config.model_url,
      };

      // Tools kosong untuk mencegah infinite recursion.
      // Pass the explicit provider and opts from config.
      const providerKey = config.model_provider || process.env.MODEL_PROVIDER;
      const subagentLLM = await createLLM([], providerKey, opts);
      const sessionId = `swarm_${subagentId}`;

      const result = await ask(subagentLLM, [], sessionId, task, { envOverride });
      return `✅ Swarm "${subagentId}" selesai:\n\n${result}`;
    } catch (err) {
      return `❌ Swarm delegate gagal: ${err.message}`;
    }
}

export default swarmDelegateTool;
