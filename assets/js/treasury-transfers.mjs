export const HEADERS = ["Scout / account", "Family", "Account type", "Charge purpose", "Entry type", "Amount", "Date", "Payment method", "Reference", "Notes", "Existing charge", "Amount due", "Account ID", "Related charge ID", "Record ID"];
export const METHODS = ["cash", "zelle", "venmo", "check", "card", "bank_transfer", "other"];
const text = v => String(v ?? "").trim();
const key = v => text(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(v));
const categoryKey = v => /^(dues|packfees?)$/.test(key(v)) ? "packfees" : key(v);

export function purposeCatalog(entries, campaigns = []) {
  const purposes = campaigns.filter(c => c.active).map(c => ({ id: "campaign:" + c.id, name: c.name, category: c.category, campaignId: c.id }));
  for (const entry of entries.filter(e => e.entry_type === "charge" && !e.voided_at)) {
    if (purposes.some(p => p.campaignId && categoryKey(p.category) === categoryKey(entry.category))) continue;
    const category = entry.category || "Other";
    const name = entry.description.split(" — ")[0];
    const id = "category:" + categoryKey(category) + ":" + (categoryKey(category) === "packfees" ? "annual" : key(name));
    if (!purposes.some(p => p.id === id)) purposes.push({ id, name, category, campaignId: null });
  }
  return purposes.sort((a, b) => a.name.localeCompare(b.name));
}

export function chargeMatches(entry, purpose, orders) {
  if (entry.entry_type !== "charge" || entry.voided_at || categoryKey(entry.category) !== categoryKey(purpose.category)) return false;
  if (purpose.campaignId) return orders.some(o => o.id === entry.order_item_id && o.campaign_id === purpose.campaignId);
  return categoryKey(purpose.category) === "packfees" || key(entry.description.split(" — ")[0]) === key(purpose.name);
}

export function templateRows({ accounts, entries, orders, purpose, type, accountType = "all", date, makeId = () => crypto.randomUUID() }) {
  const eligible = accounts.filter(a => a.active && ["scout", "household"].includes(a.account_type) && (accountType === "all" || a.account_type === accountType));
  const rows = [];
  for (const account of eligible.sort((a, b) => a.display_name.localeCompare(b.display_name))) {
    const charges = type === "charge" ? [null] : entries.filter(e => e.account_id === account.id && chargeMatches(e, purpose, orders));
    for (const charge of charges) {
      const paid = charge?.order_item_id ? entries.filter(e => !e.voided_at && e.order_item_id === charge.order_item_id && e.entry_type !== "charge").reduce((s, e) => s + Number(e.amount_cents), 0) : null;
      const family = accounts.find(a => a.id === account.parent_account_id);
      rows.push([account.display_name, family?.display_name || (account.account_type === "household" ? account.display_name : account.household_name || ""), account.account_type, purpose.name, type, "", date, "", "", "", charge ? Number(charge.amount_cents) / 100 : "", charge && paid != null ? Math.max(0, Number(charge.amount_cents) - paid) / 100 : "", account.id, charge?.id || "", makeId()]);
    }
  }
  return rows;
}

export function csvText(rows) {
  return "\uFEFF" + rows.map(row => row.map(value => {
    let s = String(value ?? "");
    if (/^\s*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");
}

export function parseCsv(value) {
  const rows = []; let row = [], field = "", quoted = false;
  const input = String(value).replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted && c === '"' && input[i + 1] === '"') { field += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { row.push(field); field = ""; }
    else if (/[\r\n]/.test(c) && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field); if (row.some(text)) rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  let s = text(value), match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) s = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + "T00:00:00Z")) || new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s) throw new Error("Enter a valid date (YYYY-MM-DD or MM/DD/YYYY).");
  return s;
}

function amountCents(value) {
  const s = text(value).replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("Amount must be positive, with no more than two decimal places.");
  const n = Math.round(Number(s) * 100);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 2147483647) throw new Error("Amount is outside the supported range.");
  return n;
}

