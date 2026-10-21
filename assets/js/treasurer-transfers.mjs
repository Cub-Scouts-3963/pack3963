import { HEADERS, purposeCatalog, templateRows, csvText, parseCsv, reviewRows, workbookTemplate } from "./treasury-transfers.mjs";

const sb = window.supabase.createClient("https://buvrqioskjjhszqkpypa.supabase.co", "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V");
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = v => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v || 0) / 100);
let data = { accounts: [], entries: [], orders: [], campaigns: [], expenses: [], purposes: [] }, role = null, matrix = null, reviewed = [], busy = false, excelPromise;
const writeAllowed = () => ["admin", "treasurer"].includes(role);
const message = (text, error = false) => { $("#transfer-status").textContent = text; $("#transfer-status").className = "form-status" + (error ? " is-error" : " is-success"); };

async function excel() {
  if (window.ExcelJS) return window.ExcelJS;
  if (!excelPromise) excelPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
    script.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error("Excel support did not load."));
    script.onerror = () => reject(new Error("Excel support could not load. You can use CSV instead."));
    document.head.appendChild(script);
  }).catch(error => { excelPromise = null; throw error; });
  return excelPromise;
}

async function allRows(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await sb.from(table).select("*").order("id").range(offset, offset + 999);
    if (response.error) throw response.error;
    rows.push(...response.data);
    if (response.data.length < 1000) return rows;
  }
}

