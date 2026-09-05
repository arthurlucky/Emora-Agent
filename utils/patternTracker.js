import fs from "fs/promises";
import path from "path";

const FACTORY_DIR = "./skill_factory";
const PATTERNS_FILE = path.join(FACTORY_DIR, "patterns.json");
export const SKILL_THRESHOLD = 5; // Berapa kali pattern muncul sebelum disarankan jadi skill

// ==========================================
// PERSISTENCE (ATOMIC & QUEUED)
// ==========================================

let _queue = Promise.resolve();

async function enqueue(taskFn) {
  const run = _queue.then(taskFn, taskFn); // always run even if previous failed
  _queue = run.catch(() => {});
  return run;
}

async function ensureDir() {
  await fs.mkdir(FACTORY_DIR, { recursive: true });
}

async function loadPatterns() {
  try {
    const raw = await fs.readFile(PATTERNS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { patterns: {} };
  }
}

async function savePatterns(data) {
  await ensureDir();
  const tmpFile = `${PATTERNS_FILE}.${Date.now()}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2));
  await fs.rename(tmpFile, PATTERNS_FILE); // Atomic write
}
// PATTERN KEY
// Tool sequence direpresentasikan sebagai string: "tool_a>tool_b>tool_c"
// ==========================================

export function buildKey(toolSequence) {
  return toolSequence.join(">");
}

// ==========================================
// RECORD - Dipanggil setiap kali ask() selesai dengan tool calls
// ==========================================

export async function recordToolSequence(sessionId, toolSequence) {
  if (!toolSequence || toolSequence.length < 2) return null;

  return enqueue(async () => {
    const data = await loadPatterns();
    const key = buildKey(toolSequence);

    if (!data.patterns[key]) {
      data.patterns[key] = {
        sequence: toolSequence,
        count: 0,
        sessions: [],
        first_seen: Date.now(),
        last_seen: null,
        skill_created: false,
        skill_name: null,
      };
    }

    const p = data.patterns[key];
    p.count++;
    p.last_seen = Date.now();

    if (!p.sessions.includes(sessionId)) {
      p.sessions.push(sessionId);
    }

    await savePatterns(data);

    if (p.count === SKILL_THRESHOLD && !p.skill_created) {
      return { key, pattern: p };
    }
    return null;
  });
}

// ==========================================
// READ
// ==========================================

export async function getPatterns() {
  const data = await loadPatterns();
  return data.patterns;
}

export async function getPatternByKey(key) {
  const data = await loadPatterns();
  return data.patterns[key] || null;
}

// ==========================================
// WRITE
// ==========================================

export async function markSkillCreated(key, skillName) {
  return enqueue(async () => {
    const data = await loadPatterns();
    if (data.patterns[key]) {
      data.patterns[key].skill_created = true;
      data.patterns[key].skill_name = skillName;
    }
    await savePatterns(data);
  });
}

export async function resetPatternCount(key) {
  return enqueue(async () => {
    const data = await loadPatterns();
    if (data.patterns[key]) {
      data.patterns[key].count = 0;
      data.patterns[key].skill_created = false;
      data.patterns[key].skill_name = null;
    }
    await savePatterns(data);
  });
}

export async function deletePattern(key) {
  return enqueue(async () => {
    const data = await loadPatterns();
    delete data.patterns[key];
    await savePatterns(data);
  });
}
