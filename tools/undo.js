/**
 * tools/undo.js
 *
 * Snapshot-based undo/redo. Setiap call write_file/patch record snapshot
 * ke .emora/undo/<session>/<ts>-<n>/<relpath>. Undo/redo pop dari stack.
 *
 * Stack disimpan di .emora/undo/_stack.json (per session).
 * Limit 50 snapshot per session, FIFO eviction.
 *
 * ponytail: full file copy per snapshot. Untuk file besar, ini boros.
 * Upgrade: simpan reverse diff (Myers) kalau size jadi masalah.
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

const UNDO_ROOT = ".emora/undo";
const STACK_FILE = (session) => path.join(UNDO_ROOT, session, "_stack.json");
const SNAP_DIR   = (session, id) => path.join(UNDO_ROOT, session, id);

const MAX_SNAPSHOTS = 50;

function getSession() {
  return process.env.EMORA_SESSION_ID || "_default";
}

async function readStack(session) {
  try {
    return JSON.parse(await fs.readFile(STACK_FILE(session), "utf-8"));
  } catch {
    return { undo: [], redo: [] };
  }
}

async function writeStack(session, stack) {
  await fs.mkdir(path.dirname(STACK_FILE(session)), { recursive: true });
  await fs.writeFile(STACK_FILE(session), JSON.stringify(stack, null, 2));
}

async function evictOldest(session, stack) {
  while (stack.undo.length > MAX_SNAPSHOTS) {
    const old = stack.undo.shift();
    try { await fs.rm(SNAP_DIR(session, old.id), { recursive: true, force: true }); } catch {}
  }
}

/**
 * Rekam snapshot SEBELUM perubahan. Dipanggil dari write_file & patch.
 * action: "write" | "patch" (untuk audit trail saja).
 * Kalau file belum ada (create baru), catat saja path tanpa snapshot.
 */
export async function recordSnapshot(filepath, action = "write") {
  const session = getSession();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const exists = fsSync.existsSync(filepath);

  await fs.mkdir(SNAP_DIR(session, id), { recursive: true });

  if (exists) {
    const content = await fs.readFile(filepath, "utf-8");
    const meta = { filepath, action, existed: true, ts: Date.now() };
    await fs.writeFile(path.join(SNAP_DIR(session, id), "content"), content);
    await fs.writeFile(path.join(SNAP_DIR(session, id), "meta.json"), JSON.stringify(meta));
  } else {
    const meta = { filepath, action, existed: false, ts: Date.now() };
    await fs.writeFile(path.join(SNAP_DIR(session, id), "meta.json"), JSON.stringify(meta));
  }

  const stack = await readStack(session);
  stack.undo.push({ id, filepath });
  stack.redo = [];  // any new action invalidates redo
  await evictOldest(session, stack);
  await writeStack(session, stack);
}

/**
 * Undo: ambil snapshot terbaru, restore file, pindahkan ke redo stack.
 * Return {ok, filepath, message} atau {ok:false, error}.
 */
export async function undo() {
  const session = getSession();
  const stack = await readStack(session);
  if (!stack.undo.length) return { ok: false, error: "Nothing to undo." };

  const top = stack.undo.pop();
  const snapDir = SNAP_DIR(session, top.id);
  const metaPath = path.join(snapDir, "meta.json");
  let meta;
  try { meta = JSON.parse(await fs.readFile(metaPath, "utf-8")); } catch {
    return { ok: false, error: `Snapshot ${top.id} corrupt (missing meta).` };
  }

  // Snapshot SEBELUM restore, supaya redo bisa restore kondisi "after-undo".
  const currentExists = fsSync.existsSync(meta.filepath);
  const currentContent = currentExists ? await fs.readFile(meta.filepath, "utf-8") : null;
  const redoId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const redoDir = SNAP_DIR(session, redoId);
  await fs.mkdir(redoDir, { recursive: true });
  await fs.writeFile(path.join(redoDir, "meta.json"),
    JSON.stringify({ filepath: meta.filepath, action: "redo-pre", existed: currentExists, ts: Date.now() }));
  if (currentContent !== null) {
    await fs.writeFile(path.join(redoDir, "content"), currentContent);
  }

  // Restore dari snapshot.
  const snapContent = path.join(snapDir, "content");
  if (meta.existed) {
    await fs.mkdir(path.dirname(meta.filepath), { recursive: true });
    await fs.copyFile(snapContent, meta.filepath);
  } else {
    // File dulu ada, sekarang di-undo artinya hapus.
    if (fsSync.existsSync(meta.filepath)) await fs.unlink(meta.filepath);
  }

  stack.redo.push({ id: redoId, filepath: meta.filepath });
  await writeStack(session, stack);
  await fs.rm(snapDir, { recursive: true, force: true });

  return { ok: true, filepath: meta.filepath, message: `Undone: restored ${meta.filepath}` };
}

export async function redo() {
  const session = getSession();
  const stack = await readStack(session);
  if (!stack.redo.length) return { ok: false, error: "Nothing to redo." };

  const top = stack.redo.pop();
  const snapDir = SNAP_DIR(session, top.id);
  let meta;
  try { meta = JSON.parse(await fs.readFile(path.join(snapDir, "meta.json"), "utf-8")); } catch {
    return { ok: false, error: `Redo snapshot ${top.id} corrupt.` };
  }

  // Snapshot kondisi sekarang (akan jadi undo entry).
  const currentExists = fsSync.existsSync(meta.filepath);
  const currentContent = currentExists ? await fs.readFile(meta.filepath, "utf-8") : null;
  const undoId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const undoDir = SNAP_DIR(session, undoId);
  await fs.mkdir(undoDir, { recursive: true });
  await fs.writeFile(path.join(undoDir, "meta.json"),
    JSON.stringify({ filepath: meta.filepath, action: "redo-post", existed: currentExists, ts: Date.now() }));
  if (currentContent !== null) {
    await fs.writeFile(path.join(undoDir, "content"), currentContent);
  }

  // Restore dari redo snapshot.
  const snapContent = path.join(snapDir, "content");
  if (meta.existed) {
    await fs.mkdir(path.dirname(meta.filepath), { recursive: true });
    await fs.copyFile(snapContent, meta.filepath);
  } else {
    if (fsSync.existsSync(meta.filepath)) await fs.unlink(meta.filepath);
  }

  stack.undo.push({ id: undoId, filepath: meta.filepath });
  await writeStack(session, stack);
  await fs.rm(snapDir, { recursive: true, force: true });

  return { ok: true, filepath: meta.filepath, message: `Redone: restored ${meta.filepath}` };
}

// ─── LangChain tool exports ───────────────────────────────────────────
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const undoTool = new DynamicStructuredTool({
  name: "undo",
  description: "Batalkan perubahan file terakhir (write_file atau patch). Pakai snapshot yang direkam otomatis. Setiap new edit akan meng-invalidate redo stack.",
  schema: z.object({}),
  func: async () => {
    const r = await undo();
    return r.ok ? r.message : `❌ ${r.error}`;
  },
});

const redoTool = new DynamicStructuredTool({
  name: "redo",
  description: "Ulangi perubahan yang di-undo. Hanya bekerja jika tidak ada edit baru sejak undo terakhir.",
  schema: z.object({}),
  func: async () => {
    const r = await redo();
    return r.ok ? r.message : `❌ ${r.error}`;
  },
});

export { undoTool, redoTool };
