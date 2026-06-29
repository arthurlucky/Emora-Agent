/**
 * webui/server.js
 * Web UI Server untuk EMORA Agent
 * Ekspor startWebUI() agar bisa dipanggil dari CLI.
 */

import "dotenv/config";
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import net from 'net';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

import { config } from 'dotenv';
config({ path: path.join(ROOT_DIR, '.env') });

console.log(`[WEBUI] Root directory: ${ROOT_DIR}`);

import { ChatOpenAI } from "@langchain/openai";
import tools from '../core/tools.js';
import { ask } from '../core/chat.js';
import { handleCommand } from '../core/cmd.js';
import { loadSession } from '../core/memory.js';
import { eventBus } from '../utils/eventBus.js';

const app = express();
const DEFAULT_PORT = parseInt(process.env.WEBUI_PORT) || 3000;

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(findAvailablePort(startPort + 1));
      else reject(err);
    });
    server.once('listening', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.listen(startPort, '0.0.0.0');
  });
}

let llm;

function initLLM() {
  if (llm) return llm;
  try {
    const apiKey = process.env.MODEL_API || "ollama";
    const modelName = process.env.MODEL_NAME;
    const baseURL = process.env.MODEL_URL;
    if (!modelName) throw new Error("MODEL_NAME tidak di-set");
    llm = new ChatOpenAI({
      apiKey,
      model: modelName,
      configuration: { baseURL },
      temperature: 0.2,
      maxTokens: 2048,
    }).bindTools(tools, { toolChoice: "auto" });
    console.log(`[WEBUI] LLM initialized: ${modelName}`);
    return llm;
  } catch (err) {
    console.error("[WEBUI ERROR] LLM init:", err.message);
    throw err;
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) app.use(express.static(distPath));

const webSessions = new Map();
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `web_${timestamp}_${randomStr}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), port: app.get('port'), rootDir: ROOT_DIR, model: process.env.MODEL_NAME });
});

app.post('/api/session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (sessionId && webSessions.has(sessionId)) {
      webSessions.get(sessionId).lastActive = Date.now();
      const history = await loadSession(sessionId);
      res.json({ sessionId, history, exists: true });
    } else {
      const newSessionId = crypto.randomUUID();
      webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
      res.json({ sessionId: newSessionId, history: [], exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const history = await loadSession(sessionId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });
    if (webSessions.has(sessionId)) webSessions.get(sessionId).lastActive = Date.now();

    const state = { currentSession: sessionId };
    const commandResult = handleCommand(message, state);
    if (commandResult) {
      // handle commands
      if (commandResult.action === 'exit') {
        webSessions.delete(sessionId);
        const newSessionId = crypto.randomUUID();
        webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
        return res.json({ type: 'command', action: 'clear', content: 'Session cleared.', newSessionId });
      }
      if (commandResult.action === 'reply') {
        if (message.startsWith('/new')) {
          const newSessionId = commandResult.message.match(/[0-9a-f-]{36}/)?.[0] || crypto.randomUUID();
          webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
          return res.json({ type: 'command', action: 'new_session', content: commandResult.message, newSessionId });
        }
        if (message.startsWith('/sesi')) {
          const newSessionId = commandResult.message.match(/[0-9a-f-]{36}/)?.[0];
          if (newSessionId) {
            webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
            const history = await loadSession(newSessionId);
            return res.json({ type: 'command', action: 'switch_session', content: commandResult.message, newSessionId, history });
          }
        }
        if (message.startsWith('/clear')) {
          const newSessionId = crypto.randomUUID();
          webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
          return res.json({ type: 'command', action: 'clear_all', content: commandResult.message, newSessionId });
        }
        return res.json({ type: 'command', action: 'reply', content: commandResult.message });
      }
    }

    const llm = initLLM();
    const result = await ask(llm, tools, sessionId, message);
    res.json({ type: 'chat', content: result, sessionId });
  } catch (err) {
    res.status(500).json({ type: 'error', content: `Error: ${err.message}` });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
      type: 'file',
      filename: req.file.originalname,
      storedName: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      extension: path.extname(req.file.originalname)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/analyze-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { sessionId, prompt } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const filePath = req.file.path;
    const filename = req.file.originalname;
    const size = (req.file.size / 1024).toFixed(2);
    const mimetype = req.file.mimetype;
    const extension = path.extname(filename).slice(1);

    let analysisPrompt = '';
    const isText = mimetype.startsWith('text/') || ['txt','md','json','csv','js','html','css','py'].includes(extension);
    if (isText) {
      let fileContent = '';
      try {
        fileContent = fs.readFileSync(filePath, 'utf8');
        if (fileContent.length > 15000) fileContent = fileContent.substring(0,15000) + '\n... [truncated]';
      } catch (e) {}
      analysisPrompt = `User mengupload file teks: "${filename}" (${size}KB). ${prompt || 'Tidak ada permintaan spesifik.'}\n\nKonten file:\n\`\`\`\n${fileContent}\n\`\`\`\n\nAnalisis file ini sesuai permintaan user.`;
    } else {
      analysisPrompt = `User mengupload file: "${filename}" (${size}KB, type: ${mimetype}). ${prompt || 'Tidak ada permintaan spesifik.'}\n\nFile disimpan di: ${filePath}\n\nLakukan sesuai permintaan user.`;
    }

    if (webSessions.has(sessionId)) webSessions.get(sessionId).lastActive = Date.now();
    const llm = initLLM();
    const result = await ask(llm, tools, sessionId, analysisPrompt);
    res.json({ type: 'file_analysis', content: result, fileInfo: { filename, storedName: req.file.filename, size: size+'KB', mimetype, path: filePath }, sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bg-tasks', (req, res) => res.json({ active: [] }));

// Background task handler
const bgLocks = {};
eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
  if (bgLocks[job_id]) return;
  bgLocks[job_id] = true;
  try {
    const llm = initLLM();
    const bgSessionId = `${session_id}_bg_${job_id}`;
    const result = await ask(llm, tools, bgSessionId, `[BACKGROUND TASK] ${prompt}`);
    if (!result.includes("SILENT_ABORT")) {
      console.log(`[WEBUI BG] Job ${job_id} completed`);
    }
  } catch (err) {
    console.error(`[WEBUI BG ERROR] Job ${job_id}:`, err.message);
  } finally { bgLocks[job_id] = false; }
});

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).json({ error: 'Frontend not built. Run npm run build in webui/.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[WEBUI ERROR]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large. Max 100MB.' });
  res.status(500).json({ error: err.message });
});

// Export start function
export async function startWebUI() {
  try {
    const availablePort = await findAvailablePort(DEFAULT_PORT);
    app.set('port', availablePort);
    const server = app.listen(availablePort, '0.0.0.0', () => {
      console.log(`[WEBUI] ✅ Server running on http://localhost:${availablePort}`);
      console.log(`[WEBUI] Root directory: ${ROOT_DIR}`);
    });

    process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
    process.on('SIGINT', () => { server.close(() => process.exit(0)); });
    server.on('error', (err) => console.error('[WEBUI SERVER ERROR]', err.message));
    return server;
  } catch (err) {
    console.error('[WEBUI FATAL ERROR]', err.message);
    process.exit(1);
  }
}

// If this file is run directly (not imported), start server
if (import.meta.url === `file://${process.argv[1]}`) {
  startWebUI();
}

export default app;