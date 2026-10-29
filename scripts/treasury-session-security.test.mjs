import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "treasurer.js",
  "treasurer-orders.js",
  "treasurer-categories.js",
  "treasurer-transfers.mjs"
].map(name => readFileSync(new URL(`../assets/js/${name}`, import.meta.url), "utf8"));
const main = files[0];

test("every treasurer client shares a tab-only session", () => {
  for (const script of files) {
    assert.match(script, /storage:\s*window\.sessionStorage/);
    assert.match(script, /storageKey:\s*(?:AUTH_STORAGE_KEY|"pack3963-treasurer-session")/);
  }
});

test("treasurer access is cleared when the portal is left or refreshed", () => {
  assert.match(main, /localStorage\.removeItem\(LEGACY_AUTH_STORAGE_KEY\)/);
  assert.match(main, /addEventListener\("pagehide"/);
  assert.match(main, /sessionStorage\.removeItem\(AUTH_STORAGE_KEY\)/);
  assert.match(main, /signOut\(\{ scope: "local" \}\)/);
});
