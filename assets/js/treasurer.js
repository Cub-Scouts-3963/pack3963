(() => {
  "use strict";

  const SUPABASE_URL = "https://buvrqioskjjhszqkpypa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
  const INVITATION_API = "https://pack3963-auth-email.cubscouts3963.workers.dev/api/treasurer/invite-user";
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
  });
  const state = { user: null, access: null, accounts: [], entries: [], expenses: [], receipts: [], summary: null, users: [], householdContacts: [], importRows: [], rosterRows: [], rosterHouseholds: [], rosterFileName: "", activeLedgerId: null };
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
    $("#ledger-payment-form").hidden = true;
    $$(".write-control").forEach(el => { el.hidden = !canWrite; });
    $$(".admin-only").forEach(el => { el.hidden = data.role !== "admin"; });
    openTab("dashboard");
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
        client.from("treasurer_summary").select("*").maybeSingle(),
        client.from("household_contacts").select("*").eq("active", true).order("is_primary", { ascending: false }).order("full_name")
      ];
      if (state.access?.role === "admin") requests.push(client.from("authorized_users").select("*").order("email"));
      const results = await Promise.all(requests);
      state.accounts = checked(results[0].data, results[0].error) || [];
      state.entries = checked(results[1].data, results[1].error) || [];
      state.expenses = checked(results[2].data, results[2].error) || [];
      state.receipts = checked(results[3].data, results[3].error) || [];
      state.summary = checked(results[4].data, results[4].error) || {};
      state.householdContacts = checked(results[5].data, results[5].error) || [];
      state.users = results[6] ? checked(results[6].data, results[6].error) || [] : [];
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
    $("#bank-current-balance").textContent = $("#summary-bank").textContent;
    $("#bank-current-date").textContent = s.latest_bank_balance_date ? `As of ${s.latest_bank_balance_date}` : "No balance recorded yet";
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
    const statusFilter = $("#balance-filter").value;
    const typeFilter = $("#account-type-filter").value;
    return state.accounts.filter(a => {
      const hay = [a.display_name, a.den, a.household_name, a.bsa_member_id, a.scoutbook_user_id].join(" ").toLowerCase();
      const b = Number(a.balance_cents);
      const statusMatch = statusFilter === "current" ? a.active : statusFilter === "due" ? b > 0 && a.active : statusFilter === "credit" ? b < 0 && a.active : statusFilter === "paid" ? b === 0 && a.active : statusFilter === "inactive" ? !a.active : true;
      const typeMatch = typeFilter === "all" || a.account_type === typeFilter;
      return (!q || hay.includes(q)) && statusMatch && typeMatch;
    });
  }

  function renderAccounts() {
    const canWrite = ["admin", "treasurer"].includes(state.access?.role);
    const rows = filteredAccounts();
    $("#accounts-table").innerHTML = rows.length ? rows.map(a => {
      const b = Number(a.balance_cents);
      const cls = b > 0 ? "balance-due" : b < 0 ? "balance-credit" : "";
      const label = b > 0 ? "Due" : b < 0 ? "Credit" : "Paid / even";
      const family = a.account_type === "scout" ? state.accounts.find(x => x.id === a.parent_account_id) : a;
      const contacts = family ? state.householdContacts.filter(c => c.household_account_id === family.id) : [];
      const contactText = contacts.length ? contacts.map(c => c.full_name).join(", ") : "—";
      const familyLine = a.account_type === "scout" && family ? `<br><small>${esc(family.display_name)}</small>` : (a.household_name ? `<br><small>${esc(a.household_name)}</small>` : "");
      const action = canWrite ? `<button class="action-button" data-account-active="${a.active ? "false" : "true"}" data-account-id="${a.id}" type="button">${a.active ? "Remove" : "Restore"}</button>` : "";
      return `<tr class="${a.active ? "" : "is-voided"}"><td><button class="ledger-link" data-view-ledger="${a.id}" type="button"><strong>${esc(a.display_name)}</strong></button>${familyLine}</td><td><small>${esc(contactText)}</small></td><td>${esc(a.den || "—")}</td><td>${esc(human(a.account_type))}</td><td class="money ${cls}">${money(Math.abs(b))}</td><td><span class="status-pill">${esc(a.active ? label : "Inactive")}</span></td><td><button class="action-button" data-view-ledger="${a.id}" type="button">View ledger</button></td><td class="write-control">${action}</td></tr>`;
    }).join("") : emptyRow(8, "No matching accounts.");
  }


  function ledgerScope(account) {
    if (account.account_type !== "household") return [account];
    return [account, ...state.accounts.filter(a => a.parent_account_id === account.id)];
  }

  function ledgerRows(account) {
    const ids = new Set(ledgerScope(account).map(a => a.id));
    let running = 0;
    return state.entries.filter(e => ids.has(e.account_id)).sort((a, b) =>
      String(a.occurred_on).localeCompare(String(b.occurred_on)) || String(a.created_at).localeCompare(String(b.created_at))
    ).map(entry => {
      const impact = entry.voided_at ? 0 : (entry.entry_type === "charge" ? Number(entry.amount_cents) : -Number(entry.amount_cents));
      running += impact;
      return { ...entry, running_balance_cents: running };
    });
  }

  function renderAccountLedger(id) {
    const account = state.accounts.find(a => a.id === id);
    if (!account) return;
    state.activeLedgerId = id;
    const paymentForm = $("#ledger-payment-form");
    if (paymentForm.dataset.accountId !== id) { paymentForm.hidden = true; paymentForm.reset(); delete paymentForm.dataset.paymentId; }
    paymentForm.dataset.accountId = id;
    $("#show-ledger-payment").hidden = !account.active || !["admin", "treasurer"].includes(state.access?.role);
    const scope = ledgerScope(account);
    const rows = ledgerRows(account);
    const activeRows = rows.filter(e => !e.voided_at);
    const charges = activeRows.filter(e => e.entry_type === "charge").reduce((sum, e) => sum + Number(e.amount_cents), 0);
    const payments = activeRows.filter(e => e.entry_type !== "charge").reduce((sum, e) => sum + Number(e.amount_cents), 0);
    const balance = scope.reduce((sum, a) => sum + Number(a.balance_cents || 0), 0);
    $("#ledger-title").textContent = account.display_name;
    $("#ledger-meta").textContent = account.account_type === "household"
      ? `Consolidated family ledger · ${scope.length - 1} linked Scout account${scope.length - 1 === 1 ? "" : "s"}`
      : `${human(account.account_type)}${account.den ? " · " + account.den : ""}`;
    $("#ledger-charges").textContent = money(charges);
    $("#ledger-payments").textContent = money(payments);
    $("#ledger-balance").textContent = money(balance);
    $("#ledger-balance").className = balance > 0 ? "balance-due" : balance < 0 ? "balance-credit" : "";
    $("#ledger-table").innerHTML = rows.length ? rows.map(e => `<tr class="${e.voided_at ? "is-voided" : ""}"><td>${esc(e.occurred_on)}</td><td>${esc(accountName(e.account_id))}</td><td><strong>${esc(e.description)}</strong>${e.category ? `<br><small>${esc(e.category)}</small>` : ""}</td><td>${esc(human(e.entry_type))}</td><td class="money">${money(e.amount_cents)}</td><td class="money">${money(e.running_balance_cents)}</td><td>${e.voided_at ? "Removed" : "Posted"}</td></tr>`).join("") : emptyRow(7, "No ledger entries for this account.");
    $("#account-ledger").hidden = false;
    $("#account-ledger").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openLedgerPayment() {
    if (!["admin", "treasurer"].includes(state.access?.role)) return;
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    if (!account?.active) return;
    const form = $("#ledger-payment-form"); form.reset(); form.dataset.accountId = account.id; delete form.dataset.paymentId;
    form.elements.occurred_on.value = today();
    $("#ledger-payment-account").textContent = `Payment into ${account.display_name}'s account. Family payments for another Scout must be recorded in that Scout's ledger.`;
    $("#ledger-payment-charge").innerHTML = '<option value="">General account payment</option>' + state.entries.filter(e => e.account_id === account.id && e.entry_type === "charge" && !e.voided_at).map(e => `<option value="${esc(e.id)}">${esc(e.description)} — ${money(e.amount_cents)}</option>`).join("");
    status("", "", "#ledger-payment-status"); form.hidden = false;
  }

  async function saveLedgerPayment(form) {
    if (!["admin", "treasurer"].includes(state.access?.role)) throw new Error("Only admins and treasurers can record payments.");
    const account = state.accounts.find(a => a.id === form.dataset.accountId);
    if (!account?.active) throw new Error("Choose an active account.");
    const f = new FormData(form), amount = String(f.get("amount") || ""), amount_cents = cents(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(amount_cents) || amount_cents <= 0 || amount_cents > 2147483647) throw new Error("Enter a positive amount with no more than two decimal places.");
    const occurred_on = String(f.get("occurred_on") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred_on) || !Number.isFinite(Date.parse(occurred_on)) || new Date(occurred_on).toISOString().slice(0, 10) !== occurred_on) throw new Error("Enter a valid payment date.");
    const method = String(f.get("payment_method") || "");
    if (!["cash", "zelle", "venmo", "check", "card", "bank_transfer", "other"].includes(method)) throw new Error("Choose a payment method.");
    let charge = null;
    if (f.get("charge_id")) {
      const r = await client.from("ledger_entries").select("*").eq("id", f.get("charge_id")).maybeSingle();
      if (r.error) throw r.error;
      charge = r.data;
      if (!charge || charge.account_id !== account.id || charge.entry_type !== "charge" || charge.voided_at) throw new Error("The selected charge is no longer available. Reopen Add payment.");
    }
    form.dataset.paymentId ||= crypto.randomUUID();
    const row = { id: form.dataset.paymentId, account_id: account.id, entry_type: "payment", amount_cents, occurred_on, payment_method: method, description: charge ? `Payment — ${charge.description}` : "Account payment", category: charge?.category || null, order_item_id: charge?.order_item_id || null, reference: String(f.get("reference") || "").trim() || null, notes: String(f.get("notes") || "").trim() || null, source: "manual" };
    const { error } = await client.from("ledger_entries").insert(row); if (error) throw error;
    form.hidden = true; form.reset(); delete form.dataset.paymentId;
    await loadAll();
    if (state.activeLedgerId === account.id) renderAccountLedger(account.id);
    window.dispatchEvent(new Event("treasury-ledger-updated"));
    status(`Payment of ${money(amount_cents)} recorded for ${account.display_name}.`, "success");
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportAccountLedger() {
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    if (!account) return;
    const rows = ledgerRows(account);
    const data = [
      ["Date","Account","Type","Description","Category","Payment method","Reference","Amount","Running balance","Status","Notes"],
      ...rows.map(e => [e.occurred_on, accountName(e.account_id), human(e.entry_type), e.description, e.category || "", human(e.payment_method), e.reference || "", (Number(e.amount_cents) / 100).toFixed(2), (Number(e.running_balance_cents) / 100).toFixed(2), e.voided_at ? "Removed" : "Posted", e.notes || ""])
    ];
    const blob = new Blob([data.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${account.display_name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "account"}-ledger.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  function printAccountLedger() {
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    if (!account) return;
    const popup = window.open("", "_blank");
    if (!popup) throw new Error("Please allow pop-ups to print this ledger.");
    const table = $("#account-ledger .ledger-table-wrap").innerHTML;
    const summary = $(".ledger-summary").innerHTML;
    popup.document.write(`<!doctype html><html><head><title>${esc(account.display_name)} ledger</title><style>body{font:14px Arial,sans-serif;color:#172b3f;margin:32px}h1{color:#004b93;margin-bottom:4px}.meta{color:#53687c;margin-bottom:24px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}.summary div{padding:12px;border-top:4px solid #f5c400;background:#f4f7f9}.summary span,.summary strong{display:block}.summary strong{font-size:20px;margin-top:6px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #d8e0e8;text-align:left}th{background:#eef2f6}.money{text-align:right}.is-voided{opacity:.55;text-decoration:line-through}@media print{body{margin:0}}</style></head><body><h1>${esc(account.display_name)}</h1><div class="meta">${esc($("#ledger-meta").textContent)}</div><div class="summary">${summary}</div>${table}</body></html>`);
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 150);
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
    $("#access-table").innerHTML = state.users.length ? state.users.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.display_name || "—")}</td><td>${esc(human(u.role))}</td><td>${u.active ? "Active" : "Disabled"}</td><td>${u.active ? `<button type="button" class="btn-secondary" data-invite-user="${esc(u.email)}">Resend invitation</button>` : "—"}</td></tr>`).join("") : emptyRow(5, "No authorized users.");
  }

  async function sendUserInvitation(email, requestId) {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw new Error("Sign in again before sending an invitation.");
    const response = await fetch(INVITATION_API, {
      method: "POST", signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/json", authorization: "Bearer " + data.session.access_token },
      body: JSON.stringify({ email, request_id: requestId })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "The invitation could not be sent.");
  }

  async function savePortalAccess(form) {
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    let saved = false;
    status("Saving access and sending the invitation…", "", "#access-status");
    try {
      const f = new FormData(form);
      const email = String(f.get("email")).trim().toLowerCase();
      const { error } = await client.from("authorized_users").upsert({ email, display_name: String(f.get("display_name") || "").trim() || null, role: f.get("role"), active: true }, { onConflict: "email" });
      if (error) throw error;
      saved = true;
      form.dataset.invitationRequestId ||= crypto.randomUUID();
      await sendUserInvitation(email, form.dataset.invitationRequestId);
      form.reset(); delete form.dataset.invitationRequestId;
      await loadAll();
      status(`Access saved. Invitation email accepted for ${email}.`, "success", "#access-status");
    } catch (error) {
      if (saved) await loadAll();
      status(saved ? `Access is saved, but invitation delivery was not confirmed. ${error.message || "Try again."} You can retry this form or use Resend invitation.` : error.message || "Unable to save access.", "error", "#access-status");
    } finally { button.disabled = false; }
  }

  function updateAccountPickerCount() {
    const count = Array.from(document.querySelectorAll("#entry-accounts input[type='checkbox']:checked")).length;
    $("#entry-account-count").textContent = `${count} account${count === 1 ? "" : "s"} selected`;
  }

  function filterAccountPicker() {
    const query = $("#entry-account-search").value.trim().toLowerCase();
    Array.from(document.querySelectorAll("#entry-accounts .account-picker-option")).forEach(option => {
      option.hidden = Boolean(query) && !option.dataset.search.includes(query);
    });
  }

  function populateAccounts() {
    $("#entry-accounts").innerHTML = state.accounts.filter(a => a.active).map(a => {
      const type = a.account_type === "household" ? "Family" : a.account_type === "scout" ? "Scout" : "Parent";
      const detail = [type, a.den].filter(Boolean).join(" · ");
      const search = [a.display_name, a.household_name, a.den, type].filter(Boolean).join(" ").toLowerCase();
      return `<label class="account-picker-option" data-search="${esc(search)}"><input type="checkbox" name="account_ids" value="${a.id}"><span><strong>${esc(a.display_name)}</strong><small>${esc(detail)}</small></span></label>`;
    }).join("");
    filterAccountPicker();
    updateAccountPickerCount();
  }

  function openTab(name) {
    if (name === "bank" && !["admin", "treasurer"].includes(state.access?.role)) return;
    $$(".portal-tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
    $$(".portal-panel").forEach(p => p.classList.toggle("is-active", p.dataset.panel === name));
  }

  async function saveAccount(form) {
    const f = new FormData(form);
    const row = Object.fromEntries(["account_type","display_name","den","household_name","bsa_member_id","scoutbook_user_id","contact_email","notes"].map(k => [k, String(f.get(k) || "").trim() || null]));
    const { error } = await client.from("financial_accounts").insert(row); if (error) throw error;
  }

  async function setAccountActive(id, active) {
    const account = state.accounts.find(a => a.id === id);
    if (!account) throw new Error("Account not found.");
    const message = active
      ? `Restore ${account.display_name} to the current account list?`
      : `Remove ${account.display_name} from the current list? Financial history will be preserved and the account can be restored.`;
    if (!window.confirm(message)) return;
    const { error } = await client.from("financial_accounts").update({ active }).eq("id", id);
    if (error) throw error;
    await loadAll();
  }

  async function saveEntry(form) {
    const f = new FormData(form);
    const ids = Array.from(document.querySelectorAll("#entry-accounts input[type='checkbox']:checked")).map(input => input.value);
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


  const rosterSlug = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const rosterNameKey = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

  function familyNameFor(guardian, youthLastNames) {
    const guardianLast = String(guardian || "").trim().split(/\s+/).pop() || "Household";
    const lasts = [...new Set(youthLastNames.filter(Boolean))];
    if (!lasts.length) return guardianLast + " family";
    if (lasts.every(last => rosterNameKey(last) === rosterNameKey(guardianLast))) return guardianLast + " family";
    if (lasts.length === 1 && rosterNameKey(lasts[0]).includes(rosterNameKey(guardianLast))) return lasts[0].replaceAll("-", "–") + " family";
    if (lasts.length === 1) return lasts[0] + "–" + guardianLast + " family";
    return lasts.join("–") + "–" + guardianLast + " family";
  }

  function mapRoster(text) {
    const rows = parseCsv(text.replace(/^\uFEFF/, ""));
    let section = "";
    const adults = new Map();
    const youth = [];

    rows.forEach(row => {
      const cells = row.map(v => String(v || "").trim());
      const joined = cells.join(" ");
      if (/ADULT MEMBERS/i.test(joined)) { section = "adult"; return; }
      if (/YOUTH MEMBERS/i.test(joined)) { section = "youth"; return; }
      if (/First Name/i.test(joined) && /Last Name/i.test(joined)) return;
      const start = /^\d+$/.test(cells[0]) ? 1 : 0;
      const first = cells[start], last = cells[start + 1];
      if (!section || !first || !last) return;

      if (section === "adult") {
        const name = (first + " " + last).trim();
        const matches = [...joined.matchAll(/\b(Lion|Tiger|Wolf|Bear|Webelos|Arrow of Light)\b/gi)].map(m => human(m[1].toLowerCase()));
        const current = adults.get(rosterNameKey(name)) || { name, dens: new Set() };
        matches.forEach(den => current.dens.add(den));
        adults.set(rosterNameKey(name), current);
        return;
      }

      const relationshipIndex = cells.findIndex(v => /Pathway to Adventure|Father of|Mother of|Guardian/i.test(v));
      if (relationshipIndex < 0) return;
      const relationshipText = cells[relationshipIndex];
      const guardianId = relationshipText.match(/\((\d+)\)/)?.[1] || "";
      const candidates = cells.slice(start + 2, relationshipIndex).filter(v =>
        v && !/Pack\s*3963/i.test(v) && !/^(Junior|Senior|Jr\.?|Sr\.?)$/i.test(v)
      );
      const guardian = candidates[candidates.length - 1] || "";
      if (!guardian) return;
      const suffix = cells.slice(start + 2, relationshipIndex).find(v => /^(Junior|Senior|Jr\.?|Sr\.?)$/i.test(v)) || "";
      const displaySuffix = /^junior$/i.test(suffix) ? " Jr." : /^senior$/i.test(suffix) ? " Sr." : suffix ? " " + suffix : "";
      const adult = adults.get(rosterNameKey(guardian));
      const dens = adult ? [...adult.dens] : [];
      youth.push({
        guardian_id: guardianId || "name-" + rosterSlug(guardian),
        guardian,
        guardian_relationship: /Mother/i.test(relationshipText) ? "Mother / guardian" : /Father/i.test(relationshipText) ? "Father / guardian" : "Parent / guardian",
        first_name: first,
        last_name: last,
        display_name: first + " " + last + displaySuffix,
        den: dens.length === 1 ? dens[0] : null,
        suffix
      });
    });

    if (!youth.length) throw new Error("No youth members were found. Choose the Scoutbook Roster Report CSV.");
    const groups = new Map();
    youth.forEach(scout => {
      const group = groups.get(scout.guardian_id) || { guardian_id: scout.guardian_id, guardian: scout.guardian, guardian_relationship: scout.guardian_relationship, scouts: [] };
      group.scouts.push(scout);
      groups.set(scout.guardian_id, group);
    });
    const households = [...groups.values()].map(group => ({
      ...group,
      family_name: familyNameFor(group.guardian, group.scouts.map(s => s.last_name)),
      den: [...new Set(group.scouts.map(s => s.den).filter(Boolean))].join(" / ") || null
    }));
    const familyByGuardian = new Map(households.map(h => [h.guardian_id, h]));
    youth.forEach(scout => { scout.family_name = familyByGuardian.get(scout.guardian_id).family_name; });
    return { scouts: youth, households };
  }

  function previewRoster(mapped, fileName) {
    state.rosterRows = mapped.scouts;
    state.rosterHouseholds = mapped.households;
    state.rosterFileName = fileName;
    const uncertain = mapped.scouts.filter(s => !s.den).length;
    $("#roster-summary").innerHTML = [
      ["Scouts", mapped.scouts.length], ["Families", mapped.households.length], ["Dens to confirm", uncertain]
    ].map(([label, value]) => `<article class="summary-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join("");
    $("#roster-table").innerHTML = mapped.scouts.map(s => `<tr><td>${esc(s.display_name)}</td><td>${esc(s.family_name)}</td><td>${esc(s.guardian)}</td><td>${esc(s.den || "Needs confirmation")}</td></tr>`).join("");
    $("#roster-preview").hidden = false;
    status(`Review ${mapped.scouts.length} Scouts and ${mapped.households.length} families before updating the roster.`, "", "#roster-status");
  }

  async function runRosterImport() {
    if (!state.rosterRows.length) return;
    status("Updating Scouts and family accounts…", "", "#roster-status");
    const rosterDate = today();
    const importResult = await client.from("roster_imports").insert({
      source_filename: state.rosterFileName || "Scoutbook Roster Report.csv",
      roster_date: rosterDate,
      scout_count: state.rosterRows.length,
      household_count: state.rosterHouseholds.length,
      notes: "Imported through the Pack 3963 Treasurer Portal"
    }).select().single();
    if (importResult.error) throw importResult.error;
    const importId = importResult.data.id;

    const householdRows = state.rosterHouseholds.map(h => ({
      account_type: "household",
      display_name: h.family_name,
      household_name: h.family_name,
      den: h.den,
      bsa_member_id: /^\d+$/.test(h.guardian_id) ? h.guardian_id : null,
      active: true,
      notes: "Primary guardian: " + h.guardian,
      roster_key: "household:" + h.guardian_id,
      roster_managed: true,
      last_seen_roster_on: rosterDate,
      last_roster_import_id: importId
    }));
    let result = await client.from("financial_accounts").upsert(householdRows, { onConflict: "roster_key" });
    if (result.error) throw result.error;

    const householdKeys = householdRows.map(h => h.roster_key);
    result = await client.from("financial_accounts").select("id,roster_key,household_name").in("roster_key", householdKeys);
    if (result.error) throw result.error;
    const householdByKey = new Map(result.data.map(h => [h.roster_key, h]));
    const importedKeys = new Set(householdKeys);

    const scoutRows = state.rosterRows.map(s => {
      const parent = householdByKey.get("household:" + s.guardian_id);
      const rosterKey = "scout:" + s.guardian_id + ":" + rosterSlug(s.display_name);
      importedKeys.add(rosterKey);
      return {
        account_type: "scout",
        display_name: s.display_name,
        scout_first_name: s.first_name,
        scout_last_name: s.last_name,
        household_name: s.family_name,
        den: s.den,
        active: true,
        notes: "Guardian: " + s.guardian + (s.den ? "" : "; den requires confirmation"),
        parent_account_id: parent.id,
        roster_key: rosterKey,
        roster_managed: true,
        last_seen_roster_on: rosterDate,
        last_roster_import_id: importId
      };
    });
    result = await client.from("financial_accounts").upsert(scoutRows, { onConflict: "roster_key" });
    if (result.error) throw result.error;

    const existingContactKeys = new Set(state.householdContacts.map(c => c.household_account_id + "|" + rosterNameKey(c.full_name)));
    const newContacts = state.rosterHouseholds.map(h => {
      const parent = householdByKey.get("household:" + h.guardian_id);
      return {
        household_account_id: parent.id,
        full_name: h.guardian,
        relationship: h.guardian_relationship,
        is_primary: true,
        source: "roster",
        active: true
      };
    }).filter(c => !existingContactKeys.has(c.household_account_id + "|" + rosterNameKey(c.full_name)));
    if (newContacts.length) {
      result = await client.from("household_contacts").insert(newContacts);
      if (result.error) throw result.error;
    }

    let archived = 0;
    if ($("#archive-missing-roster").checked) {
      const missingIds = state.accounts.filter(a => a.roster_managed && a.active && !importedKeys.has(a.roster_key)).map(a => a.id);
      if (missingIds.length) {
        result = await client.from("financial_accounts").update({ active: false }).in("id", missingIds);
        if (result.error) throw result.error;
        archived = missingIds.length;
      }
    }

    status(`Roster updated: ${scoutRows.length} Scouts, ${householdRows.length} families, ${archived} older account${archived === 1 ? "" : "s"} marked inactive.`, "success", "#roster-status");
    state.rosterRows = []; state.rosterHouseholds = []; state.rosterFileName = "";
    $("#roster-preview").hidden = true; $("#roster-file").value = "";
    await loadAll();
  }


  async function submitHandler(form, action, success) {
    status("Saving…");
    try { await action(form); form.reset(); setDefaults(); if (form.classList.contains("collapsible-form")) form.hidden = true; status(success, "success"); await loadAll(); }
    catch (error) { status(error.message || "Unable to save.", "error"); }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    window.addEventListener("treasury-imported", loadAll);
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
    [["#show-account-form","#account-form"],["#show-entry-form","#entry-form"],["#show-expense-form","#expense-form"],["#show-bank-form","#bank-form"]].forEach(([button, form]) => $(button).addEventListener("click", () => { $(form).hidden = false; $(form).scrollIntoView({ behavior: "smooth", block: "start" }); }));
    $$("[data-close-form]").forEach(b => b.addEventListener("click", () => { $("#" + b.dataset.closeForm).hidden = true; }));
    $("#account-search").addEventListener("input", renderAccounts); $("#account-type-filter").addEventListener("change", renderAccounts); $("#balance-filter").addEventListener("change", renderAccounts);
    $("#entry-account-search").addEventListener("input", filterAccountPicker);
    $("#entry-accounts").addEventListener("change", updateAccountPickerCount);
    $("#select-visible-accounts").addEventListener("click", () => {
      Array.from(document.querySelectorAll("#entry-accounts .account-picker-option:not([hidden]) input[type='checkbox']")).forEach(input => { input.checked = true; });
      updateAccountPickerCount();
    });
    $("#clear-entry-accounts").addEventListener("click", () => {
      Array.from(document.querySelectorAll("#entry-accounts input[type='checkbox']")).forEach(input => { input.checked = false; });
      updateAccountPickerCount();
    });
    $("#transaction-search").addEventListener("input", renderTransactions); $("#transaction-filter").addEventListener("change", renderTransactions);
    $("#expense-search").addEventListener("input", renderExpenses); $("#expense-filter").addEventListener("change", renderExpenses);
    $("#account-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, saveAccount, "Account added."); });
    $("#entry-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, saveEntry, "Charge or payment saved."); });
    $("#expense-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, saveExpense, "Expense saved."); });
    $("#bank-form").addEventListener("submit", e => { e.preventDefault(); submitHandler(e.currentTarget, async form => {
      const f = new FormData(form); const { error } = await client.from("bank_balance_snapshots").insert({ balance_cents: cents(f.get("balance")), as_of_date: f.get("as_of_date"), notes: String(f.get("notes") || "").trim() || null }); if (error) throw error;
    }, "Bank balance snapshot saved."); });
    $("#access-form").addEventListener("submit", e => { e.preventDefault(); savePortalAccess(e.currentTarget); });
    $("#access-form").addEventListener("input", e => { delete e.currentTarget.dataset.invitationRequestId; });
    $("#access-table").addEventListener("click", async e => {
      const button = e.target.closest("[data-invite-user]");
      if (!button || button.disabled) return;
      button.disabled = true;
      button.dataset.invitationRequestId ||= crypto.randomUUID();
      status("Sending invitation…", "", "#access-status");
      try {
        await sendUserInvitation(button.dataset.inviteUser, button.dataset.invitationRequestId);
        delete button.dataset.invitationRequestId;
        status(`Invitation email accepted for ${button.dataset.inviteUser}.`, "success", "#access-status");
      } catch (error) { status(error.message || "Unable to send invitation. Try again.", "error", "#access-status"); }
      finally { button.disabled = false; }
    });
    $("#accounts-table").addEventListener("click", async e => {
      const ledgerButton = e.target.closest("[data-view-ledger]");
      if (ledgerButton) { renderAccountLedger(ledgerButton.dataset.viewLedger); return; }
      const b = e.target.closest("button[data-account-id]"); if (!b) return;
      try { await setAccountActive(b.dataset.accountId, b.dataset.accountActive === "true"); }
      catch (error) { status(error.message || "Unable to update the account.", "error"); }
    });
    $("#close-account-ledger").addEventListener("click", () => { $("#account-ledger").hidden = true; state.activeLedgerId = null; });
    $("#export-ledger-csv").addEventListener("click", exportAccountLedger);
    $("#show-ledger-payment").addEventListener("click", openLedgerPayment);
    $("#close-ledger-payment").addEventListener("click", () => { $("#ledger-payment-form").hidden = true; });
    $("#ledger-payment-form").addEventListener("submit", async e => {
      e.preventDefault(); const form = e.currentTarget, button = form.querySelector("button[type=submit]");
      if (button.disabled) return; button.disabled = true;
      status("Saving payment…", "", "#ledger-payment-status");
      try { await saveLedgerPayment(form); } catch (error) { status(error.message || "Unable to save payment.", "error", "#ledger-payment-status"); }
      finally { button.disabled = false; }
    });
    $("#print-account-ledger").addEventListener("click", () => { try { printAccountLedger(); } catch (error) { status(error.message, "error"); } });
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
    $("#roster-file").addEventListener("change", async e => {
      const file = e.target.files[0]; if (!file) return;
      try { previewRoster(mapRoster(await file.text()), file.name); }
      catch (error) { status(error.message, "error", "#roster-status"); }
    });
    $("#run-roster-import").addEventListener("click", async () => {
      try { await runRosterImport(); }
      catch (error) { status(error.message || "Unable to update the roster.", "error", "#roster-status"); }
    });
    const { data } = await client.auth.getSession();
    if (data.session) await authorize(data.session);
    client.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_IN" && session && state.user?.id !== session.user.id) setTimeout(() => authorize(session), 0); });
  });
})();