export function sameTransaction(a, b) {
  return a.account_id === b.account_id && a.entry_type === b.entry_type && Number(a.amount_cents) === Number(b.amount_cents) && a.occurred_on === b.occurred_on && categoryKey(a.category) === categoryKey(b.category) && (a.reference || "") === (b.reference || "") && (a.payment_method || "") === (b.payment_method || "") && (a.order_item_id || null) === (b.order_item_id || null);
}

export function reviewRows(matrix, { accounts, entries, orders, purposes }) {
  if (matrix.length < 2) throw new Error("The file has no entry rows.");
  if (matrix.length > 5001) throw new Error("Import no more than 5,000 rows at a time.");
  const headers = matrix[0].map(text);
  if (HEADERS.some(h => !headers.includes(h))) throw new Error("Choose a completed Pack entry template. Reports and arbitrary spreadsheets cannot be posted as entries.");
  if (new Set(headers).size !== headers.length) throw new Error("The file contains duplicate column headings.");
  const seen = new Set(), planned = [];
  return matrix.slice(1).map((values, i) => {
    const row = Object.fromEntries(headers.map((h, j) => [h, values[j] ?? ""]));
    const result = { line: i + 2, name: text(row["Scout / account"]), purpose: text(row["Charge purpose"]), selected: false, status: "blank", message: "Blank amount — ignored", raw: row };
    if (!["Amount", "Payment method", "Reference", "Notes"].some(h => text(row[h]))) return result;
    try {
      if (values.length > headers.length) throw new Error("This row has more columns than the template.");
      if (values.some(v => v && typeof v === "object" && !(v instanceof Date))) throw new Error("Replace formulas or rich objects with plain values before importing.");
      const account = accounts.find(a => a.id === text(row["Account ID"]));
      if (!account?.active) throw new Error("Account ID is missing, unknown, or inactive. Download a fresh template.");
      if (key(account.display_name) !== key(row["Scout / account"])) throw new Error("Name does not match Account ID. Do not change the prefilled account.");
      const purpose = purposes.find(p => key(p.name) === key(row["Charge purpose"]));
      if (!purpose) throw new Error("Charge purpose is not in the current portal list.");
      const type = text(row["Entry type"]).toLowerCase();
      if (!["charge", "payment", "credit"].includes(type)) throw new Error("Entry type must be charge, payment, or credit.");
      const recordId = text(row["Record ID"]);
      if (!uuid(recordId)) throw new Error("Record ID is missing or changed. Download a fresh template.");
      if (seen.has(recordId)) throw new Error("Record ID is repeated in this file. Use a fresh template for another entry.");
      seen.add(recordId);
      const method = text(row["Payment method"]).toLowerCase().replace(/ /g, "_");
      if (method && !METHODS.includes(method)) throw new Error("Choose cash, zelle, venmo, check, card, bank_transfer, or other.");
      const chargeId = text(row["Related charge ID"]);
      const charge = chargeId ? entries.find(e => e.id === chargeId) : null;
      if (chargeId && (!charge || charge.account_id !== account.id || !chargeMatches(charge, purpose, orders))) throw new Error("The related charge no longer matches this account/purpose. Download a fresh template.");
      if (type === "charge" && chargeId) throw new Error("Use a new-charge template to add a charge.");
      if (type !== "charge" && !charge) throw new Error("Use a payment/credit template tied to an existing charge.");
      const entry = { account_id: account.id, entry_type: type, amount_cents: amountCents(row.Amount), occurred_on: dateOnly(row.Date), description: purpose.name, category: charge?.category || purpose.category, payment_method: method || null, reference: text(row.Reference) || null, notes: text(row.Notes) || null, source: "other_import", source_record_id: "portal-template:" + recordId, order_item_id: charge?.order_item_id || null };
      if ([entry.reference || "", entry.notes || ""].some(v => v.length > 4000)) throw new Error("Reference or notes are too long.");
      const posted = entries.find(e => e.source === entry.source && e.source_record_id === entry.source_record_id);
      if (posted) {
        if (!sameTransaction(posted, entry) || posted.description !== entry.description || (posted.notes || "") !== (entry.notes || "")) throw new Error("This Record ID was already imported with different values. Correct the posted entry or download a fresh template.");
        return { ...result, entry, status: "imported", message: posted.voided_at ? "Previously imported, then removed — not posted again" : "Already imported — skipped" };
      }
      const possible = [...entries, ...planned].some(e => !e.voided_at && (sameTransaction(e, entry) || (type === "charge" && e.entry_type === "charge" && e.account_id === account.id && chargeMatches(e, purpose, orders) && Number(e.amount_cents) === entry.amount_cents)));
      planned.push(entry);
      return { ...result, entry, selected: !possible, status: possible ? "duplicate" : "ready", message: possible ? "Possible duplicate — excluded unless you select it" : "Ready" };
    } catch (error) { return { ...result, status: "invalid", message: error.message }; }
  });
}

