import "dotenv/config";
import express from "express";
import fs from "fs/promises";
import path from "path";

import { ChatOpenAI } from "@langchain/openai";
import tools from "../core/tools.js";
import { ask } from "../core/chat.js";
import { eventBus } from "../utils/eventBus.js";
import multer from "multer";
import { getPatterns, SKILL_THRESHOLD } from "../utils/patternTracker.js";
const upload = multer({ dest: 'temp/' });

// Route Upload

// Inisialisasi LLM khusus untuk Web UI
const llm = new ChatOpenAI({
  apiKey: process.env.MODEL_API || "ollama",
  model: process.env.MODEL_NAME,
  configuration: { baseURL: process.env.MODEL_URL },
  temperature: 0.2,
  maxTokens: 2048,
}).bindTools(tools, { toolChoice: "auto" });

const app = express();
const PORT = process.env.WEBUI_PORT || 5090;

app.set("view engine", "ejs");
app.set("views", path.resolve("./webui/views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Helper baca file aman
async function readFileSafe(filePath) {
  try { return await fs.readFile(path.resolve(filePath), "utf-8"); } 
  catch { return ""; }
}

// ---------------------------------------------------------
// ROUTES UTAMA
// ---------------------------------------------------------


app.post("/api/upload", upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Gagal upload" });
    const content = await fs.readFile(req.file.path, 'utf-8');
    await fs.unlink(req.file.path);
    res.json({ success: true, content, filename: req.file.originalname });
});



app.get("/", async (req, res) => {
  const agentPrompt = await readFileSafe("./AGENT.md");
  const soulPrompt = await readFileSafe("./SOUL.md");
  
  let sessions = [];
  try {
    const files = await fs.readdir(path.resolve("./sessions"));
    sessions = files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
  } catch (e) { /* Folder sesi mungkin belum ada */ }

  const toolsList = tools.map(t => ({ name: t.name, description: t.description }));

  res.render("index", { agentPrompt, soulPrompt, toolsList, sessions });
});

// ---------------------------------------------------------
// ROUTES PENGATURAN & DATA
// ---------------------------------------------------------
app.post("/save-prompts", async (req, res) => {
  const { agent, soul } = req.body;
  try {
    await fs.writeFile(path.resolve("./AGENT.md"), agent, "utf-8");
    await fs.writeFile(path.resolve("./SOUL.md"), soul, "utf-8");
    res.json({ success: true, message: "Konfigurasi berhasil disimpan!" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Load riwayat chat berdasarkan Sesi
app.get("/api/history/:sessionId", async (req, res) => {
  try {
    const data = await readFileSafe(`./sessions/${req.params.sessionId}.json`);
    res.json(JSON.parse(data || "[]"));
  } catch (e) {
    res.json([]);
  }
});

// ---------------------------------------------------------
// ROUTE CHAT INTERFACE
// ---------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: "Data tidak lengkap" });

  try {
    const reply = await ask(llm, tools, sessionId, message);
    res.json({ success: true, reply });
  } catch (e) {
    console.error("[WEBUI CHAT ERROR]", e);
    res.json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------
// ROUTE SKILL FACTORY - Lihat pola tool yang terdeteksi
// ---------------------------------------------------------
app.get("/api/skill-factory/patterns", async (req, res) => {
  try {
    const patterns = await getPatterns();
    const list = Object.entries(patterns).map(([key, p]) => ({
      key,
      sequence: p.sequence,
      count: p.count,
      threshold: SKILL_THRESHOLD,
      ready_for_skill: p.count >= SKILL_THRESHOLD && !p.skill_created,
      skill_created: p.skill_created,
      skill_name: p.skill_name,
      sessions_count: p.sessions.length,
      last_seen: p.last_seen,
    }));
    res.json({ success: true, patterns: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------
// ROUTE SKILL FACTORY - Lihat daftar skill yang sudah dibuat
// ---------------------------------------------------------
app.get("/api/skill-factory/skills", async (req, res) => {
  try {
    const skillDir = path.resolve("./skill");
    const entries = await fs.readdir(skillDir, { withFileTypes: true }).catch(() => []);
    const skills = [];

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      let meta = {};
      try {
        const raw = await fs.readFile(path.join(skillDir, e.name, "meta.json"), "utf8");
        meta = JSON.parse(raw);
      } catch {}
      skills.push({ name: e.name, ...meta });
    }

    res.json({ success: true, total: skills.length, skills });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------
// ROUTE SSE (SERVER-SENT EVENTS) - DEBUG PROJECT MANAGER
// ---------------------------------------------------------
app.get("/stream-pm", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const listener = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventBus.on("pm_debug", listener);

  req.on("close", () => {
    eventBus.off("pm_debug", listener);
  });
});

app.listen(PORT, () => {
  
});
