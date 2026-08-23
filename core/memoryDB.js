/**
 * core/memoryDB.js
 *
 * Enhanced JSON-based memory system (fallback dari SQLite)
 * Provides session management, message storage, and facts system
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

const MEMORY_DIR = process.env.EMORA_MEMORY_DIR || path.resolve('./memory');
const META_FILE = path.join(MEMORY_DIR, 'sessions.meta.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ensure memory directory exists
if (!fsSync.existsSync(MEMORY_DIR)) {
  fsSync.mkdirSync(MEMORY_DIR, { recursive: true });
}

// In-memory cache for performance
const sessionCache = new Map();
const fileCache = new Map();
const MAX_CACHE_SESSIONS = 50;
const CACHE_TTL_MS = 30 * 60 * 1000;

console.log('ℹ️  Using enhanced JSON memory system');

// ============================================================================
// HELPERS
// ============================================================================

function defaultName(sessionId) {
  return `Sesi ${sessionId.slice(0, 8)}`;
}

export function generateTitleFromPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const clean = prompt.trim()
    .replace(/^[\/\#\!\.\,\?\s]+/, '')
    .replace(/\s+/g, ' ');
  if (!clean || clean.length < 2) return null;
  return clean.length > 38 ? clean.slice(0, 38) + '...' : clean;
}

function touchCache(sessionId, data) {
  sessionCache.delete(sessionId);
  sessionCache.set(sessionId, { data, timestamp: Date.now() });
  if (sessionCache.size > MAX_CACHE_SESSIONS) {
    const oldestKey = sessionCache.keys().next().value;
    sessionCache.delete(oldestKey);
  }
}

async function loadMeta() {
  try {
    const raw = await fs.readFile(META_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveMeta(meta) {
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2));
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

export async function createSession(name) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const finalName = (name || '').trim() || defaultName(id);
  
  const meta = await loadMeta();
  meta[id] = {
    name: finalName,
    createdAt: now,
    updatedAt: now,
  };
  
  await saveMeta(meta);
  return { id, name: finalName, createdAt: now, updatedAt: now, messageCount: 0 };
}

export async function listSessions() {
  const meta = await loadMeta();
  const sessions = [];
  
  try {
    const files = await fs.readdir(MEMORY_DIR);
    
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'sessions.meta.json') continue;
      const id = file.replace(/\.json$/, '');
      if (!UUID_RE.test(id)) continue;
      
      const filePath = path.join(MEMORY_DIR, file);
      let messageCount = 0;
      let stat;
      
      try {
        stat = await fs.stat(filePath);
        const cached = fileCache.get(file);
        
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          messageCount = cached.messageCount;
        } else {
          const raw = await fs.readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw || '[]');
          messageCount = Array.isArray(parsed) ? parsed.length : 0;
          fileCache.set(file, { mtimeMs: stat.mtimeMs, messageCount });
        }
      } catch {
        stat = null;
      }
      
      const m = meta[id] || {};
      sessions.push({
        id,
        name: m.name || defaultName(id),
        createdAt: m.createdAt || stat?.birthtimeMs || stat?.mtimeMs || Date.now(),
        updatedAt: m.updatedAt || stat?.mtimeMs || Date.now(),
        messageCount,
      });
    }
  } catch {
    // Directory operations
  }
  
  for (const id of Object.keys(meta)) {
    if (sessions.find(s => s.id === id)) continue;
    sessions.push({
      id,
      name: meta[id].name || defaultName(id),
      createdAt: meta[id].createdAt || Date.now(),
      updatedAt: meta[id].updatedAt || meta[id].createdAt || Date.now(),
      messageCount: 0,
    });
  }
  
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions;
}

export async function getSession(id) {
  const sessions = await listSessions();
  return sessions.find(s => s.id === id) || null;
}

export async function renameSession(id, name) {
  if (!UUID_RE.test(id)) throw new Error('Session ID tidak valid.');
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Nama sesi tidak boleh kosong.');
  
  const meta = await loadMeta();
  const now = Date.now();
  
  meta[id] = {
    name: trimmed,
    createdAt: meta[id]?.createdAt || now,
    updatedAt: now,
  };
  
  await saveMeta(meta);
  return { name: trimmed, updatedAt: now };
}

export async function deleteSession(id) {
  if (!UUID_RE.test(id)) throw new Error('Session ID tidak valid.');
  
  let deletedFiles = 0;
  try {
    const files = await fs.readdir(MEMORY_DIR);
    
    for (const file of files) {
      if (file === `${id}.json` || file.startsWith(`${id}_bg_`)) {
        await fs.unlink(path.join(MEMORY_DIR, file)).catch(() => {});
        fileCache.delete(file);
        deletedFiles++;
      }
    }
  } catch {
    // Directory operations
  }
  
  sessionCache.delete(id);
  
  const meta = await loadMeta();
  if (meta[id]) {
    delete meta[id];
    await saveMeta(meta);
  }
  
  return { deletedFiles };
}

export async function touchSession(id, firstPrompt = null) {
  if (!UUID_RE.test(id)) return;
  
  const meta = await loadMeta();
  const now = Date.now();
  
  let name = meta[id]?.name;
  if ((!name || name.startsWith('Sesi ')) && firstPrompt) {
    const autoTitle = generateTitleFromPrompt(firstPrompt);
    if (autoTitle) name = autoTitle;
  }
  
  meta[id] = {
    name: name || defaultName(id),
    createdAt: meta[id]?.createdAt || now,
    updatedAt: now,
  };
  
  await saveMeta(meta);
}

// ============================================================================
// MESSAGE STORAGE
// ============================================================================

export async function loadSession(sessionId) {
  const cached = sessionCache.get(sessionId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return [...cached.data];
  }
  sessionCache.delete(sessionId);
  
  try {
    const file = path.join(MEMORY_DIR, `${sessionId}.json`);
    const content = await fs.readFile(file, 'utf8');
    const data = JSON.parse(content);
    touchCache(sessionId, data);
    return [...data];
  } catch {
    return [];
  }
}

export async function saveSession(sessionId, messages) {
  touchCache(sessionId, messages);
  
  const file = path.join(MEMORY_DIR, `${sessionId}.json`);
  await fs.writeFile(file, JSON.stringify(messages, null, 2));
}

export function invalidateSessionCache(sessionId) {
  sessionCache.delete(sessionId);
}

// ============================================================================
// FACTS MANAGEMENT
// ============================================================================

const MAX_FACTS_PER_SESSION = 40;

export async function rememberFact(sessionId, fact) {
  const trimmed = (fact || '').trim();
  if (!trimmed) return { ok: false, error: 'Fakta kosong' };
  
  const factsPath = path.join(MEMORY_DIR, `${sessionId}.facts.json`);
  let facts = [];
  
  try {
    const raw = await fs.readFile(factsPath, 'utf8');
    const parsed = JSON.parse(raw);
    facts = Array.isArray(parsed) ? parsed : [];
  } catch {
    facts = [];
  }
  
  if (facts.some(f => f.fact.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: true, deduped: true, total: facts.length };
  }
  
  facts.push({ fact: trimmed, savedAt: Date.now() });
  while (facts.length > MAX_FACTS_PER_SESSION) facts.shift();
  
  await fs.writeFile(factsPath, JSON.stringify(facts, null, 2));
  return { ok: true, deduped: false, total: facts.length };
}

export async function listFacts(sessionId) {
  const factsPath = path.join(MEMORY_DIR, `${sessionId}.facts.json`);
  try {
    const raw = await fs.readFile(factsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function forgetFact(sessionId, factText) {
  const factsPath = path.join(MEMORY_DIR, `${sessionId}.facts.json`);
  const target = (factText || '').trim().toLowerCase();
  
  let facts = [];
  try {
    const raw = await fs.readFile(factsPath, 'utf8');
    const parsed = JSON.parse(raw);
    facts = Array.isArray(parsed) ? parsed : [];
  } catch {
    facts = [];
  }
  
  const filtered = facts.filter(f => f.fact.toLowerCase() !== target);
  const removed = filtered.length !== facts.length;
  
  if (removed) {
    await fs.writeFile(factsPath, JSON.stringify(filtered, null, 2));
  }
  
  return { ok: true, removed };
}

export async function formatFactsForPrompt(sessionId) {
  const facts = await listFacts(sessionId);
  if (!facts.length) return '';
  const lines = facts.map(f => `- ${f.fact}`).join('\n');
  return `[FAKTA TERSIMPAN — sesi ini]\n${lines}`;
}

// ============================================================================
// SESSION SEARCH
// ============================================================================

export async function searchHistory(query, { excludeSessionId = null, limit = 5 } = {}) {
  const q = (query || '').trim();
  if (!q) return [];
  
  const sessions = await listSessions();
  const results = [];
  const keywords = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (!keywords.length) return [];
  
  for (const session of sessions) {
    if (excludeSessionId && session.id === excludeSessionId) continue;
    
    const messages = await loadSession(session.id);
    if (!messages.length) continue;
    
    let bestScore = 0;
    let bestMsg = null;
    
    for (const m of messages) {
      const content = (m.content || '').toLowerCase();
      if (!content) continue;
      
      const score = keywords.reduce((acc, kw) => 
        acc + (content.includes(kw) ? 1 : 0), 0);
      
      if (score > bestScore) {
        bestScore = score;
        bestMsg = m;
      }
    }
    
    if (bestScore > 0 && bestMsg) {
      const excerptRaw = bestMsg.content.length > 220 
        ? bestMsg.content.slice(0, 220) + '...'
        : bestMsg.content;
      
      results.push({
        sessionId: session.id,
        title: session.name || defaultName(session.id),
        score: bestScore,
        excerpt: excerptRaw,
        timestamp: bestMsg.timestamp || null,
      });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ============================================================================
// MIGRATION
// ============================================================================

export async function migrateFromJSON() {
  const sessions = await listSessions();
  console.log(`✅ Memory system ready: ${sessions.length} sessions found`);
  return { status: 'ok', type: 'json-enhanced', sessionCount: sessions.length };
}

export default {
  databaseType: 'JSON (enhanced)',
  hasSQLite: false,
};