export function workbookTemplate(ExcelJS, rows, purposes) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Entries", { views: [{ state: "frozen", xSplit: 3, ySplit: 1, showGridLines: false }] });
  sheet.addRows([HEADERS, ...rows]);
  sheet.columns.forEach((column, i) => { column.width = [28, 28, 15, 42, 15, 14, 16, 18, 22, 36, 18, 18, 39, 39, 39][i]; });
  sheet.autoFilter = { from: "A1", to: "O" + (rows.length + 1) };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF004B8D" } }; cell.font = { color: { argb: "FFFFFFFF" }, bold: true, name: "Arial", size: 10 }; });
  [13, 14, 15].forEach(i => { sheet.getColumn(i).hidden = true; });
  [6, 11, 12].forEach(i => { sheet.getColumn(i).numFmt = '$#,##0.00'; });
  sheet.getColumn(7).numFmt = "yyyy-mm-dd";
  const guide = book.addWorksheet("Help");
  guide.addRows([
    ["Pack 3963 entry template", ""],
    ["Fill in", "Enter Amount, Date, and optional Payment method, Reference, and Notes. Leave unused amounts blank."],
    ["Account and purpose", "Names, families, and charge purposes come from the portal. Keep the prefilled identity fields and hidden IDs unchanged."],
    ["Save and upload", "Save this workbook and upload it under Import. Review the selected rows and totals before posting."],
    ["Additional entries", "Download another template for another payment or charge. Do not reuse an imported row for a different transaction."],
    ["Existing amounts", "Existing charge and Amount due are reference-only. Amount due is shown only where payments can be linked to an order."],
    ["Reports", "Reports are for review/export, not re-import. Entries add transactions; they do not overwrite balances or existing history."],
    ["Pack expenses", "Enter vendor purchases under Expenses & receipts. This template is for charges, payments, and credits against Scout/family accounts."]
    ,["New orders", "Use Orders to create purchases with quantities and shirt sizes. New-charge templates add ledger entries; they do not create order items."]
  ]);
  guide.getColumn(1).width = 25; guide.getColumn(2).width = 100; guide.getColumn(2).alignment = { wrapText: true }; guide.eachRow(row => { row.height = 42; });
  const choices = book.addWorksheet("Choices");
  choices.addRows([["Charge purpose", "Entry type", "Payment method"], ...Array.from({ length: Math.max(purposes.length, METHODS.length) }, (_, i) => [purposes[i]?.name || "", ["charge", "payment", "credit"][i] || "", METHODS[i] || ""])]);
  choices.columns = [{ width: 48 }, { width: 18 }, { width: 22 }];
  for (let r = 2; r <= rows.length + 1; r++) {
    const date = rows[r - 2][6]; if (date) sheet.getCell(r, 7).value = new Date(date + "T00:00:00Z");
    [4, 5, 8].forEach((col, i) => { sheet.getCell(r, col).dataValidation = { type: "list", allowBlank: true, showErrorMessage: true, errorStyle: "stop", formulae: [i === 0 ? `Choices!$A$2:$A$${purposes.length + 1}` : i === 1 ? '"charge,payment,credit"' : '"' + METHODS.join(",") + '"'] }; });
    for (let c = 5; c <= 10; c++) sheet.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4CE" } };
  }
  return book;
}
