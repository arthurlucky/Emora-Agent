/**
 * core/recordsManager.js — EMORA RECORDS (Encrypted Personality Vault)
 *
 * Merekam dan mengelola profil kepribadian pengguna ke dalam vault terenkripsi (AES-256-GCM).
 *
 * 7 Dimensi Kepribadian yang Dilacak:
 * 1. Hobby (Hobi & Minat)
 * 2. WritingStyle (Gaya Menulis / Tone / Diksi)
 * 3. Dreams (Impian / Cita-cita / Target)
 * 4. Emotion (Karakter Emosi & Mood Triggers)
 * 5. LovedOnes (Orang yang Dicintai)
 * 6. TrustedPeople (Orang Terpercaya)
 * 7. Friends (Teman / Sahabat)
 *
 * Prinsip Wajib:
 * - Quality Control (QC) ketat (hanya simpan fakta berkeyakinan tinggi >= 0.8).
 * - Ekstraksi otomatis saat keluar dari sesi (Auto Record on Exit).
 * - Minimasi penggunaan LLM dengan Heuristic Regex Pre-Scanner.
 */

import crypto from "crypto";
import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import { getConfig, setConfig } from "./config.js";

const VAULT_FILE = ".emora/records.vault";
const HASH_FILE = ".emora/records_key.hash";

// 7 Dimensi Kepribadian
export const PERSONALITY_CATEGORIES = {
  hobby: "Hobby & Minat",
  writingStyle: "Gaya Menulis & Tone",
  dreams: "Impian & Cita-Cita",
  emotion: "Karakter Emosi & Mood",
  lovedOnes: "Orang yang Dicintai",
  trustedPeople: "Orang Terpercaya",
  friends: "Teman & Sahabat",
};

// ── Enkripsi Vault (AES-256-GCM + PBKDF2) ──────────────────────────────────

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
}

export function isVaultInitialized() {
  return fssync.existsSync(VAULT_FILE) && fssync.existsSync(HASH_FILE);
}

