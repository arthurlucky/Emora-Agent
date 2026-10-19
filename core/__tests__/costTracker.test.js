/**
 * Test untuk core/costTracker.js — pakai node:test (built-in, no dep).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { recordUsage, getSessionCost, getGlobalCost, extractUsage } from "../costTracker.js";

function withTempCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cost-tracker-test-"));
  const prevCwd = process.cwd();
  process.chdir(dir);
  return fn().finally(() => process.chdir(prevCwd));
}

test("extractUsage: bentuk usage_metadata (Anthropic/OpenAI-native)", () => {
  const r = extractUsage({ usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
  assert.deepEqual(r, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
});

test("extractUsage: bentuk response_metadata.tokenUsage (beberapa provider LangChain lain)", () => {
  const r = extractUsage({ response_metadata: { tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } } });
  assert.deepEqual(r, { inputTokens: 20, outputTokens: 10, totalTokens: 30 });
});

test("extractUsage: tidak ada info usage -> null", () => {
  assert.equal(extractUsage({}), null);
});

test("recordUsage: akumulasi per sesi & global, per model", async () => {
  await withTempCwd(async () => {
    await recordUsage("s1", { usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }, "gpt-4o-mini");
    await recordUsage("s1", { usage_metadata: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } }, "gpt-4o-mini");
    await recordUsage("s2", { usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }, "claude-sonnet");

    const s1 = await getSessionCost("s1");
    assert.equal(s1.totalTokens, 45);
    assert.equal(s1.calls, 2);
    assert.equal(s1.byModel["gpt-4o-mini"], 45);

    const s2 = await getSessionCost("s2");
    assert.equal(s2.totalTokens, 2);

    const global_ = await getGlobalCost();
    assert.equal(global_.totalTokens, 47); // 45 (s1) + 2 (s2)
    assert.equal(global_.calls, 3);
  });
});

test("getSessionCost: sesi belum pernah dicatat -> record kosong", async () => {
  await withTempCwd(async () => {
    const rec = await getSessionCost("belum-pernah-ada");
    assert.equal(rec.calls, 0);
    assert.equal(rec.totalTokens, 0);
  });
});