async function refresh() {
  const { data: sessionData, error } = await sb.auth.getSession();
  if (error || !sessionData.session) throw new Error("Sign in to use templates and exports.");
  const access = await sb.from("authorized_users").select("role").eq("email", String(sessionData.session.user.email || "").toLowerCase()).eq("active", true).maybeSingle();
  if (access.error || !access.data) throw new Error("Your portal access is not active.");
  role = access.data.role;
  const results = await Promise.all(["account_balances", "ledger_entries", "order_items", "order_campaigns", "expenses"].map(allRows));
  [data.accounts, data.entries, data.orders, data.campaigns, data.expenses] = results;
  data.purposes = purposeCatalog(data.entries, data.campaigns);
  const previous = $("#template-purpose").value;
  $("#template-purpose").innerHTML = data.purposes.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  if (data.purposes.some(p => p.id === previous)) $("#template-purpose").value = previous;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function writeReport(name, rows, format) {
  const filename = "pack3963-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + new Date().toISOString().slice(0, 10);
  if (format === "csv") return download(new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }), filename + ".csv");
  const ExcelJS = await excel(), book = new ExcelJS.Workbook(), sheet = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRows(rows); sheet.columns.forEach(c => { c.width = 24; }); sheet.getRow(1).font = { bold: true };
  rows[0].forEach((heading, index) => { if (["Own balance", "Amount due", "Credit", "Amount", "Total", "Paid or credited"].includes(heading)) sheet.getColumn(index + 1).numFmt = '$#,##0.00'; });
  sheet.autoFilter = { from: "A1", to: { row: rows.length, column: rows[0].length } };
  download(new Blob([await book.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename + ".xlsx");
}

async function downloadTemplate() {
  await refresh();
  if (!writeAllowed()) throw new Error("Only admins and treasurers can prepare entries.");
  const purpose = data.purposes.find(p => p.id === $("#template-purpose").value);
  if (!purpose) throw new Error("Create a charge or order purpose in the portal first.");
  const rows = templateRows({ ...data, purpose, type: $("#template-type").value, accountType: $("#template-account-type").value, date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) });
  if (!rows.length) throw new Error("No matching accounts/charges. Change the account filter or purpose; new-charge templates include current Scout and family accounts.");
  const format = $("#transfer-format").value;
  if (format === "csv") download(new Blob([csvText([HEADERS, ...rows])], { type: "text/csv;charset=utf-8" }), "pack3963-entry-template.csv");
  else {
    const book = workbookTemplate(await excel(), rows, data.purposes);
    download(new Blob([await book.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "pack3963-entry-template.xlsx");
  }
  message(`Downloaded ${rows.length} prefilled rows for ${purpose.name}. Amounts are blank; only completed entries will be reviewed.`);
}

async function readFile(file) {
  if (!file || file.size > 2097152) throw new Error("Choose a template no larger than 2 MB.");
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose a Pack .xlsx or .csv entry template.");
  const book = new (await excel()).Workbook();
  await book.xlsx.load(await file.arrayBuffer(), { ignoreNodes: ["dataValidations", "conditionalFormatting", "drawing", "extLst"] });
  const sheet = book.getWorksheet("Entries");
  if (!sheet) throw new Error("This workbook is not an entry template. Exported reports cannot be imported.");
  if (sheet.rowCount > 5001 || sheet.columnCount > HEADERS.length) throw new Error("The template has too many rows or columns.");
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, row => { rows.push(Array.from({ length: HEADERS.length }, (_, i) => row.getCell(i + 1).value ?? "")); });
  return rows;
}

function showReview() {
  $("#transfer-review").hidden = false;
  $("#transfer-review-table").innerHTML = reviewed.map((r, i) => `<tr><td><input type="checkbox" data-import-row="${i}" aria-label="Include row ${r.line}" ${r.selected ? "checked" : ""} ${!["ready", "duplicate"].includes(r.status) ? "disabled" : ""}></td><td>${r.line}</td><td>${esc(r.name)}</td><td>${esc(r.purpose)}</td><td>${esc(r.entry?.entry_type || "—")}</td><td>${esc(r.entry?.occurred_on || "—")}</td><td class="money">${r.entry ? money(r.entry.amount_cents) : "—"}</td><td>${esc(r.message)}</td></tr>`).join("");
  updateTotals();
}
function updateTotals() {
  const selected = reviewed.filter(r => r.selected), invalid = reviewed.filter(r => r.status === "invalid").length;
  const totals = ["charge", "payment", "credit"].map(type => `${type}: ${money(selected.filter(r => r.entry.entry_type === type).reduce((sum, r) => sum + r.entry.amount_cents, 0))}`);
  $("#transfer-totals").textContent = `${selected.length} selected. ${totals.join("; ")}. ${reviewed.filter(r => r.status === "blank").length} blank; ${reviewed.filter(r => r.status === "imported").length} already imported; ${invalid} invalid.`;
  $("#post-template").disabled = busy || !selected.length || invalid > 0 || !writeAllowed();
}

async function postEntries() {
  if (!matrix) return;
  const wanted = new Map(reviewed.filter(r => r.selected).map(r => [r.entry.source_record_id, r.status]));
  if (!wanted.size || reviewed.some(r => r.status === "invalid")) throw new Error("Fix invalid rows before posting, and select at least one entry.");
  await refresh();
  if (!writeAllowed()) throw new Error("Only admins and treasurers can import entries.");
  const fresh = reviewRows(matrix, data);
  const changed = fresh.some(r => r.status === "invalid" || (wanted.has(r.entry?.source_record_id) && r.status === "duplicate" && wanted.get(r.entry.source_record_id) !== "duplicate"));
  reviewed = fresh.map(r => ({ ...r, selected: wanted.has(r.entry?.source_record_id) && ["ready", "duplicate"].includes(r.status) }));
  if (changed) { reviewed.filter(r => r.status === "duplicate").forEach(r => { r.selected = false; }); showReview(); throw new Error("The data changed since preview. Review the refreshed rows before posting."); }
  const selected = reviewed.filter(r => r.selected);
  if (!selected.length) { showReview(); return message("These entries have already been imported. Nothing was posted again."); }
  if (!window.confirm(`Post ${selected.length} selected transactions?\n${selected.filter(r => r.status === "duplicate").length} selected rows are possible duplicates.\nThis adds ledger entries; it does not replace balances.`)) { showReview(); return; }
  const batch = crypto.randomUUID();
  const result = await sb.from("ledger_entries").insert(selected.map(r => ({ ...r.entry, batch_id: batch })));
  if (result.error) throw new Error(result.error.code === "23505" ? "One or more rows were just imported elsewhere. Reload this file to review; the batch was not posted." : result.error.message);
  await refresh(); reviewed = reviewRows(matrix, data); showReview();
  window.dispatchEvent(new Event("treasury-imported"));
  message(`Imported ${selected.length} transactions. Re-uploading this completed template will skip those entries.`);
}

function reportRows(kind) {
  const account = id => data.accounts.find(a => a.id === id);
  if (kind === "accounts") return ["Account balances", [["Scout / account", "Family", "Type", "Den", "Status", "Own balance", "Amount due", "Credit"], ...data.accounts.map(a => [a.display_name, account(a.parent_account_id)?.display_name || a.household_name || "", a.account_type, a.den || "", a.active ? "Active" : "Inactive", Number(a.balance_cents || 0) / 100, Number(a.amount_due_cents || 0) / 100, Number(a.credit_cents || 0) / 100])]];
  if (kind === "expenses") return ["Pack expenses", [["Date", "Vendor", "Category", "Type", "Description", "Amount", "Status", "Purchased by", "Reimburse to", "Notes", "Removed"], ...data.expenses.map(e => [e.purchased_on, e.vendor, e.category, e.expense_type, e.description, Number(e.amount_cents) / 100, e.status, e.purchased_by, e.reimburse_to, e.notes, !!e.voided_at])]];
  if (kind === "orders") return ["Orders", [["Order", "Scout / account", "Family", "For", "Quantity", "Size / option", "Total", "Paid or credited", "Amount due", "Due date", "Active"], ...data.orders.map(o => {
    const campaign = data.campaigns.find(c => c.id === o.campaign_id), a = account(o.account_id), paid = data.entries.filter(e => !e.voided_at && e.order_item_id === o.id && e.entry_type !== "charge").reduce((n, e) => n + Number(e.amount_cents), 0);
    const total = o.quantity * o.unit_price_cents;
    return [campaign?.name || "", a?.display_name || "", account(a?.parent_account_id)?.display_name || a?.household_name || "", o.ordered_for, o.quantity, o.item_variant, total / 100, paid / 100, Math.max(0, total - paid) / 100, campaign?.due_on || "", o.active];
  })]];
  return ["Transaction history", [["Date", "Scout / account", "Family", "Type", "Purpose / description", "Category", "Amount", "Payment method", "Reference", "Notes", "Status", "Ledger ID"], ...data.entries.sort((a, b) => a.occurred_on.localeCompare(b.occurred_on)).map(e => { const a = account(e.account_id); return [e.occurred_on, a?.display_name || "", account(a?.parent_account_id)?.display_name || a?.household_name || "", e.entry_type, e.description, e.category, Number(e.amount_cents) / 100, e.payment_method, e.reference, e.notes, e.voided_at ? "Removed" : "Posted", e.id]; })]];
}

async function action(button, run) {
  if (busy) return;
  const controls = [...document.querySelectorAll("#template-file,#download-entry-template,#export-report,#post-template,#transfer-review-table input")].map(element => [element, element.disabled]);
  controls.forEach(([element]) => { element.disabled = true; });
  busy = true; button.disabled = true; message("Working…");
  try { await run(); } catch (error) { message(error.message || "Unable to complete this action.", true); }
  finally { busy = false; controls.forEach(([element, disabled]) => { element.disabled = disabled; }); if (reviewed.length) updateTotals(); }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#download-entry-template").addEventListener("click", e => action(e.currentTarget, downloadTemplate));
  $("#template-file").addEventListener("change", e => action($("#post-template"), async () => { const file = e.target.files[0]; if (!file) return; matrix = null; reviewed = []; $("#transfer-review").hidden = true; await refresh(); if (!writeAllowed()) throw new Error("Only admins and treasurers can import entries."); matrix = await readFile(file); reviewed = reviewRows(matrix, data); showReview(); message("Review the rows and totals. Blank amounts and previously imported rows are excluded. Fix invalid rows before posting."); }));
  $("#transfer-review-table").addEventListener("change", e => { const index = e.target.dataset.importRow; if (index == null || busy) return; reviewed[index].selected = e.target.checked; updateTotals(); });
  $("#post-template").addEventListener("click", e => action(e.currentTarget, postEntries));
  $("#export-report").addEventListener("click", e => action(e.currentTarget, async () => { await refresh(); const [name, rows] = reportRows($("#export-kind").value); await writeReport(name, rows, $("#export-format").value); message(`Exported ${rows.length - 1} rows. This report is for review and cannot be posted as new entries.`); }));
  $("#refresh-data").addEventListener("click", () => refresh().catch(() => {}));
  sb.auth.getSession().then(({ data }) => { if (data.session) refresh().catch(error => message(error.message, true)); });
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) setTimeout(() => refresh().catch(error => message(error.message, true)), 0);
    if (event === "SIGNED_OUT") { role = null; matrix = null; reviewed = []; data = { accounts: [], entries: [], orders: [], campaigns: [], expenses: [], purposes: [] }; $("#transfer-review").hidden = true; $("#template-file").value = ""; }
  });
});
