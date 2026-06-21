import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// IMPORT CORE EMORA MODULES (SAMA PERSIS WHATSAPP)
// ==========================================
import { ChatOpenAI } from '@langchain/openai';
import tools from '../core/tools.js';
import { ask } from '../core/chat.js';
import { eventBus } from '../utils/eventBus.js';

const app = express();
const upload = multer({ dest: path.join(__dirname, 'temp/') });
const PORT = process.env.WEBUI_PORT || 5090;

// Ensure temp directory exists
await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });

// ==========================================
// INITIALIZE LLM (EXACT SAME AS WHATSAPP GATEWAY)
// ==========================================
console.log('[WEBUI] Initializing LLM...');
console.log('[WEBUI] Model:', process.env.MODEL_NAME || 'default');
console.log('[WEBUI] URL:', process.env.MODEL_URL || 'default');

const llm = new ChatOpenAI({
  apiKey: process.env.MODEL_API || "ollama",
  model: process.env.MODEL_NAME,
  configuration: { baseURL: process.env.MODEL_URL },
  temperature: 0.2,
  maxTokens: 2048,
}).bindTools(tools, { toolChoice: "auto" });

console.log('[WEBUI] LLM initialized successfully');
console.log('[WEBUI] Tools loaded:', tools.length);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==========================================
// API CHAT - REAL INTEGRATION WITH core/chat.js
// ==========================================
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ 
      success: false, 
      error: 'Data tidak lengkap: sessionId dan message diperlukan' 
    });
  }

  try {
    console.log(`[WEBUI CHAT] Session: ${sessionId}, Message: ${message.slice(0, 50)}...`);

    // PANGGIL ask() SAMA PERSIS KAYA WHATSAPP GATEWAY
    const result = await ask(llm, tools, sessionId, message);

    console.log(`[WEBUI CHAT] Response: ${result.slice(0, 100)}...`);

    res.json({ 
      success: true, 
      reply: result,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[WEBUI CHAT ERROR]', error.message);
    console.error(error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ==========================================
// API UPLOAD FILE
// ==========================================
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    let content = '';
    const isText = /\.(txt|md|js|ts|json|csv|html|css|py|sh|yaml|yml|xml|log)$/i.test(file.originalname);

    if (isText || file.size < 100000) {
      content = await fs.readFile(file.path, 'utf-8');
    } else {
      content = `[Binary file: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB)]`;
    }

    // Clean up temp file
    await fs.unlink(file.path).catch(() => {});

    res.json({
      success: true,
      filename: file.originalname,
      content,
      size: file.size
    });
  } catch (error) {
    console.error('[WEBUI UPLOAD ERROR]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// API GATEWAYS
// ==========================================
app.get('/api/gateways', async (req, res) => {
  try {
    const envPath = path.join(__dirname, '../.env');
    const envContent = await fs.readFile(envPath, 'utf-8').catch(() => '');

    const env = {};
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) env[key.trim()] = valueParts.join('=').trim();
    });

    res.json({
      success: true,
      gateways: [
        {
          id: 'telegram',
          name: 'Telegram Bot',
          enabled: env.TELEGRAM_GATEWAY === 'true',
          config: {
            token: env.TELEGRAM_TOKEN_BOT || '',
            allowedIds: env.TELEGRAM_ALLOWED_IDS || ''
          }
        },
        {
          id: 'whatsapp',
          name: 'WhatsApp',
          enabled: env.WA_GATEWAY === 'true',
          config: {
            phoneNumber: env.WA_PHONE_NUMBER || '',
            allowedNumbers: env.WA_ALLOWED_NUMBERS || ''
          }
        },
        {
          id: 'webui',
          name: 'Web UI',
          enabled: env.WEBUI === 'true',
          config: { port: env.WEBUI_PORT || '5090' }
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/gateways', async (req, res) => {
  try {
    const { gateways } = req.body;
    const envPath = path.join(__dirname, '../.env');
    const envContent = await fs.readFile(envPath, 'utf-8').catch(() => '');

    const lines = envContent.split('\n');
    const updatedLines = lines.map(line => {
      const key = line.split('=')[0]?.trim();
      if (key === 'TELEGRAM_GATEWAY') {
        const g = gateways.find(g => g.id === 'telegram');
        return `TELEGRAM_GATEWAY=${g?.enabled ? 'true' : 'false'}`;
      }
      if (key === 'TELEGRAM_TOKEN_BOT') {
        const g = gateways.find(g => g.id === 'telegram');
        return `TELEGRAM_TOKEN_BOT=${g?.config?.token || ''}`;
      }
      if (key === 'TELEGRAM_ALLOWED_IDS') {
        const g = gateways.find(g => g.id === 'telegram');
        return `TELEGRAM_ALLOWED_IDS=${g?.config?.allowedIds || ''}`;
      }
      if (key === 'WA_GATEWAY') {
        const g = gateways.find(g => g.id === 'whatsapp');
        return `WA_GATEWAY=${g?.enabled ? 'true' : 'false'}`;
      }
      if (key === 'WA_PHONE_NUMBER') {
        const g = gateways.find(g => g.id === 'whatsapp');
        return `WA_PHONE_NUMBER=${g?.config?.phoneNumber || ''}`;
      }
      if (key === 'WEBUI') {
        const g = gateways.find(g => g.id === 'webui');
        return `WEBUI=${g?.enabled ? 'true' : 'false'}`;
      }
      if (key === 'WEBUI_PORT') {
        const g = gateways.find(g => g.id === 'webui');
        return `WEBUI_PORT=${g?.config?.port || '5090'}`;
      }
      return line;
    });

    await fs.writeFile(envPath, updatedLines.join('\n'));
    res.json({ success: true, message: 'Gateway configuration updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// API MEMORY
// ==========================================
app.get('/api/memory', async (req, res) => {
  try {
    const memoryDir = path.join(__dirname, '../memory');
    await fs.mkdir(memoryDir, { recursive: true });
    const files = await fs.readdir(memoryDir);

    const memories = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          const stat = await fs.stat(path.join(memoryDir, f));
          return {
            id: f.replace('.json', ''),
            name: f.replace('.json', ''),
            size: stat.size,
            updated: stat.mtime.getTime()
          };
        })
    );

    res.json({ success: true, memories: memories.sort((a, b) => b.updated - a.updated) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/memory', async (req, res) => {
  try {
    const { action, id, name, content } = req.body;
    const memoryDir = path.join(__dirname, '../memory');
    await fs.mkdir(memoryDir, { recursive: true });

    if (action === 'create') {
      const newId = name || `memory_${Date.now()}`;
      await fs.writeFile(path.join(memoryDir, `${newId}.json`), JSON.stringify(content || [], null, 2));
      return res.json({ success: true, id: newId });
    }

    if (action === 'rename') {
      await fs.rename(path.join(memoryDir, `${id}.json`), path.join(memoryDir, `${name}.json`));
      return res.json({ success: true });
    }

    if (action === 'update') {
      await fs.writeFile(path.join(memoryDir, `${id}.json`), JSON.stringify(content, null, 2));
      return res.json({ success: true });
    }

    res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/memory/:id', async (req, res) => {
  try {
    await fs.unlink(path.join(__dirname, '../memory', `${req.params.id}.json`));
    res.json({ success: true });
  } catch (error) {
    res.status(404).json({ success: false, error: 'Memory not found' });
  }
});

// ==========================================
// API CONFIG (AGENT.md & SOUL.md)
// ==========================================
app.get('/api/config', async (req, res) => {
  try {
    const [agent, soul] = await Promise.all([
      fs.readFile(path.join(__dirname, '../AGENT.md'), 'utf-8').catch(() => ''),
      fs.readFile(path.join(__dirname, '../SOUL.md'), 'utf-8').catch(() => '')
    ]);
    res.json({ success: true, agent, soul });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const { agent, soul } = req.body;
    await Promise.all([
      fs.writeFile(path.join(__dirname, '../AGENT.md'), agent || ''),
      fs.writeFile(path.join(__dirname, '../SOUL.md'), soul || '')
    ]);
    res.json({ success: true, message: 'Configuration saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// API PROJECTS
// ==========================================
app.get('/api/projects', async (req, res) => {
  try {
    const projectDir = path.join(__dirname, '../workspaces/.emora_projects');
    await fs.mkdir(projectDir, { recursive: true });
    const files = await fs.readdir(projectDir);
    const projects = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    res.json({ success: true, projects });
  } catch (error) {
    res.json({ success: true, projects: [] });
  }
});

app.get('/api/projects/:name', async (req, res) => {
  try {
    const data = await fs.readFile(path.join(__dirname, '../workspaces/.emora_projects', `${req.params.name}.json`), 'utf-8');
    res.json({ success: true, plan: JSON.parse(data) });
  } catch (error) {
    res.status(404).json({ success: false, error: 'Project not found' });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { projectName, tasks } = req.body;
    const projectDir = path.join(__dirname, '../workspaces/.emora_projects');
    await fs.mkdir(projectDir, { recursive: true });

    const plan = {
      project_name: projectName,
      tasks: tasks.map(t => ({ ...t, status: 'PENDING', context: '' }))
    };

    await fs.writeFile(path.join(projectDir, `${projectName}.json`), JSON.stringify(plan, null, 2));

    // Emit debug event
    eventBus.emit('pm_debug', {
      type: 'plan_created',
      projectName,
      timestamp: Date.now(),
      message: `Plan "${projectName}" created with ${tasks.length} tasks`
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// SSE STREAM FOR PROJECT MANAGER DEBUG
// ==========================================
app.get('/stream-pm', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const listener = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventBus.on('pm_debug', listener);

  const keepAlive = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    eventBus.off('pm_debug', listener);
  });
});

// ==========================================
// SERVE STATIC FILES - CHECK IF DIST EXISTS
// ==========================================
const distPath = path.join(__dirname, 'dist');

// Check if dist folder exists
let distExists = false;
try {
  const stat = await fs.stat(distPath);
  distExists = stat.isDirectory();
} catch {
  distExists = false;
}

if (distExists) {
  console.log('[WEBUI] Serving static files from dist/');
  app.use(express.static(distPath));

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.log('[WEBUI] dist/ not found - serving simple HTML');
  console.log('[WEBUI] Run "npm run build" to build frontend');

  // Simple HTML for development without build
  app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EMORA Agent</title>
  <style>
    body { font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
    .container { text-align: center; }
    h1 { font-size: 3rem; margin-bottom: 1rem; background: linear-gradient(135deg, #10b981, #059669); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #94a3b8; margin-bottom: 2rem; }
    .btn { display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
    .btn:hover { background: #059669; }
    .info { margin-top: 2rem; padding: 1rem; background: rgba(255,255,255,0.05); border-radius: 8px; font-size: 0.9rem; color: #64748b; }
    code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>EMORA</h1>
    <p>WebUI backend is running. Frontend not built yet.</p>
    <a href="/api/gateways" class="btn">Test API</a>
    <div class="info">
      <p>Run <code>npm run build</code> in webui/ folder to build frontend</p>
      <p>Or run <code>npm run dev</code> for development mode</p>
    </div>
  </div>
</body>
</html>
    `);
  });
}

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              EMORA WEBUI SERVER                          ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  URL: http://localhost:${PORT}                              ║`);
  console.log('║  Status: ONLINE                                          ║');
  console.log('║  LLM: ' + (process.env.MODEL_NAME || 'default').padEnd(52) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
});