export function setMasterPassword(password) {
  if (!password || password.length < 4) {
    throw new Error("Password vault minimal 4 karakter.");
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  
  fssync.mkdirSync(".emora", { recursive: true });
  fssync.writeFileSync(HASH_FILE, JSON.stringify({ salt: salt.toString("hex"), hash }), "utf8");

  // Jika vault belum ada, inisialisasi vault kosong
  if (!fssync.existsSync(VAULT_FILE)) {
    saveVault(password, createEmptyRecordStore());
  }
}

export function verifyMasterPassword(password) {
  if (!fssync.existsSync(HASH_FILE)) return false;
  try {
    const { salt, hash } = JSON.parse(fssync.readFileSync(HASH_FILE, "utf8"));
    const testHash = crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex");
    return testHash === hash;
  } catch {
    return false;
  }
}

export function saveVault(password, recordsData) {
  if (!verifyMasterPassword(password)) {
    throw new Error("Password vault tidak valid.");
  }
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const serialized = JSON.stringify(recordsData);
  let encrypted = cipher.update(serialized, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  const vaultContent = JSON.stringify({
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag,
    data: encrypted,
    updatedAt: new Date().toISOString(),
  }, null, 2);

  fssync.mkdirSync(".emora", { recursive: true });
  fssync.writeFileSync(VAULT_FILE, vaultContent, "utf8");
}

export function loadVault(password) {
  if (!fssync.existsSync(VAULT_FILE)) {
    return createEmptyRecordStore();
  }
  if (!verifyMasterPassword(password)) {
    throw new Error("Password vault tidak valid.");
  }
  try {
    const { salt, iv, authTag, data } = JSON.parse(fssync.readFileSync(VAULT_FILE, "utf8"));
    const key = deriveKey(password, Buffer.from(salt, "hex"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    let decrypted = decipher.update(data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  } catch (e) {
    throw new Error(`Gagal membuka vault terenkripsi: ${e.message}`);
  }
}

function createEmptyRecordStore() {
  return {
    hobby: [],
    writingStyle: [],
    dreams: [],
    emotion: [],
    lovedOnes: [],
    trustedPeople: [],
    friends: [],
    lastUpdated: new Date().toISOString(),
  };
}

// ── Heuristic Pre-Scanner & Quality Control (Zero LLM Overhead when clean) ──

const HEURISTIC_PATTERNS = {
  hobby: /\b(hobi|suka|gemar|senang|hobbies|hobby|main|koleksi)\b/i,
  writingStyle: /\b(gaya|bahasa|singkatan|diksi|tone|karakter)\b/i,
  dreams: /\b(cita-cita|impian|target|tujuan|keinginan|ambisi|dream|goal|goals)\b/i,
  emotion: /\b(marah|sedih|senang|cemas|takut|kesal|benci|bahagia|kecewa|mood)\b/i,
  lovedOnes: /\b(sayang|cinta|keluarga|orang tua|pacar|istri|suami|anak|ibu|ayah)\b/i,
  trustedPeople: /\b(percaya|kepercayaan|orang terpercaya|andalan|mentor)\b/i,
  friends: /\b(teman|sahabat|kawan|bro|bestie|friend|friends)\b/i,
};

/** Pre-scan cepat pesan tanpa memanggil LLM */
export function hasPersonalitySignals(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const userText = messages
    .filter(m => m.role === "user" || m.sender === "user")
    .map(m => m.content || "")
    .join(" ");

  for (const pattern of Object.values(HEURISTIC_PATTERNS)) {
    if (pattern.test(userText)) return true;
  }
  return false;
}

/** Quality Control: Validasi fakta sebelum dimasukkan ke vault */
function applyQualityControl(factItem) {
  if (!factItem || !factItem.fact) return null;
  const cleanFact = String(factItem.fact).trim();
  if (cleanFact.length < 3 || cleanFact.length > 300) return null;

  // Filter kata-kata umum / bukan fakta kepribadian
  if (/^(halo|apa kabar|test|terima kasih|ok|iya|tidak)$/i.test(cleanFact)) return null;

  const confidence = typeof factItem.confidence === "number" ? factItem.confidence : 0.85;
  if (confidence < 0.8) return null; // Quality control Threshold

  return {
    fact: cleanFact,
    confidence,
    updatedAt: new Date().toISOString().split("T")[0],
  };
}

// ── Auto Record on Session Exit ───────────────────────────────────────────

export async function extractAndRecordSession(messages, password) {
  if (!password || !verifyMasterPassword(password)) return { success: false, reason: "No valid vault password" };
  if (!hasPersonalitySignals(messages)) return { success: true, extractedCount: 0, reason: "No signals detected (0 LLM overhead)" };

  const userMessages = messages
    .filter(m => (m.role === "user" || m.sender === "user") && m.content)
    .map(m => m.content)
    .slice(-15); // Ambil maksimal 15 pesan terakhir

  if (userMessages.length === 0) return { success: true, extractedCount: 0 };

  let store = loadVault(password);
  let newExtracted = 0;

  try {
    const { createLLM, detectProvider } = await import("../provider/index.js");
    const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");

    const llm = await createLLM([], detectProvider());

    const prompt =
      "Analisis percakapan pengguna berikut dan ekstrak fakta kepribadian pengguna HANYA jika ditemukan fakta berkeyakinan tinggi (confidence >= 0.8).\n" +
      "Kategori kepribadian:\n" +
      "1. hobby: Hobi & minat\n" +
      "2. writingStyle: Gaya/tone menulis\n" +
      "3. dreams: Impian/cita-cita\n" +
      "4. emotion: Karakter emosi/mood\n" +
      "5. lovedOnes: Orang yang dicintai\n" +
      "6. trustedPeople: Orang terpercaya\n" +
      "7. friends: Teman/sahabat\n\n" +
      "Respon Wajib dalam format JSON murni berikut (kosongkan array jika tidak ada fakta pasti):\n" +
      "{\n" +
      '  "hobby": [{"fact": "...", "confidence": 0.9}],\n' +
      '  "writingStyle": [],\n' +
      '  "dreams": [],\n' +
      '  "emotion": [],\n' +
      '  "lovedOnes": [],\n' +
      '  "trustedPeople": [],\n' +
      '  "friends": []\n' +
      "}\n\n" +
      `Pesan Pengguna:\n${userMessages.join("\n---\n")}`;

    const response = await llm.invoke([
      new SystemMessage("Kamu adalah Sistem Quality Control EMORA RECORDS. Ekstrak data kepribadian berkeyakinan tinggi dalam format JSON murni."),
      new HumanMessage(prompt),
    ]);

    const jsonText = response.content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonText);

    for (const [category, items] of Object.entries(parsed)) {
      if (Array.isArray(items) && store[category]) {
        for (const item of items) {
          const validated = applyQualityControl(item);
          if (validated) {
            // Cek duplikasi fakta
            const exists = store[category].some(existing => existing.fact.toLowerCase() === validated.fact.toLowerCase());
            if (!exists) {
              store[category].push(validated);
              newExtracted++;
            }
          }
        }
      }
    }

    if (newExtracted > 0) {
      store.lastUpdated = new Date().toISOString();
      saveVault(password, store);
    }

    return { success: true, extractedCount: newExtracted };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

export default {
  PERSONALITY_CATEGORIES,
  isVaultInitialized,
  setMasterPassword,
  verifyMasterPassword,
  saveVault,
  loadVault,
  hasPersonalitySignals,
  extractAndRecordSession,
};
