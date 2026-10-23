import test from "node:test";
import assert from "node:assert/strict";
import { driveFolderName, driveReceiptFilename, driveInvoiceFilename, invoiceDocumentHtml } from "../cloudflare/pack3963-auth-email/worker.js";

test("Drive month folders follow the expense date rather than upload time", () => {
  assert.equal(driveFolderName("2026-09-17"), "September 2026");
  assert.equal(driveFolderName("2026-10-23"), "October 2026");
  assert.throws(() => driveFolderName("09/17/2026"), /valid purchase date/);
});

test("Drive receipt names match the expense and preserve a safe extension", () => {
  const expense = {
    purchased_on: "2026-09-17",
    vendor: "Scout Store / Arlington Heights",
    category: "Awards & Patches",
    amount_cents: 8427
  };
  const receipt = { original_filename: "phone upload.PDF", content_type: "application/pdf" };
  assert.equal(
    driveReceiptFilename(expense, receipt),
    "2026-09-17 - Scout Store - Arlington Heights - Awards & Patches - $84.27.pdf"
  );
});

test("Drive receipt names use descriptions and MIME types as fallbacks", () => {
  const expense = { purchased_on: "2026-10-23", vendor: "Pathway to Adventure", description: "Pushmobile registration", amount_cents: 9888 };
  const receipt = { original_filename: "receipt", content_type: "image/png" };
  assert.equal(
    driveReceiptFilename(expense, receipt),
    "2026-10-23 - Pathway to Adventure - Pushmobile registration - $98.88.png"
  );
});


test("Drive invoice files live under readable family names", () => {
  const invoice = {
    id: "12345678-1234-4123-8123-123456789abc",
    invoice_date: "2026-10-23",
    invoice_number: "P3963-20261023-ABC12345-DEF0",
    family_name: "Weninger family",
    balance_cents: 5000,
    body_text: "Please review this balance.",
    support_email: "cubscouts3963@gmail.com",
    line_items: [{ occurred_on: "2026-10-23", account_name: "Benjamin Weninger", description: "Pack fees", category: "Dues", entry_type: "charge", amount_cents: 5000 }]
  };
  assert.equal(
    driveInvoiceFilename(invoice),
    "2026-10-23 - Weninger family - Invoice P3963-20261023-ABC12345-DEF0"
  );
  const html = invoiceDocumentHtml(invoice);
  assert.match(html, /Weninger family/);
  assert.match(html, /Pack fees/);
  assert.match(html, /\$50\.00/);
});
