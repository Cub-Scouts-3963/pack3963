import test from "node:test";
import assert from "node:assert/strict";
import { HEADERS, purposeCatalog, templateRows, reviewRows, dateOnly, csvText, parseCsv } from "../assets/js/treasury-transfers.mjs";

const account = { id: "10000000-0000-4000-8000-000000000001", display_name: "Example Scout", account_type: "scout", parent_account_id: "10000000-0000-4000-8000-000000000002", active: true };
const family = { id: account.parent_account_id, display_name: "Example family", account_type: "household", active: true };
const campaign = { id: "20000000-0000-4000-8000-000000000001", name: "2026 Pack Class B T-shirts", category: "T-shirt", active: true };
const order = { id: "30000000-0000-4000-8000-000000000001", campaign_id: campaign.id, account_id: account.id, active: true };
const charge = { id: "40000000-0000-4000-8000-000000000001", account_id: account.id, order_item_id: order.id, entry_type: "charge", amount_cents: 1000, occurred_on: "2026-10-21", category: "T-shirt", description: campaign.name, voided_at: null };
const purposes = purposeCatalog([charge], [campaign]);
const context = { accounts: [account, family], entries: [charge], orders: [order], purposes };
const recordId = "50000000-0000-4000-8000-000000000001";
function row(type = "payment") { return templateRows({ ...context, purpose: purposes[0], type, date: "2026-10-21", makeId: () => recordId }).find(r => r[12] === account.id); }
function completed(changes = {}, type = "payment") { const r = row(type); r[5] = 10; for (const [key, value] of Object.entries(changes)) r[HEADERS.indexOf(key)] = value; return r; }
const review = (r, ctx = context) => reviewRows([HEADERS, r], ctx)[0];

test("catalog uses existing purpose names and preserves separate camping events", () => {
  const entries = [charge, ...["White Pines Food", "Spring Camping"].map(description => ({ ...charge, category: "Camping", description })), ...["Dues", "Pack fees"].map(category => ({ ...charge, category, description: "2026 Pack fees" }))];
  const catalog = purposeCatalog(entries, [campaign]);
  assert.equal(catalog.length, 4);
  assert.equal(catalog.filter(p => p.name === campaign.name).length, 1);
  assert.ok(catalog.some(p => p.name === "White Pines Food"));
  assert.ok(catalog.some(p => p.name === "Spring Camping"));
});

test("payment templates prefill identity and charge links but leave amounts blank", () => {
  const rows = templateRows({ ...context, purpose: purposes[0], type: "payment", date: "2026-10-21", makeId: () => recordId });
  assert.equal(rows.length, 1); assert.equal(rows[0][0], account.display_name); assert.equal(rows[0][1], family.display_name);
  assert.equal(rows[0][5], ""); assert.equal(rows[0][10], 10); assert.equal(rows[0][11], 10); assert.equal(rows[0][13], charge.id);
  assert.equal(review(rows[0]).status, "blank");
});

test("new-charge templates include each current Scout and family without guessing accounts", () => {
  const rows = templateRows({ ...context, accounts: [...context.accounts, { ...account, active: false }], purpose: purposes[0], type: "charge", date: "2026-10-21" });
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r[5] === "" && r[13] === ""));
  assert.equal(new Set(rows.map(r => r[14])).size, 2);
});

test("valid payments preserve order links and the saved category", () => {
  const result = review(completed({ "Payment method": "Cash", Reference: "receipt 15", Notes: "Thanks" }));
  assert.equal(result.status, "ready"); assert.equal(result.entry.order_item_id, order.id);
  assert.equal(result.entry.amount_cents, 1000); assert.equal(result.entry.category, "T-shirt");
  assert.equal(result.entry.payment_method, "cash"); assert.equal(result.entry.source_record_id, "portal-template:" + recordId);
});

test("credit rows remain credits and do not turn into payments", () => {
  assert.equal(review(completed({ "Entry type": "credit" })).entry.entry_type, "credit");
});

