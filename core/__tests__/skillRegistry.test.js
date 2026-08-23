/**
 * Test untuk core/skillRegistry.js — frontmatter + categories + list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import skillRegistry from "../skillRegistry.js";

test("listAll: built-in skills have categories (or empty array)", async () => {
  const all = await skillRegistry.listAll();
  const builtin = all.filter((s) => s.source === "builtin");
  assert.ok(builtin.length > 0, "should have built-in skills");
  for (const s of builtin) {
    assert.ok(Array.isArray(s.categories), `categories must be array, got ${typeof s.categories} for ${s.name}`);
  }
});

test("toCatalogLine: includes categories when present", () => {
  const line = skillRegistry.toCatalogLine({
    slashName: "test",
    kind: "skill",
    description: "hello",
    categories: ["devops", "productivity"],
  });
  assert.ok(line.includes("{devops,productivity}"), `expected categories in line: ${line}`);
  assert.ok(line.includes("hello"));
});

test("toCatalogLine: omits categories when empty", () => {
  const line = skillRegistry.toCatalogLine({
    slashName: "test",
    kind: "skill",
    description: "hello",
    categories: [],
  });
  assert.ok(!line.includes("{"), `should not have category braces: ${line}`);
});
