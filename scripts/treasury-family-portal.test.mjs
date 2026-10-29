import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../family-account.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../assets/js/family-account.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261029130000_add_family_account_portal.sql", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../_data/navigation.yml", import.meta.url), "utf8");

test("family portal is easy to find and uses the Pack 3963 design", () => {
  assert.match(navigation, /name: Family Account[\s\S]*url: \/family-account\.html/);
  assert.match(page, /Pack 3963 Family Account/);
  assert.match(page, /cubscoutlogo\.png/);
  assert.match(page, /Charges and payments/);
  assert.match(page, /Official documents/);
});

test("family sign-in uses a one-time email link and does not require a member ID", () => {
  assert.match(script, /signInWithOtp/);
  assert.match(script, /shouldCreateUser:\s*true/);
  assert.match(script, /get_family_account_portal/);
  assert.doesNotMatch(page, /type="password"/);
  assert.doesNotMatch(page, /name="member_id"/);
});

test("portal access is derived from the verified session email without broad table policies", () => {
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /auth\.jwt\(\) ->> 'email'/);
  assert.match(migration, /lower\(trim\(contact\.email\)\) = portal_email/);
  assert.match(migration, /revoke all on function public\.get_family_account_portal\(\) from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.get_family_account_portal\(\) to authenticated/);
  assert.doesNotMatch(migration, /create policy/);
});

test("family portal points payment questions to official invoices instead of publishing Zelle details", () => {
  assert.match(page, /official invoice includes the current Pack payment instructions/i);
  assert.match(script, /\/invoice\/\?token=/);
  assert.doesNotMatch(page + script, /347-512-0685|Zelle to/);
});
