/**
 * cli/cmd-model.js — `emora model`
 * Ganti model/provider aktif secara interaktif, tanpa harus masuk ke setup penuh.
 */

import "dotenv/config";
import fs from "fs";
import ora from "ora";
import { select, input, sectionHeader, sectionFooter, infoLine, successLine, warnLine } from "./select.js";
import { PROVIDERS } from "../provider/index.js";

const ENV_PATH = "./.env";
function getEnv(k) { const m = (fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH,"utf8") : "").match(new RegExp(`^${k}=(.*)$`,"m")); return m?m[1].trim():""; }
function setEnv(k,v) { let c=fs.existsSync(ENV_PATH)?fs.readFileSync(ENV_PATH,"utf8"):""; const re=new RegExp(`^${k}=.*$`,"m"); c=re.test(c)?c.replace(re,`${k}=${v}`):c+(c.endsWith("\n")||c===""?"":"\n")+`${k}=${v}`; fs.writeFileSync(ENV_PATH,c.trim()+"\n"); }

const PROVIDER_MODELS = {
  groq: [
    { label: "llama-3.3-70b-versatile   [Default — terbaik buat agent]", value: "llama-3.3-70b-versatile" },
    { label: "llama-3.1-8b-instant      [Tercepat]",                      value: "llama-3.1-8b-instant"    },
    { label: "gemma2-9b-it              [Google model]",                   value: "gemma2-9b-it"            },
    { label: "mixtral-8x7b-32768        [Konteks panjang]",               value: "mixtral-8x7b-32768"      },
  ],
  gemini: [
    { label: "gemini-2.0-flash          [Recommended]",  value: "gemini-2.0-flash"      },
    { label: "gemini-1.5-pro            [Konteks panjang]", value: "gemini-1.5-pro"      },
    { label: "gemini-1.5-flash          [Cepat & hemat]", value: "gemini-1.5-flash"     },
  ],
  openrouter: [
    { label: "google/gemini-2.0-flash-exp:free  [Gratis]",               value: "google/gemini-2.0-flash-exp:free"  },
    { label: "meta-llama/llama-3.3-70b-instruct:free [Gratis]",          value: "meta-llama/llama-3.3-70b-instruct:free" },
    { label: "deepseek/deepseek-r1:free          [Gratis, reasoning]",   value: "deepseek/deepseek-r1:free"         },
    { label: "Custom (ketik sendiri)",                                     value: "__custom__"                        },
  ],
  openai: [
    { label: "gpt-4o-mini  [Recommended — hemat]", value: "gpt-4o-mini"  },
    { label: "gpt-4o       [Terbaik]",             value: "gpt-4o"       },
    { label: "gpt-4-turbo  [Konteks panjang]",     value: "gpt-4-turbo"  },
  ],
  anthropic: [
    { label: "claude-sonnet-4-5          [Recommended]",       value: "claude-sonnet-4-5"          },
    { label: "claude-haiku-4-5           [Tercepat & murah]",  value: "claude-haiku-4-5"           },
    { label: "claude-opus-4-5            [Paling cerdas]",     value: "claude-opus-4-5"            },
    { label: "claude-3-5-sonnet-20241022 [Stable]",            value: "claude-3-5-sonnet-20241022" },
  ],
  nvidia: [
    { label: "meta/llama-3.1-70b-instruct [Default]",  value: "meta/llama-3.1-70b-instruct" },
    { label: "meta/llama-3.1-8b-instruct  [Kecil]",   value: "meta/llama-3.1-8b-instruct"  },
    { label: "mistralai/mistral-7b-instruct-v0.3",     value: "mistralai/mistral-7b-instruct-v0.3" },
  ],
  huggingface: [
    { label: "meta-llama/Meta-Llama-3.1-8B-Instruct  [Gratis]", value: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
    { label: "mistralai/Mistral-7B-Instruct-v0.3     [Gratis]", value: "mistralai/Mistral-7B-Instruct-v0.3"    },
    { label: "Qwen/Qwen2.5-72B-Instruct              [Pro]",    value: "Qwen/Qwen2.5-72B-Instruct"            },
    { label: "Custom (ketik sendiri)",                           value: "__custom__"                            },
  ],
  ollama: null, // auto-scan
};

export async function cmdModel() {
  const curProvider = getEnv("MODEL_PROVIDER") || "ollama";
  const curModel    = getEnv("MODEL_NAME") || "—";

  sectionHeader("MODEL SELECTOR", `Provider aktif: ${curProvider}  /  Model: ${curModel}`);

  // Pilih provider dulu
  const providerChoices = Object.entries(PROVIDERS).map(([key, meta]) => ({
    label: `${meta.label.padEnd(24)} [${meta.tier.toUpperCase()}]`,
    value: key,
  }));

  const newProvider = await select("Pilih provider:", providerChoices,
    { default: providerChoices.findIndex(c => c.value === curProvider) || 0 }
  );

  setEnv("MODEL_PROVIDER", newProvider);

  // Pilih model
  if (newProvider === "ollama") {
    const host = getEnv("MODEL_URL")?.replace("/v1","") || "http://localhost:11434";
    const spin = ora("  Scanning Ollama...").start();
    try {
      const res  = await fetch(`${host}/api/tags`);
      const data = await res.json();
      const models = (data.models||[]).map(m=>m.name);
      if (models.length) {
        spin.succeed(`Ditemukan ${models.length} model`);
        const m = await select("Pilih model:", models.map(m=>({label:m,value:m})));
        setEnv("MODEL_NAME", m);
      } else {
        spin.warn("Tidak ada model. Input manual.");
        setEnv("MODEL_NAME", await input("Nama model:", "llama3.2:3b"));
      }
    } catch {
      spin.fail("Ollama tidak bisa dijangkau.");
      setEnv("MODEL_NAME", await input("Nama model:", "llama3.2:3b"));
    }
  } else {
    const modelChoices = PROVIDER_MODELS[newProvider];
    if (modelChoices) {
      let chosen = await select("Pilih model:", modelChoices);
      if (chosen === "__custom__") {
        chosen = await input("Masukkan nama model:");
      }
      setEnv("MODEL_NAME", chosen);
    } else {
      setEnv("MODEL_NAME", await input("Masukkan nama model:"));
    }
  }

  successLine(`Provider: ${newProvider}  →  Model: ${getEnv("MODEL_NAME")}`);
  sectionFooter();
}
