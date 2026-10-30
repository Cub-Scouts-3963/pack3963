import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../auth-confirm.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../assets/js/auth-confirm.js", import.meta.url), "utf8");

test("branded confirmation page exchanges only approved portal links", () => {
  assert.match(page, /permalink: \/auth\/confirm\//);
  assert.match(page, /Secure Pack 3963 sign-in/);
  assert.match(script, /verifyOtp\(\{ token_hash: tokenHash, type \}\)/);
  assert.match(script, /new Set\(\["signup", "magiclink"\]\)/);
  assert.match(script, /"\/family-account\.html"/);
  assert.match(script, /"\/treasurer\.html"/);
  assert.doesNotMatch(script, /window\.location\.replace\(requestedNext\)/);
});

test("confirmation stores the session only in the destination portal tab", () => {
  assert.match(script, /storage: window\.sessionStorage/);
  assert.match(script, /storageKey: config\.storageKey/);
  assert.match(script, /detectSessionInUrl: false/);
});
