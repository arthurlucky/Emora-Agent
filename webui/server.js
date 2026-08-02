/**
 * webui/server.js
 * Web UI Server untuk EMORA Agent
 * Terintegrasi penuh dengan seluruh core module EMORA (sessionStore, gateway, provider, skill, config, project_manager).
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

// ── Integration with EMORA Core Modules ──────────────────────────────────────
import { createLLM, detectProvider, getProviderMeta, getProviderModels, PROVIDERS } from '../provider/index.js';
import tools from '../core/tools.js';
import { ask, invalidateSystemPromptCache } from '../core/chat.js';
import { handleCommand } from '../core/cmd.js';
import { loadSession } from '../core/memory.js';
import { listSessions, createSession, renameSession, deleteSession, touchSession } from '../core/sessionStore.js';
import { getManager } from '../gateway/manager.js';
import { loadGatewayConfig, saveGatewayConfig } from '../gateway/config.js';
import { resolveWorkspacePath } from '../utils/workspace.js';
import { eventBus } from '../utils/eventBus.js';

const app = express();
const DEFAULT_PORT = parseInt(process.env.WEBUI_PORT) || 3000;
const HOST = process.env.WEBUI_HOST || '0.0.0.0';

function findAvailablePort(startPort, host = HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(findAvailablePort(startPort + 1, host));
      else reject(err);
    });
    server.once('listening', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.listen(startPort, host);
  });
}

let llmInstance = null;

async function getLLM() {
  if (llmInstance) return llmInstance;
  try {
    llmInstance = await createLLM(tools);
    const modelName = process.env.MODEL_NAME || "default";
    console.log(`[WEBUI] LLM initialized via provider factory (${modelName})`);
    return llmInstance;
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
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
} else {
  app.use(express.static(__dirname));
}

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

// ── API ROUTES ───────────────────────────────────────────────────────────────

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: app.get('port'),
    rootDir: ROOT_DIR,
    provider: detectProvider(),
    model: process.env.MODEL_NAME || 'default'
  });
});

// ── 1. SESSION & MEMORY MANAGEMENT (core/sessionStore.js & core/memory.js) ──
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await listSessions();
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/memory', async (req, res) => {
  try {
    const sessions = await listSessions();
    const memories = sessions.map(s => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount,
      size: (s.messageCount || 1) * 380
    }));
    res.json({ success: true, memories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/memory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const history = await loadSession(id);
    res.json({ success: true, id, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memory', async (req, res) => {
  try {
    const { action, name, id } = req.body;
    if (action === 'create' || (!action && name)) {
      const session = await createSession(name);
      return res.json({ success: true, memory: session, session });
    }
    if (action === 'rename' && id) {
      const session = await renameSession(id, name);
      return res.json({ success: true, memory: session, session });
    }
    res.status(400).json({ error: 'Invalid memory action' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/memory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteSession(id);
    res.json({ success: true, message: `Memory ${id} deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { name } = req.body;
    const session = await createSession(name);
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const session = await renameSession(id, name);
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteSession(id);
    res.json({ success: true, message: `Session ${id} deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (sessionId) {
      await touchSession(sessionId);
      const history = await loadSession(sessionId);
      res.json({ sessionId, history, exists: true });
    } else {
      const newSession = await createSession();
      res.json({ sessionId: newSession.id, history: [], exists: false });
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

// ── 2. CHAT & COMMAND API ───────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });

    await touchSession(sessionId, message);

    const state = { currentSession: sessionId };
    const commandResult = handleCommand(message, state);
    if (commandResult) {
      if (commandResult.action === 'exit') {
        const newSession = await createSession();
        return res.json({ type: 'command', action: 'clear', content: 'Session cleared.', newSessionId: newSession.id });
      }
      if (commandResult.action === 'reply') {
        return res.json({ type: 'command', action: 'reply', content: commandResult.message });
      }
    }

    const llm = await getLLM();
    const result = await ask(llm, tools, sessionId, message);
    res.json({ type: 'chat', content: result, sessionId });
  } catch (err) {
    res.status(500).json({ type: 'error', content: `Error: ${err.message}` });
  }
});

// Real-time SSE Chat Streaming Endpoint
app.post('/api/chat/stream', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) {}
  };

  try {
    await touchSession(sessionId, message);

    const state = { currentSession: sessionId };
    const commandResult = handleCommand(message, state);
    if (commandResult) {
      if (commandResult.action === 'exit') {
        const newSession = await createSession();
        sendEvent({ type: 'command', action: 'clear', content: 'Session cleared.', newSessionId: newSession.id });
        return res.end();
      }
      if (commandResult.action === 'reply') {
        sendEvent({ type: 'command', action: 'reply', content: commandResult.message });
        return res.end();
      }
    }

    const llm = await getLLM();
    sendEvent({ type: 'thinking', text: 'Menganalisis masukan...' });

    const result = await ask(llm, tools, sessionId, message, {
      onEvent: (event) => {
        if (event.type === 'skill_read') {
          sendEvent({ type: 'skill_use', skill: event.name });
          sendEvent({ type: 'thinking', text: `Menggunakan skill: ${event.name}` });
        } else if (event.type === 'tool_use') {
          sendEvent({ type: 'tool_use', tool: event.name, args: event.args });
          sendEvent({ type: 'thinking', text: `Memanggil alat: ${event.name}...` });
        } else if (event.type === 'tool_result') {
          sendEvent({ type: 'tool_result', tool: event.name, result: event.result });
          sendEvent({ type: 'thinking', text: `Memproses hasil dari ${event.name}...` });
        } else if (event.type === 'thinking') {
          sendEvent(event);
        }
      }
    });

    sendEvent({ type: 'thinking', text: 'Menyusun tanggapan akhir...' });
    
    // Stream token chunks for 60fps smooth text stream animation
    const chunkSize = 8;
    for (let i = 0; i < result.length; i += chunkSize) {
      const chunk = result.slice(i, i + chunkSize);
      sendEvent({ type: 'stream_token', content: chunk });
      await new Promise(r => setTimeout(r, 12));
    }

    sendEvent({ type: 'done', content: result, sessionId });
    res.end();
  } catch (err) {
    sendEvent({ type: 'error', content: `Error: ${err.message}` });
    res.end();
  }
});

// ── 3. GATEWAY MANAGER API (gateway/manager.js) ────────────────────────────
app.get('/api/gateways', (req, res) => {
  try {
    const mgr = getManager();
    const statusMap = mgr.status();
    const cfg = loadGatewayConfig();
    const gateways = Object.entries(cfg.platforms || {}).map(([id, p]) => ({
      id,
      name: p.name || id,
      enabled: !!p.enabled,
      running: statusMap[id]?.running || false,
      info: statusMap[id]?.info || (p.enabled ? "ready" : "disabled"),
      config: p.config || p.extra || {}
    }));
    res.json({ success: true, gateways });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gateways', async (req, res) => {
  try {
    const { gateways, action, platform } = req.body;
    const mgr = getManager();

    if (action === 'start' && platform) {
      await mgr.start(platform);
      return res.json({ success: true, message: `Gateway ${platform} started.` });
    }
    if (action === 'stop' && platform) {
      await mgr.stop(platform);
      return res.json({ success: true, message: `Gateway ${platform} stopped.` });
    }

    if (Array.isArray(gateways)) {
      const cfg = loadGatewayConfig();
      cfg.platforms = cfg.platforms || {};
      for (const g of gateways) {
        if (cfg.platforms[g.id]) {
          cfg.platforms[g.id].enabled = g.enabled;
          if (g.config) cfg.platforms[g.id].config = { ...cfg.platforms[g.id].config, ...g.config };
        }
      }
      saveGatewayConfig(cfg);
      return res.json({ success: true, message: 'Gateways saved.' });
    }

    res.status(400).json({ error: 'Invalid gateway action/payload' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3.5 CRON SCHEDULE API ──────────────────────────────────────────────────

app.get('/api/cron', (req, res) => {
  try {
    const manager = getManager();
    const jobs = manager.cronStore.listJobs();
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cron', (req, res) => {
  try {
    const manager = getManager();
    const { name, schedule, prompt, platform, chatId, enabled } = req.body;
    const job = manager.cronStore.saveJob({ name, schedule, prompt, platform, chatId, enabled });
    manager.cronScheduler.reload();
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cron/:name', (req, res) => {
  try {
    const manager = getManager();
    manager.cronStore.deleteJob(req.params.name);
    manager.cronScheduler.reload();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 4. SYSTEM PROMPTS & CONFIG API (AGENT.md & SOUL.md) ──────────────────────
app.get('/api/config', (req, res) => {
  try {
    const agentPath = path.join(ROOT_DIR, 'AGENT.md');
    const soulPath = path.join(ROOT_DIR, 'SOUL.md');
    const agent = fs.existsSync(agentPath) ? fs.readFileSync(agentPath, 'utf8') : '';
    const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : '';
    res.json({ success: true, agent, soul, provider: detectProvider(), model: process.env.MODEL_NAME });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const { agent, soul } = req.body;
    if (agent !== undefined) fs.writeFileSync(path.join(ROOT_DIR, 'AGENT.md'), agent, 'utf8');
    if (soul !== undefined) fs.writeFileSync(path.join(ROOT_DIR, 'SOUL.md'), soul, 'utf8');
    invalidateSystemPromptCache();
    res.json({ success: true, message: 'Configuration saved and system prompt refreshed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5. SKILL MANAGER API (skill/) ──────────────────────────────────────────
app.get('/api/skills', (req, res) => {
  try {
    const skillDir = path.join(ROOT_DIR, 'skill');
    if (!fs.existsSync(skillDir)) return res.json({ success: true, skills: [] });

    const entries = fs.readdirSync(skillDir, { withFileTypes: true });
    const skills = entries.filter(e => e.isDirectory()).map(e => {
      const disabled = e.name.endsWith('.disabled');
      const cleanName = e.name.replace(/\.disabled$/, '');
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(skillDir, e.name, 'meta.json'), 'utf8'));
      } catch {}
      return { name: cleanName, rawName: e.name, enabled: !disabled, description: meta.description || '' };
    });
    res.json({ success: true, skills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/skills/:name', (req, res) => {
  try {
    const { name } = req.params;
    const skillDir = path.join(ROOT_DIR, 'skill');
    let targetFolder = path.join(skillDir, name);
    if (!fs.existsSync(targetFolder)) targetFolder = path.join(skillDir, `${name}.disabled`);
    
    if (!fs.existsSync(targetFolder)) return res.status(404).json({ error: 'Skill not found' });

    let content = '';
    const mdPath = path.join(targetFolder, 'skill.md');
    const capsMdPath = path.join(targetFolder, 'SKILL.md');
    if (fs.existsSync(mdPath)) content = fs.readFileSync(mdPath, 'utf8');
    else if (fs.existsSync(capsMdPath)) content = fs.readFileSync(capsMdPath, 'utf8');

    let meta = {};
    const metaPath = path.join(targetFolder, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
    }

    res.json({ success: true, name, meta, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/skills/toggle', (req, res) => {
  try {
    const { name, enabled } = req.body;
    const skillDir = path.join(ROOT_DIR, 'skill');
    const oldPath = path.join(skillDir, enabled ? `${name}.disabled` : name);
    const newPath = path.join(skillDir, enabled ? name : `${name}.disabled`);
    if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);
    invalidateSystemPromptCache();
    res.json({ success: true, name, enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Module-level helper — defined once, not per-request
function scanLibraryFiles(dir, libDir, files) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    if (it.isDirectory()) {
      scanLibraryFiles(path.join(dir, it.name), libDir, files);
    } else if (it.name.endsWith('.txt') || it.name.endsWith('.md')) {
      const full = path.join(dir, it.name);
      const rel = path.relative(libDir, full);
      const stat = fs.statSync(full);
      files.push({ name: it.name, relPath: rel, size: stat.size, mtime: stat.mtime });
    }
  }
}

// ── 5B. KNOWLEDGE LIBRARY API (library/) ──────────────────────────────────────
app.get('/api/library', (req, res) => {
  try {
    const libDir = path.join(ROOT_DIR, 'library');
    if (!fs.existsSync(libDir)) return res.json({ success: true, topics: [] });

    const topics = [];
    const entries = fs.readdirSync(libDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const topicName = entry.name;
        const topicPath = path.join(libDir, topicName);
        const subentries = fs.readdirSync(topicPath, { withFileTypes: true });
        const subtopics = [];

        for (const sub of subentries) {
          if (sub.isDirectory()) {
            const subPath = path.join(topicPath, sub.name);
            const files = [];
            
            scanLibraryFiles(subPath, libDir, files);
            subtopics.push({ name: sub.name, files });
          }
        }
        topics.push({ name: topicName, subtopics });
      }
    }
    res.json({ success: true, topics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/library/file', (req, res) => {
  try {
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ error: 'path parameter required' });

    const fullPath = path.join(ROOT_DIR, 'library', relPath);
    if (!fs.existsSync(fullPath) || !fullPath.startsWith(path.join(ROOT_DIR, 'library'))) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ success: true, path: relPath, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5C. REAL-TIME SYSTEM METRICS & WEB TERMINAL CONSOLE ─────────────────────
import os from 'os';
import { exec as childExec } from 'child_process';

app.get('/api/system/metrics', (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);
    const loadAvg = os.loadavg();
    const cpus = os.cpus();

    res.json({
      success: true,
      timestamp: Date.now(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      cpusCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Generic CPU',
      loadAvg: loadAvg[0] ? loadAvg[0].toFixed(2) : '0.00',
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        percent: memPercent
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Terminal rate limiting: max 10 requests per minute per source IP
const terminalRateLimiter = new Map();
const TERMINAL_ALLOWED_PREFIXES = [
  'ls', 'cat', 'echo', 'pwd', 'find', 'grep', 'head', 'tail', 'wc',
  'node', 'npm', 'python', 'python3', 'pip', 'pip3',
  'git', 'curl', 'wget', 'ps', 'top', 'df', 'du', 'free', 'uname',
  'which', 'type', 'env', 'printenv', 'date', 'uptime', 'whoami',
  'mkdir', 'rm', 'cp', 'mv', 'touch', 'chmod'
];

function isTerminalCommandAllowed(command) {
  const trimmed = command.trim().split(/\s+/)[0].toLowerCase();
  return TERMINAL_ALLOWED_PREFIXES.some(p => trimmed === p || trimmed.endsWith('/' + p));
}

app.post('/api/terminal/exec', (req, res) => {
  try {
    const { command } = req.body;
    if (!command || !command.trim()) return res.status(400).json({ error: 'Command is required' });

    // Rate limiting
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60_000;
    const limit = 20;
    const record = terminalRateLimiter.get(ip) || { count: 0, reset: now + windowMs };
    if (now > record.reset) { record.count = 0; record.reset = now + windowMs; }
    record.count++;
    terminalRateLimiter.set(ip, record);
    if (record.count > limit) {
      return res.status(429).json({ error: 'Rate limit: maks 20 perintah/menit.' });
    }

    // Command allowlist check
    if (!isTerminalCommandAllowed(command)) {
      return res.status(403).json({
        error: `Perintah tidak diizinkan: ${command.trim().split(' ')[0]}`,
        hint: 'Hanya perintah aman yang diizinkan (ls, cat, git, node, npm, python, dll.)'
      });
    }

    childExec(command, { cwd: ROOT_DIR, timeout: 30000 }, (error, stdout, stderr) => {
      res.json({
        success: !error,
        command,
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : ''),
        exitCode: error ? (error.code || 1) : 0
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6. PROJECT MANAGER API (.emora_projects) ─────────────────────────────────
app.get('/api/projects', (req, res) => {
  try {
    const projectsDir = resolveWorkspacePath('.emora_projects');
    if (!fs.existsSync(projectsDir)) return res.json({ success: true, projects: [] });

    const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'));
    const projects = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(projectsDir, f), 'utf8'));
        return { name: f.replace('.json', ''), ...data };
      } catch {
        return { name: f.replace('.json', '') };
      }
    });
    res.json({ success: true, projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:name', (req, res) => {
  try {
    const projectsDir = resolveWorkspacePath('.emora_projects');
    const filePath = path.join(projectsDir, `${req.params.name}.json`);
    if (fs.existsSync(filePath)) {
      res.json({ success: true, project: JSON.parse(fs.readFileSync(filePath, 'utf8')) });
    } else {
      res.status(404).json({ error: 'Project not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7. PROVIDER & MODEL SWITCHER API ───────────────────────────────────────
app.get('/api/provider', async (req, res) => {
  try {
    const activeProvider = detectProvider();
    const meta = getProviderMeta(activeProvider);
    const models = await getProviderModels(activeProvider);
    res.json({
      success: true,
      activeProvider,
      meta,
      currentModel: process.env.MODEL_NAME || 'default',
      providers: PROVIDERS,
      models
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/provider', async (req, res) => {
  try {
    const { provider, model, apiKey } = req.body;
    const envFile = path.join(ROOT_DIR, '.env');
    let envContent = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';

    if (provider) {
      envContent = /^MODEL_PROVIDER=.*$/m.test(envContent)
        ? envContent.replace(/^MODEL_PROVIDER=.*$/m, `MODEL_PROVIDER=${provider}`)
        : envContent + `\nMODEL_PROVIDER=${provider}`;
      process.env.MODEL_PROVIDER = provider;
    }
    if (model) {
      envContent = /^MODEL_NAME=.*$/m.test(envContent)
        ? envContent.replace(/^MODEL_NAME=.*$/m, `MODEL_NAME=${model}`)
        : envContent + `\nMODEL_NAME=${model}`;
      process.env.MODEL_NAME = model;
    }
    if (apiKey) {
      envContent = /^MODEL_API=.*$/m.test(envContent)
        ? envContent.replace(/^MODEL_API=.*$/m, `MODEL_API=${apiKey}`)
        : envContent + `\nMODEL_API=${apiKey}`;
      process.env.MODEL_API = apiKey;
    }

    fs.writeFileSync(envFile, envContent.trim() + '\n');
    llmInstance = null; // Force reset LLM instance for new provider/model

    res.json({ success: true, message: `Switched provider to ${provider || process.env.MODEL_PROVIDER} (${model || process.env.MODEL_NAME})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 8. FILE UPLOAD & ANALYZER API ───────────────────────────────────────────
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

    await touchSession(sessionId);
    const llm = await getLLM();
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
    const llm = await getLLM();
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
  const distIndexPath = path.join(__dirname, 'dist', 'index.html');
  const rootIndexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(distIndexPath)) {
    res.sendFile(distIndexPath);
  } else if (fs.existsSync(rootIndexPath)) {
    res.sendFile(rootIndexPath);
  } else {
    res.status(404).json({ error: 'index.html tidak ditemukan.' });
  }
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
    const server = app.listen(availablePort, HOST, () => {
      console.log(`[WEBUI] ✅ Server running on http://${HOST}:${availablePort}`);
      console.log(`[WEBUI] Root directory: ${ROOT_DIR}`);
      console.log(`[WEBUI] Tekan Ctrl+C untuk menghentikan server.`);
    });

    const shutdown = () => {
      console.log('\n[WEBUI] Menghentikan server...');
      try { server.close(); } catch {}
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
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