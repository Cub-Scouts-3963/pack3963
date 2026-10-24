import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { invoiceDueDate } from "../cloudflare/pack3963-treasury-email/worker.js";

test("invoice due date uses the latest selected charge due date", () => {
  const activity = [
    { entry_type: "charge", due_on: "2026-10-24" },
    { entry_type: "payment", due_on: "2026-11-20" },
    { entry_type: "charge", due_on: "2026-10-31" }
  ];
  assert.equal(invoiceDueDate("", activity, "2026-10-23"), "2026-10-31");
  assert.equal(invoiceDueDate("2026-11-05", activity, "2026-10-23"), "2026-11-05");
});

test("invoice due date falls back to fourteen days after issue", () => {
  assert.equal(invoiceDueDate("", [], "2026-10-23"), "2026-11-06");
});

test("official invoice page contains required Pack letterhead and print footer", () => {
  const html = readFileSync(new URL("../invoice.html", import.meta.url), "utf8");
  assert.match(html, /Pack 3963/);
  assert.match(html, /Pathway to Adventure Council/);
  assert.match(html, /Scouting America/);
  assert.match(html, /c\/o Eden United Church of Christ/);
  assert.match(html, /5051 W\. Gunnison Street/);
  assert.match(html, /invoice-print-footer/);
});

test("invoice numbers are allocated by the database instead of random UUIDs", () => {
  const worker = readFileSync(new URL("../cloudflare/pack3963-treasury-email/worker.js", import.meta.url), "utf8");
  assert.match(worker, /rpc\/next_pack_invoice_number/);
  assert.doesNotMatch(worker, /randomUUID\(\)\.replaceAll/);
});
