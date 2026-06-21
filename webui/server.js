/**
 * webui/server.js
 * Web UI Server untuk EMORA Agent
 * Full integration dengan memory.js, cmd.js, chat.js, tools.js
 * 
 * FIX: dotenv loading, working directory, path resolution
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

// ==========================================
// PATH RESOLUTION (Tiru pattern WhatsApp/Telegram)
// ==========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// FIX: Load dotenv dari root project secara eksplisit
// (dotenv default cari .env di cwd, tapi kita jalankan dari webui/ folder)
import { config } from 'dotenv';
config({ path: path.join(ROOT_DIR, '.env') });

console.log(`[WEBUI] Root directory: ${ROOT_DIR}`);
console.log(`[WEBUI] MODEL_API: ${process.env.MODEL_API ? '✅ Set' : '❌ Missing'}`);
console.log(`[WEBUI] MODEL_URL: ${process.env.MODEL_URL ? '✅ Set' : '❌ Missing'}`);
console.log(`[WEBUI] MODEL_NAME: ${process.env.MODEL_NAME ? '✅ Set' : '❌ Missing'}`);

// ==========================================
// Import core modules (setelah dotenv fix)
// ==========================================
import { ChatOpenAI } from "@langchain/openai";
import tools from '../core/tools.js';
import { ask } from '../core/chat.js';
import { handleCommand } from '../core/cmd.js';
import { loadSession, saveSession } from '../core/memory.js';
import { eventBus } from '../utils/eventBus.js';

const app = express();

// ==========================================
// PORT CONFIGURATION (Auto-detect if in use)
// ==========================================
const DEFAULT_PORT = parseInt(process.env.WEBUI_PORT) || 3000;

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.listen(startPort, '0.0.0.0');
  });
}

// ==========================================
// LLM INITIALIZATION (Tiru pattern WhatsApp.js)
// ==========================================
let llm;
try {
  const apiKey = process.env.MODEL_API || "ollama";
  const modelName = process.env.MODEL_NAME;
  const baseURL = process.env.MODEL_URL;

  if (!modelName) {
    throw new Error("MODEL_NAME tidak di-set di .env");
  }

  llm = new ChatOpenAI({
    apiKey: apiKey,
    model: modelName,
    configuration: { baseURL: baseURL },
    temperature: 0.2,
    maxTokens: 2048,
  }).bindTools(tools, { toolChoice: "auto" });

  console.log(`[WEBUI] LLM initialized: ${modelName} @ ${baseURL || 'default'}`);
} catch (err) {
  console.error("[WEBUI ERROR] Failed to initialize LLM:", err.message);
  process.exit(1);
}

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from dist (Vite build output)
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Session storage for web users
const webSessions = new Map();

// ==========================================
// FILE UPLOAD CONFIGURATION
// ==========================================
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `web_${timestamp}_${randomStr}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ==========================================
// API ROUTES
// ==========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    port: app.get('port'),
    rootDir: ROOT_DIR,
    model: process.env.MODEL_NAME,
    gateways: {
      telegram: process.env.TELEGRAM_GATEWAY === 'true',
      whatsapp: process.env.WA_GATEWAY === 'true'
    }
  });
});

// Get or create session
app.post('/api/session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (sessionId && webSessions.has(sessionId)) {
      webSessions.get(sessionId).lastActive = Date.now();
      const history = await loadSession(sessionId);
      res.json({ 
        sessionId, 
        history, 
        exists: true,
        message: 'Session resumed'
      });
    } else {
      const newSessionId = crypto.randomUUID();
      webSessions.set(newSessionId, { 
        createdAt: Date.now(), 
        lastActive: Date.now() 
      });
      res.json({ 
        sessionId: newSessionId, 
        history: [], 
        exists: false,
        message: 'New session created'
      });
    }
  } catch (err) {
    console.error('[WEBUI ERROR] Session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Load chat history
app.get('/api/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const history = await loadSession(sessionId);
    res.json(history);
  } catch (err) {
    console.error('[WEBUI ERROR] Load history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ 
        error: 'sessionId and message are required',
        code: 'MISSING_PARAMS'
      });
    }

    if (webSessions.has(sessionId)) {
      webSessions.get(sessionId).lastActive = Date.now();
    }

    const state = { currentSession: sessionId };
    const commandResult = handleCommand(message, state);
    
    if (commandResult) {
      if (commandResult.action === 'exit') {
        webSessions.delete(sessionId);
        const newSessionId = crypto.randomUUID();
        webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
        return res.json({ 
          type: 'command', 
          action: 'clear',
          content: 'Session cleared. Starting fresh...',
          newSessionId: newSessionId
        });
      }
      
      if (commandResult.action === 'reply') {
        if (message.startsWith('/new')) {
          const newSessionId = commandResult.message.match(/[0-9a-f-]{36}/)?.[0] || crypto.randomUUID();
          webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
          return res.json({
            type: 'command',
            action: 'new_session',
            content: commandResult.message,
            newSessionId: newSessionId
          });
        }
        
        if (message.startsWith('/sesi')) {
          const newSessionId = commandResult.message.match(/[0-9a-f-]{36}/)?.[0];
          if (newSessionId) {
            webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
            const history = await loadSession(newSessionId);
            return res.json({
              type: 'command',
              action: 'switch_session',
              content: commandResult.message,
              newSessionId: newSessionId,
              history: history
            });
          }
        }
        
        if (message.startsWith('/clear')) {
          const newSessionId = commandResult.message.match(/[0-9a-f-]{36}/)?.[0] || crypto.randomUUID();
          webSessions.set(newSessionId, { createdAt: Date.now(), lastActive: Date.now() });
          return res.json({
            type: 'command',
            action: 'clear_all',
            content: commandResult.message,
            newSessionId: newSessionId
          });
        }
        
        return res.json({
          type: 'command',
          action: 'reply',
          content: commandResult.message
        });
      }
    }

    const result = await ask(llm, tools, sessionId, message);
    
    res.json({
      type: 'chat',
      content: result,
      sessionId: sessionId
    });
    
  } catch (err) {
    console.error('[WEBUI ERROR] Chat error:', err.message);
    res.status(500).json({ 
      type: 'error',
      content: `Error: ${err.message}`,
      error: err.message,
      code: 'CHAT_ERROR'
    });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        code: 'NO_FILE'
      });
    }
    
    const fileInfo = {
      type: 'file',
      filename: req.file.originalname,
      storedName: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      extension: path.extname(req.file.originalname)
    };
    
    res.json(fileInfo);
  } catch (err) {
    console.error('[WEBUI ERROR] Upload error:', err.message);
    res.status(500).json({ 
      error: err.message,
      code: 'UPLOAD_ERROR'
    });
  }
});

// File analysis endpoint
app.post('/api/analyze-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        code: 'NO_FILE'
      });
    }

    const { sessionId, prompt } = req.body;
    if (!sessionId) {
      return res.status(400).json({
        error: 'sessionId required',
        code: 'MISSING_SESSION'
      });
    }

    const filePath = req.file.path;
    const filename = req.file.originalname;
    const size = (req.file.size / 1024).toFixed(2);
    const mimetype = req.file.mimetype;
    const extension = path.extname(filename).slice(1);

    let analysisPrompt = '';
    const isImage = mimetype.startsWith('image/');
    const isVideo = mimetype.startsWith('video/');
    const isAudio = mimetype.startsWith('audio/');
    const isPDF = extension === 'pdf' || mimetype === 'application/pdf';
    const isText = mimetype.startsWith('text/') || ['txt', 'md', 'json', 'csv', 'js', 'html', 'css', 'py'].includes(extension);

    if (isImage) {
      analysisPrompt = `User mengupload gambar: "${filename}" (${size}KB). ${prompt ? `Permintaan user: "${prompt}"` : 'Tidak ada permintaan spesifik.'}\n\nAnalisis gambar ini. Jika user meminta sesuatu terkait gambar (edit, describe, analyze, extract text/OCR, dll), lakukan sesuai permintaan. Jika tidak ada permintaan spesifik, berikan deskripsi umum gambar tersebut.`;
    } else if (isVideo) {
      analysisPrompt = `User mengupload video: "${filename}" (${size}KB). ${prompt ? `Permintaan user: "${prompt}"` : 'Tidak ada permintaan spesifik.'}\n\nAnalisis video ini. Jika user meminta sesuatu terkait video (extract frames, describe, summarize, dll), lakukan sesuai permintaan.`;
    } else if (isAudio) {
      analysisPrompt = `User mengupload audio: "${filename}" (${size}KB). ${prompt ? `Permintaan user: "${prompt}"` : 'Tidak ada permintaan spesifik.'}\n\nAnalisis audio ini. Jika user meminta transkripsi, summary, atau analisis audio, lakukan sesuai permintaan.`;
    } else if (isPDF) {
      analysisPrompt = `User mengupload PDF: "${filename}" (${size}KB). ${prompt ? `Permintaan user: "${prompt}"` : 'Tidak ada permintaan spesifik.'}\n\nBaca dan analisis konten PDF ini. Jika user meminta summary, extract text, atau analisis spesifik, lakukan sesuai permintaan.`;
    } else if (isText) {
      let fileContent = '';
      try {
        fileContent = fs.readFileSync(filePath, 'utf8');
        if (fileContent.length > 15000) {
          fileContent = fileContent.substring(0, 15000) + '\n... [truncated, file too large]';
        }
      } catch (err) {
        console.error('[WEBUI] Error reading text file:', err.message);
      }
      
      analysisPrompt = `User mengupload file teks: "${filename}" (${size}KB). ${prompt ? `Permintaan user: "${prompt}"` : 'Tidak ada permintaan spesifik.'}\n\nKonten file:\n\`\`\`\n${fileContent}\n\`\`\`\n\nAnalisis file ini. Jika user meminta review, fix, convert, atau manipulasi file, lakukan sesuai permintaan.`;
    } else {
      analysisPrompt = `User mengupload file: "${filename}" (${size}KB, type: ${mimetype}). ${prompt ? `Permintaan user: "${prompt}"` : 'Tidak ada permintaan spesifik.'}\n\nFile telah disimpan di: ${filePath}\n\nJika user meminta sesuatu terkait file ini (baca, convert, analyze, dll), lakukan sesuai permintaan.`;
    }

    if (webSessions.has(sessionId)) {
      webSessions.get(sessionId).lastActive = Date.now();
    }

    const result = await ask(llm, tools, sessionId, analysisPrompt);

    res.json({
      type: 'file_analysis',
      content: result,
      fileInfo: {
        filename: filename,
        storedName: req.file.filename,
        size: size + 'KB',
        mimetype: mimetype,
        path: filePath
      },
      sessionId: sessionId
    });

  } catch (err) {
    console.error('[WEBUI ERROR] File analysis error:', err.message);
    res.status(500).json({ 
      error: err.message,
      code: 'ANALYSIS_ERROR'
    });
  }
});

// Background task status
app.get('/api/bg-tasks', (req, res) => {
  res.json({ active: [] });
});

// ==========================================
// BACKGROUND TASK HANDLER
// ==========================================
const bgLocks = {};

eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
  if (bgLocks[job_id]) return;
  bgLocks[job_id] = true;

  try {
    const bgSessionId = `${session_id}_bg_${job_id}`;
    const result = await ask(llm, tools, bgSessionId, `[BACKGROUND TASK] ${prompt}`);

    if (!result.includes("SILENT_ABORT")) {
      console.log(`[WEBUI BG] Job ${job_id} completed for session ${session_id}`);
    }
  } catch (error) {
    console.error(`[WEBUI BG ERROR] Job ${job_id} failed:`, error.message);
  } finally {
    bgLocks[job_id] = false;
  }
});

// ==========================================
// SPA FALLBACK
// ==========================================
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({
      error: 'Frontend not built. Run npm run build in webui/ folder.',
      code: 'FRONTEND_NOT_BUILT'
    });
  }
});

// ==========================================
// ERROR HANDLING
// ==========================================
app.use((err, req, res, next) => {
  console.error('[WEBUI ERROR]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ 
      error: 'File too large. Max 100MB.',
      code: 'FILE_TOO_LARGE'
    });
  }
  res.status(500).json({ 
    error: err.message,
    code: 'INTERNAL_ERROR'
  });
});

// ==========================================
// START SERVER
// ==========================================
async function startServer() {
  try {
    const availablePort = await findAvailablePort(DEFAULT_PORT);
    app.set('port', availablePort);
    
    const server = app.listen(availablePort, '0.0.0.0', () => {
      console.log(`[WEBUI] ✅ Server running on http://localhost:${availablePort}`);
      console.log(`[WEBUI] Root directory: ${ROOT_DIR}`);
      console.log(`[WEBUI] API endpoints:`);
      console.log(`  - POST /api/session`);
      console.log(`  - GET  /api/history/:sessionId`);
      console.log(`  - POST /api/chat`);
      console.log(`  - POST /api/upload`);
      console.log(`  - POST /api/analyze-file`);
      console.log(`  - GET  /api/health`);
    });

    process.on('SIGTERM', () => {
      console.log('[WEBUI] SIGTERM received, shutting down...');
      server.close(() => process.exit(0));
    });

    process.on('SIGINT', () => {
      console.log('[WEBUI] SIGINT received, shutting down...');
      server.close(() => process.exit(0));
    });

    server.on('error', (err) => {
      console.error('[WEBUI SERVER ERROR]', err.message);
    });

  } catch (err) {
    console.error('[WEBUI FATAL ERROR] Could not start server:', err.message);
    process.exit(1);
  }
}

startServer();

export default app;
