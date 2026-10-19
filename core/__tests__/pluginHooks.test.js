/**
 * Test untuk core/pluginHooks.js — fokus ke fitur BARU: matcher filtering
 * (sebelumnya didokumentasikan tapi tidak pernah dicek) dan lifecycle
 * PreToolUse/PostToolUse (sebelumnya cuma SessionStart + UserPromptSubmit).
 *
 * Modul ini menghitung PLUGINS_DIR dari process.cwd() SAAT MODULE DI-IMPORT
 * (bukan dinamis tiap panggilan) — jadi tiap test chdir ke folder fixture
 * SEBELUM melakukan dynamic import dengan query cache-bust, supaya modul
 * dievaluasi ulang dengan cwd yang benar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

function makePluginWithHooks(dir, pluginId, hooksJson) {
  const hooksDir = path.join(dir, "plugins", pluginId, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, "hooks.json"), JSON.stringify(hooksJson, null, 2));
}

function trustPlugin(dir, pluginId) {
  fs.mkdirSync(path.join(dir, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugins", ".trusted-hooks.json"), JSON.stringify({ trusted: [pluginId] }));
}

async function importFresh() {
  return import(`../pluginHooks.js?t=${Date.now()}-${Math.random()}`);
}

test("pluginHooks: PreToolUse deny memblokir tool sesuai matcher, tool lain tidak kena", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-hooks-test-"));
  makePluginWithHooks(dir, "guard", {
    PreToolUse: [
      {
        matcher: "bash",
        hooks: [{
          type: "command",
          command: "echo '{\"hookSpecificOutput\":{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"bash diblokir demo\"}}'",
        }],
      },
    ],
  });
  trustPlugin(dir, "guard");

  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    const mod = await importFresh();
    const blocked = await mod.runPreToolUseHooks({ sessionId: "s1", cwd: dir, toolName: "bash", toolInput: { command: "ls" } });
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.reason.includes("bash diblokir demo"));

    const notBlocked = await mod.runPreToolUseHooks({ sessionId: "s1", cwd: dir, toolName: "read_file", toolInput: {} });
    assert.equal(notBlocked.allowed, true, "matcher 'bash' tidak boleh berlaku untuk tool lain");
  } finally {
    process.chdir(prevCwd);
  }
});

test("pluginHooks: PostToolUse mengumpulkan additionalContext", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-hooks-test-"));
  makePluginWithHooks(dir, "linter", {
    PostToolUse: [
      {
        matcher: "write_file",
        hooks: [{ type: "command", command: "echo '{\"additionalContext\":\"lint: 0 masalah\"}'" }],
      },
    ],
  });
  trustPlugin(dir, "linter");

  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    const mod = await importFresh();
    const ctx = await mod.runPostToolUseHooks({ sessionId: "s1", cwd: dir, toolName: "write_file", toolInput: {}, toolResponse: "ok" });
    assert.ok(ctx.includes("lint: 0 masalah"));

    const ctxOtherTool = await mod.runPostToolUseHooks({ sessionId: "s1", cwd: dir, toolName: "bash", toolInput: {}, toolResponse: "ok" });
    assert.equal(ctxOtherTool, "", "matcher 'write_file' tidak boleh berlaku untuk tool lain");
  } finally {
    process.chdir(prevCwd);
  }
});

test("pluginHooks: tanpa plugin trusted, PreToolUse selalu allowed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-hooks-test-"));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    const mod = await importFresh();
    const decision = await mod.runPreToolUseHooks({ sessionId: "s1", cwd: dir, toolName: "bash", toolInput: {} });
    assert.equal(decision.allowed, true);
  } finally {
    process.chdir(prevCwd);
  }
});