test("unknown, renamed, or inactive accounts are rejected", () => {
  assert.equal(review(completed({ "Account ID": "missing" })).status, "invalid");
  assert.equal(review(completed({ "Scout / account": "Different child" })).status, "invalid");
  assert.equal(review(completed(), { ...context, accounts: [{ ...account, active: false }] }).status, "invalid");
});

test("negative, zero, nonnumeric, and overprecision amounts are rejected", () => {
  for (const amount of [-10, 0, "($10.00)", "NaN", "1.234", "99999999999999", "=10+5"]) assert.equal(review(completed({ Amount: amount })).status, "invalid", String(amount));
  assert.equal(review(completed({ Amount: "$1,234.56" })).entry.amount_cents, 123456);
});

test("dates are explicit and invalid dates are never replaced with today", () => {
  for (const date of ["", "2/30/2026", "2026-02-29", "2026-13-01", "n/a"]) assert.equal(review(completed({ Date: date })).status, "invalid", date);
  assert.equal(dateOnly("2/29/2028"), "2028-02-29");
  assert.equal(dateOnly(new Date("2026-10-21T00:00:00Z")), "2026-10-21");
});

test("purposes, entry types, payment methods, and linked charges must be valid", () => {
  for (const changes of [{ "Charge purpose": "Unknown trip" }, { "Entry type": "balance" }, { "Payment method": "mystery" }, { "Related charge ID": "missing" }, { "Related charge ID": "" }]) assert.equal(review(completed(changes)).status, "invalid");
  assert.equal(review(completed(), { ...context, entries: [{ ...charge, voided_at: "2026-10-21" }] }).status, "invalid");
  assert.equal(review(completed({ "Entry type": "charge" })).status, "invalid");
});

test("repeat uploads skip unchanged records and reject changed amounts", () => {
  const posted = review(completed()).entry;
  const ctx = { ...context, entries: [...context.entries, posted] };
  assert.equal(review(completed(), ctx).status, "imported");
  assert.equal(review(completed({ Amount: 11 }), ctx).status, "invalid");
  assert.equal(review(completed(), { ...ctx, entries: [...context.entries, { ...posted, voided_at: "2026-10-21" }] }).status, "imported");
});

test("possible duplicates within the file or existing history start unselected", () => {
  const a = completed(), b = completed({ "Record ID": "50000000-0000-4000-8000-000000000002" });
  const rows = reviewRows([HEADERS, a, b], context);
  assert.equal(rows[0].status, "ready"); assert.equal(rows[1].status, "duplicate"); assert.equal(rows[1].selected, false);
  assert.equal(reviewRows([HEADERS, a, a], context)[2 - 1].status, "invalid");
  const posted = { ...rows[0].entry, source_record_id: "another-file" };
  assert.equal(review(a, { ...context, entries: [...context.entries, posted] }).status, "duplicate");
});

test("existing charges are flagged even if the template uses another posting date", () => {
  const result = review(completed({ Date: "2026-11-01" }, "charge"));
  assert.equal(result.status, "duplicate"); assert.equal(result.selected, false);
});

test("reports and formulas cannot be mistaken for entry templates", () => {
  assert.throws(() => reviewRows([["Date", "Amount", "Ledger ID"], ["2026-10-21", 10, "existing"]], context), /template/);
  assert.equal(review(completed({ Amount: { formula: "1+2", result: 3 } })).status, "invalid");
  assert.throws(() => reviewRows([HEADERS, ...Array.from({ length: 5001 }, () => row())], context), /5,000/);
});

test("CSV round trips quoted names, notes, dates, and identifiers safely", () => {
  const values = [["Name", "Notes"], ['Example, "Scout"', "Line 1\nLine 2"]];
  assert.deepEqual(parseCsv(csvText(values)), values);
  assert.match(csvText([["=HYPERLINK(1)", " @SUM(A1)"]]), /'=HYPERLINK/);
  assert.throws(() => parseCsv('"unfinished'), /unclosed/);
  const result = reviewRows(parseCsv(csvText([HEADERS, completed()])), context)[0];
  assert.equal(result.status, "ready");
});
