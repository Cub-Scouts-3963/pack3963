(() => {
  "use strict";

  const SUPABASE_URL = "https://buvrqioskjjhszqkpypa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
  });
  const state = { user: null, access: null, accounts: [], entries: [], expenses: [], receipts: [], summary: null, users: [], importRows: [] };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
  const cents = (value) => Math.round(Number(value) * 100);
  const human = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  const status = (message, kind = "", target = "#app-status") => {
    const el = $(target); if (!el) return;
    el.textContent = message;
    el.className = `form-status${kind ? " is-" + kind : ""}`;
  };
  const checked = (data, error) => { if (error) throw error; return data; };
  const emptyRow = (cols, text) => `<tr><td class="empty-row" colspan="${cols}">${esc(text)}</td></tr>`;

  function setDefaults() {
    $$('input[type="date"]').forEach(input => { if (!input.value) input.value = today(); });
  }

  async function signOut() {
    await client.auth.signOut();
    state.user = null; state.access = null;
    $("#treasurer-app").hidden = true;
    $("#access-panel").hidden = true;
    $("#auth-panel").hidden = false;
    status("", "", "#login-status");
  }

  async function authorize(session) {
    if (!session?.user) return signOut();
    state.user = session.user;
    $("#auth-panel").hidden = true;
    status("Checking access…");
    const { data, error } = await client.from("authorized_users").select("*")
      .eq("email", String(session.user.email || "").toLowerCase()).eq("active", true).maybeSingle();
    if (error || !data) {
      $("#treasurer-app").hidden = true;
      $("#access-panel").hidden = false;
      status("");
      return;
    }
    state.access = data;
    $("#access-panel").hidden = true;
    $("#treasurer-app").hidden = false;
    $("#user-role").textContent = data.role;
    $("#welcome-heading").textContent = `Welcome${data.display_name ? ", " + data.display_name : ""}`;
    const canWrite = ["admin", "treasurer"].includes(data.role);
    $$(".write-control").forEach(el => { el.hidden = !canWrite; });
    $$(".admin-only").forEach(el => { el.hidden = data.role !== "admin"; });
    setDefaults();
    await loadAll();
  }

  async function loadAll() {
    status("Loading current Pack finances…");
    try {
      const requests = [
        client.from("account_balances").select("*").order("display_name"),
        client.from("ledger_entries").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(2000),
        client.from("expenses").select("*").order("purchased_on", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
        client.from("expense_receipts").select("*"),
        client.from("treasurer_summary").select("*").maybeSingle()
      ];
      if (state.access?.role === "admin") requests.push(client.from("authorized_users").select("*").order("email"));
      const results = await Promise.all(requests);
      state.accounts = checked(results[0].data, results[0].error) || [];
      state.entries = checked(results[1].data, results[1].error) || [];
      state.expenses = checked(results[2].data, results[2].error) || [];
      state.receipts = checked(results[3].data, results[3].error) || [];
      state.summary = checked(results[4].data, results[4].error) || {};
      state.users = results[5] ? checked(results[5].data, results[5].error) || [] : [];
      renderAll();
      status(`Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`, "success");
    } catch (error) {
      status(error.message || "Unable to load financial data.", "error");
    }
  }

  function accountName(id) {
    return state.accounts.find(a => a.id === id)?.display_name || "Unknown account";
  }

  function renderAll() {
    renderSummary(); renderAccounts(); renderTransactions(); renderExpenses(); renderAccess(); populateAccounts();
  }

  function renderSummary() {
    const s = state.summary || {};
    $("#summary-bank").textContent = s.latest_bank_balance_cents == null ? "—" : money(s.latest_bank_balance_cents);
    $("#summary-bank-date").textContent = s.latest_bank_balance_date ? `As of ${s.latest_bank_balance_date}` : "No snapshot yet";
    $("#summary-due").textContent = money(s.total_due_cents);
    $("#summary-credits").textContent = money(s.total_credit_cents);
    $("#summary-expenses").textContent = money(s.total_expenses_cents);
    const due = state.accounts.filter(a => Number(a.amount_due_cents) > 0).length;
    const credits = state.accounts.filter(a => Number(a.credit_cents) > 0).length;
    $("#summary-due-count").textContent = `${due} account${due === 1 ? "" : "s"} with a balance`;
    $("#summary-credit-count").textContent = `${credits} account${credits === 1 ? "" : "s"} with credit`;
    $("#summary-reimbursements").textContent = `${money(s.reimbursements_due_cents)} awaiting reimbursement`;
    const missing = state.expenses.filter(e => !e.voided_at && !state.receipts.some(r => r.expense_id === e.id)).length;
    const unpaid = state.expenses.filter(e => !e.voided_at && e.expense_type === "reimbursement" && e.status !== "paid").length;
    const priorities = [
      `${due} Scout/family account${due === 1 ? "" : "s"} currently owe money.`,
      `${unpaid} reimbursement${unpaid === 1 ? "" : "s"} still need payment.`,
      `${missing} expense${missing === 1 ? "" : "s"} do not have a receipt attached.`
    ];
    $("#priority-list").innerHTML = priorities.map(x => `<li>${esc(x)}</li>`).join("");
    const recent = state.entries.filter(e => !e.voided_at).slice(0, 8);
    $("#recent-activity").innerHTML = recent.length ? recent.map(e => `<tr><td>${esc(e.occurred_on)}</td><td>${esc(accountName(e.account_id))}</td><td>${esc(human(e.entry_type))}</td><td>${esc(e.description)}</td><td class="money">${money(e.amount_cents)}</td></tr>`).join("") : emptyRow(5, "No activity recorded yet.");
  }

  function filteredAccounts() {
    const q = $("#account-search").value.trim().toLowerCase();
    const filter = $("#balance-filter").value;
    return state.accounts.filter(a => {
      const hay = [a.display_name, a.den, a.household_name, a.bsa_member_id, a.scoutbook_user_id].join(" ").toLowerCase();
      const b = Number(a.balance_cents);
      const match = filter === "due" ? b > 0 : filter === "credit" ? b < 0 : filter === "paid" ? b === 0 && a.active : filter === "inactive" ? !a.active : true;
      return (!q || hay.includes(q)) && match;
    });
  }

  function renderAccounts() {
    const rows = filteredAccounts();
    $("#accounts-table").innerHTML = rows.length ? rows.map(a => {
      const b = Number(a.balance_cents);
      const cls = b > 0 ? "balance-due" : b < 0 ? "balance-credit" : "";
      const label = b > 0 ? "Due" : b < 0 ? "Credit" : "Paid / even";
      return `<tr><td><strong>${esc(a.display_name)}</strong>${a.household_name ? `<br><small>${esc(a.household_name)}</small>` : ""}</td><td>${esc(a.den || "—")}</td><td>${esc(human(a.account_type))}</td><td class="money ${cls}">${money(Math.abs(b))}</td><td><span class="status-pill">${esc(a.active ? label : "Inactive")}</span></td></tr>`;
    }).join("") : emptyRow(5, "No matching accounts.");
  }

  function filteredEntries() {
    const q = $("#transaction-search").value.trim().toLowerCase();
    const filter = $("#transaction-filter").value;
    return state.entries.filter(e => {
      const hay = [accountName(e.account_id), e.description, e.category, e.payment_method, e.reference, e.notes].join(" ").toLowerCase();
      const match = filter === "active" ? !e.voided_at : filter === "voided" ? !!e.voided_at : filter === "all" ? true : e.entry_type === filter && !e.voided_at;
      return (!q || hay.includes(q)) && match;
    });
  }

  function renderTransactions() {
    const canWrite = ["admin", "treasurer"].includes(state.access?.role);
    const rows = filteredEntries();
    $("#transactions-table").innerHTML = rows.length ? rows.map(e => {
      const action = canWrite ? (e.voided_at
        ? `<button class="action-button" data-restore-entry="${e.id}" type="button">Restore</button>`
        : `<button class="action-button" data-void-entry="${e.id}" type="button">Remove</button>`) : "";
      return `<tr class="${e.voided_at ? "is-voided" : ""}"><td>${esc(e.occurred_on)}</td><td>${esc(accountName(e.account_id))}</td><td>${esc(human(e.entry_type))}</td><td><strong>${esc(e.description)}</strong>${e.category ? `<br><small>${esc(e.category)}</small>` : ""}${e.void_reason ? `<br><small>Removed: ${esc(e.void_reason)}</small>` : ""}</td><td>${esc(human(e.payment_method) || "—")}</td><td class="money">${money(e.amount_cents)}</td><td class="write-control"><div class="action-group">${action}</div></td></tr>`;
    }).join("") : emptyRow(7, "No matching charges or payments.");
  }

  function filteredExpenses() {
    const q = $("#expense-search").value.trim().toLowerCase();
    const filter = $("#expense-filter").value;
    return state.expenses.filter(e => {
      const hasReceipt = state.receipts.some(r => r.expense_id === e.id);
      const hay = [e.vendor, e.category, e.purchased_by, e.reimburse_to, e.description, e.notes].join(" ").toLowerCase();
      const match = filter === "active" ? !e.voided_at : filter === "voided" ? !!e.voided_at : filter === "all" ? true : filter === "reimbursement" ? e.expense_type === "reimbursement" && !e.voided_at : filter === "unpaid" ? e.expense_type === "reimbursement" && e.status !== "paid" && !e.voided_at : !hasReceipt && !e.voided_at;
      return (!q || hay.includes(q)) && match;
    });
  }

  function renderExpenses() {
    const canWrite = ["admin", "treasurer"].includes(state.access?.role);
    const rows = filteredExpenses();
    $("#expenses-table").innerHTML = rows.length ? rows.map(e => {
      const receipts = state.receipts.filter(r => r.expense_id === e.id);
      const receipt = receipts.length ? receipts.map(r => `<button class="text-button" type="button" data-open-receipt="${r.storage_path}">${esc(r.original_filename)}</button>`).join("<br>") : "Missing";
      const action = canWrite ? (e.voided_at ? `<button class="action-button" data-restore-expense="${e.id}" type="button">Restore</button>` : `<button class="action-button" data-void-expense="${e.id}" type="button">Remove</button>`) : "";
      return `<tr class="${e.voided_at ? "is-voided" : ""}"><td>${esc(e.purchased_on)}</td><td><strong>${esc(e.vendor)}</strong>${e.category ? `<br><small>${esc(e.category)}</small>` : ""}</td><td>${esc(human(e.expense_type))}<br><span class="status-pill">${esc(human(e.status))}</span></td><td>${esc(e.expense_type === "reimbursement" ? e.reimburse_to : e.purchased_by || "Pack")}</td><td>${receipt}</td><td class="money">${money(e.amount_cents)}</td><td class="write-control">${action}</td></tr>`;
    }).join("") : emptyRow(7, "No matching expenses.");
  }

  function renderAccess() {
    if (state.access?.role !== "admin") return;
    $("#access-table").innerHTML = state.users.length ? state.users.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.display_name || "—")}</td><td>${esc(human(u.role))}</td><td>${u.active ? "Active" : "Disabled"}</td></tr>`).join("") : emptyRow(4, "No authorized users.");
  }

  function populateAccounts() {
    $("#entry-accounts").innerHTML = state.accounts.filter(a => a.active).map(a => `<option value="${a.id}">${esc(a.display_name)}${a.den ? " — " + esc(a.den) : ""}</option>`).join("");
  }

  function openTab(name) {
    $$(".portal-tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
    $$(".portal-panel").forEach(p => p.classList.toggle("is-active", p.dataset.panel === name));
  }

  async function saveAccount(form) {
    const f = new FormData(form);
    const row = Object.fromEntries(["account_type","display_name","den","household_name","bsa_member_id","scoutbook_user_id","contact_email","notes"].map(k => [k, String(f.get(k) || "").trim() || null]));
    checked(...Object.values(await client.from("financial_accounts").insert(row)).reverse());
  }

  async function saveEntry(form) {
    const f = new FormData(form);
    const ids = Array.from($("#entry-accounts").selectedOptions).map(o => o.value);
    if (!ids.length) throw new Error("Select at least one account.");
    const batch = crypto.randomUUID();
    const rows = ids.map(account_id => ({
      account_id, entry_type: f.get("entry_type"), amount_cents: cents(f.get("amount")),
      occurred_on: f.get("occurred_on"), description: String(f.get("description")).trim(),
      category: String(f.get("category") || "").trim() || null,
      payment_method: String(f.get("payment_method") || "") || null,
      reference: String(f.get("reference") || "").trim() || null,
      notes: String(f.get("notes") || "").trim() || null, batch_id: batch
    }));
    const { error } = await client.from("ledger_entries").insert(rows); if (error) throw error;
  }

  async function saveExpense(form) {
    const f = new FormData(form);
    const row = {
      expense_type: f.get("expense_type"), amount_cents: cents(f.get("amount")), purchased_on: f.get("purchased_on"),
      vendor: String(f.get("vendor")).trim(), category: String(f.get("category") || "").trim() || null,
      purchased_by: String(f.get("purchased_by") || "").trim() || null, reimburse_to: String(f.get("reimburse_to") || "").trim() || null,
      status: f.get("status"), description: String(f.get("description") || "").trim() || null, notes: String(f.get("notes") || "").trim() || null
    };
    const { data, error } = await client.from("expenses").insert(row).select().single(); if (error) throw error;
    const file = f.get("receipt");
    if (file && file.size) {
      if (file.size > 10485760) throw new Error("Expense saved, but the receipt is larger than 10 MB.");
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${data.id}/${Date.now()}-${safe}`;
      const uploaded = await client.storage.from("pack-receipts").upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) throw new Error(`Expense saved, but receipt upload failed: ${uploaded.error.message}`);
      const saved = await client.from("expense_receipts").insert({ expense_id: data.id, storage_path: path, original_filename: file.name, content_type: file.type || null, size_bytes: file.size });
      if (saved.error) throw saved.error;
    }
  }

  async function voidRecord(table, id, restore = false) {
    const values = restore ? { voided_at: null, voided_by: null, void_reason: null } : (() => {
      const reason = window.prompt("Why are you removing this record? It will stay in the audit history and can be restored.");
      if (!reason?.trim()) return null;
      return { voided_at: new Date().toISOString(), voided_by: state.user.id, void_reason: reason.trim() };
    })();
    if (!values) return;
    const { error } = await client.from(table).update(values).eq("id", id); if (error) throw error;
    await loadAll();
  }

  function parseCsv(text) {
    const rows = []; let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], next = text[i + 1];
      if (quoted && c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') quoted = !quoted;
      else if (c === "," && !quoted) { row.push(field); field = ""; }
      else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && next === "\n") i++;
        row.push(field); field = "";
        if (row.some(v => String(v).trim())) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const numberValue = value => {
    const cleaned = String(value || "").replace(/[$,()\s]/g, "");
    const n = Number(cleaned); return Number.isFinite(n) ? Math.abs(n) : 0;
  };
  const dateValue = value => {
    const s = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return today();
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  };

  function mapImport(text) {
    const raw = parseCsv(text.replace(/^\uFEFF/, ""));
    if (raw.length < 2) throw new Error("The CSV does not contain any transaction rows.");
    const headers = raw[0].map(key);
    const expanded = [];
    raw.slice(1).forEach(r => {
      if (r.length > headers.length) {
        for (let i = 0; i < r.length; i += headers.length) expanded.push(r.slice(i, i + headers.length));
      } else expanded.push(r);
    });
    const pick = (obj, names) => { for (const n of names) if (obj[key(n)] != null && String(obj[key(n)]).trim()) return String(obj[key(n)]).trim(); return ""; };
    return expanded.map((r, index) => {
      const obj = {}; headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
      const first = pick(obj, ["first name","firstname","member first name"]);
      const last = pick(obj, ["last name","lastname","member last name"]);
      let name = pick(obj, ["scout name","member name","account name","account","name","participant"]);
      if (!name) name = [first, last].filter(Boolean).join(" ");
      if (name.includes(",") && !first) { const p = name.split(","); name = `${p.slice(1).join(" ").trim()} ${p[0].trim()}`.trim(); }
      const charge = numberValue(pick(obj, ["charge","charge amount","debit"]));
      const payment = numberValue(pick(obj, ["payment","payment amount","credit","amount paid"]));
      let type = charge ? "charge" : payment ? "payment" : key(pick(obj, ["transaction type","type"])).includes("charge") ? "charge" : "payment";
      const amount = charge || payment || numberValue(pick(obj, ["amount","transaction amount"]));
      const sourceId = pick(obj, ["payment log id","paymentlogid","transaction id","id"]) || `row-${index + 2}-${key(name)}-${Math.round(amount * 100)}`;
      const den = pick(obj, ["den","den name","group"]);
      const description = pick(obj, ["description","item","reason","memo","charge description"]) || `Scoutbook ${type}`;
      const bsa = pick(obj, ["bsa member id","member id","memberid","bsaid"]);
      return { name, den, bsa, type, amount_cents: Math.round(amount * 100), date: dateValue(pick(obj, ["transaction date","date","posted date"])), description, sourceId, raw: obj };
    }).filter(r => r.name && r.amount_cents > 0);
  }

  function previewImport(rows) {
    state.importRows = rows;
    const charges = rows.filter(r => r.type === "charge").reduce((n, r) => n + r.amount_cents, 0);
    const payments = rows.filter(r => r.type !== "charge").reduce((n, r) => n + r.amount_cents, 0);
    $("#import-summary").innerHTML = [
      ["Rows ready", rows.length], ["Charges", money(charges)], ["Payments", money(payments)]
    ].map(([label, value]) => `<article class="summary-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join("");
    $("#import-table").innerHTML = rows.slice(0, 100).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.den || "—")}</td><td>${esc(human(r.type))}</td><td>${esc(r.description)}</td><td class="money">${money(r.amount_cents)}</td></tr>`).join("");
    $("#import-preview").hidden = false;
    status(`Review ${rows.length} mapped rows before importing. The preview shows up to 100.`, "", "#import-status");
  }

  async function runImport() {
    if (!state.importRows.length) return;
    status("Importing accounts and transactions…", "", "#import-status");
    const existingSource = new Set(state.entries.filter(e => e.source === "scoutbook_import").map(e => e.source_record_id));
    const accountByName = new Map(state.accounts.map(a => [a.display_name.trim().toLowerCase(), a]));
    const accountByBsa = new Map(state.accounts.filter(a => a.bsa_member_id).map(a => [a.bsa_member_id, a]));
    const toInsert = []; let skipped = 0;
    for (const r of state.importRows) {
      if (existingSource.has(r.sourceId)) { skipped++; continue; }
      let account = (r.bsa && accountByBsa.get(r.bsa)) || accountByName.get(r.name.trim().toLowerCase());
      if (!account) {
        const leaderLike = /leader|parent|family|guardian/i.test(r.name + " " + r.den);
        const created = await client.from("financial_accounts").insert({
          account_type: leaderLike ? "household" : "scout", display_name: r.name, den: r.den || null,
          bsa_member_id: r.bsa || null, source: undefined
        }).select().single();
        if (created.error) throw created.error;
        account = created.data; accountByName.set(r.name.trim().toLowerCase(), account);
        if (r.bsa) accountByBsa.set(r.bsa, account);
      }
      toInsert.push({
        account_id: account.id, entry_type: r.type, amount_cents: r.amount_cents, occurred_on: r.date,
        description: r.description, category: "Scoutbook import", source: "scoutbook_import", source_record_id: r.sourceId,
        notes: "Imported from Scoutbook Payment Log"
      });
    }
    if (toInsert.length) {
      const { error } = await client.from("ledger_entries").insert(toInsert); if (error) throw error;
    }
    status(`Import complete: ${toInsert.length} added, ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped.`, "success", "#import-status");
    state.importRows = []; $("#import-preview").hidden = true; $("#csv-file").value = "";
    await loadAll();
  }

  async function submitHandler(form, action, success) {
    status("Saving…");
    try { await action(form); form.reset(); setDefaults(); form.hidden = true; status(success, "success"); await loadAll(); }
    catch (error) { status(error.message || "Unable to save.", "error"); }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    setDefaults();
    $("#login-form").addEventListener("submit", async event => {
      event.preventDefault(); status("Sending secure link…", "", "#login-status");
      const email = new FormData(event.currentTarget).get("email");
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname, shouldCreateUser: true } });
      status(error ? error.message : "Check your email for the secure sign-in link.", error ? "error" : "success", "#login-status");
    });
    $("#sign-out").addEventListener("click", signOut); $("#denied-sign-out").addEventListener("click", signOut);
    $("#refresh-data").addEventListener("click", loadAll);
    $$(".portal-tab").forEach(b => b.addEventListener("click", () => openTab(b.dataset.tab)));
    $$("[data-go-tab]").forEach(b => b.addEventListener("click", () => openTab(b.dataset.goTab)));
    [["#show-account-form","#account-form"],["#show-entry-form","#entry-form"],["#show-expense-form","#expense-form"]].forEach(([button, form]) => $(button).addEventListener("click", () => { $(form).hidden = false; $(form).scrollIntoView({ behavior: "smooth", block: "start" }); }));
    $$("[data-close-form]").forEach(b => b.addEventListener("click", () => { $("#" + b.dataset.closeForm).hidden = true; }));
    $("#account-search").addEventListener("input", renderAccounts); $("#balance-filter").addEventListener("change", renderAccounts);
    $("#transaction-search").addEventListener("input", renderTransactions); $("#transaction-filter").addEventListener("change", renderTransactions);
    $("#expense-search").addEventListener("input", renderExpenses); $("#expense-filter").addEventListener("change", renderExpenses);
    $("#account-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, saveAccount, "Account added."); });
    $("#entry-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, saveEntry, "Charge or payment saved."); });
    $("#expense-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, saveExpense, "Expense saved."); });
    $("#bank-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, async form => {
      const f = new FormData(form); const { error } = await client.from("bank_balance_snapshots").insert({ balance_cents: cents(f.get("balance")), as_of_date: f.get("as_of_date"), notes: String(f.get("notes") || "").trim() || null }); if (error) throw error;
    }, "Bank balance snapshot saved."); });
    $("#access-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, async form => {
      const f = new FormData(form); const { error } = await client.from("authorized_users").upsert({ email: String(f.get("email")).trim().toLowerCase(), display_name: String(f.get("display_name") || "").trim() || null, role: f.get("role"), active: true }, { onConflict: "email" }); if (error) throw error;
    }, "Access updated."); });
    $("#transactions-table").addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      try { if (b.dataset.voidEntry) await voidRecord("ledger_entries", b.dataset.voidEntry); if (b.dataset.restoreEntry) await voidRecord("ledger_entries", b.dataset.restoreEntry, true); } catch (error) { status(error.message, "error"); }
    });
    $("#expenses-table").addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      try {
        if (b.dataset.voidExpense) await voidRecord("expenses", b.dataset.voidExpense);
        if (b.dataset.restoreExpense) await voidRecord("expenses", b.dataset.restoreExpense, true);
        if (b.dataset.openReceipt) { const { data, error } = await client.storage.from("pack-receipts").createSignedUrl(b.dataset.openReceipt, 60); if (error) throw error; window.open(data.signedUrl, "_blank", "noopener"); }
      } catch (error) { status(error.message, "error"); }
    });
    $("#csv-file").addEventListener("change", async e => {
      const file = e.target.files[0]; if (!file) return;
      try { previewImport(mapImport(await file.text())); } catch (error) { status(error.message, "error", "#import-status"); }
    });
    $("#run-import").addEventListener("click", async () => { try { await runImport(); } catch (error) { status(error.message, "error", "#import-status"); } });
    const { data } = await client.auth.getSession();
    if (data.session) await authorize(data.session);
    client.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_IN" && session && state.user?.id !== session.user.id) setTimeout(() => authorize(session), 0); });
  });
})();