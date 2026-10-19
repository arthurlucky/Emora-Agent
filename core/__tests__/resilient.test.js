import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryableError, withRetry, callWithFallback, fallbackList } from "../../provider/resilient.js";

test("429 & timeout retryable, 400 tidak", () => {
  assert.equal(isRetryableError({ status: 429 }), true);
  assert.equal(isRetryableError(new Error("timeout of 30000ms")), true);
  assert.equal(isRetryableError({ status: 400 }), false);
});

test("withRetry sukses setelah 1 gagal", async () => {
  let n = 0;
  const out = await withRetry(async () => {
    n++;
    if (n === 1) throw Object.assign(new Error("429 rate limit"), { status: 429 });
    return "ok";
  }, { retries: 2, baseDelayMs: 1, timeoutMs: 5000 });
  assert.equal(out, "ok");
  assert.equal(n, 2);
});

test("withRetry tidak retry error non-retryable", async () => {
  let n = 0;
  await assert.rejects(() => withRetry(async () => {
    n++;
    throw Object.assign(new Error("bad request"), { status: 400 });
  }, { retries: 2, baseDelayMs: 1 }));
  assert.equal(n, 1);
});

test("callWithFallback pindah ke cadangan", async () => {
  const res = await callWithFallback("utama", ["cadangan"], async (name) => {
    if (name === "utama") throw Object.assign(new Error("503 overload"), { status: 503 });
    return `hasil-${name}`;
  });
  assert.equal(res.profile, "cadangan");
  assert.equal(res.failedOver, true);
});

test("fallbackList parse env (max 5)", () => {
  process.env.FALLBACK_PROFILES = " a, b ,,c,d,e,f,g ";
  assert.deepEqual(fallbackList(), ["a", "b", "c", "d", "e"]);
  delete process.env.FALLBACK_PROFILES;
});
