(() => {
  "use strict";

  const SUPABASE_URL = "https://buvrqioskjjhszqkpypa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
  const INVITATION_API = "https://pack3963-auth-email.cubscouts3963.workers.dev/api/treasurer/invite-user";
  const RECEIPT_DRIVE_SYNC_API = "https://pack3963-auth-email.cubscouts3963.workers.dev/api/treasurer/receipt-drive-sync";
  const INVOICE_DRIVE_SYNC_API = "https://pack3963-auth-email.cubscouts3963.workers.dev/api/treasurer/invoice-drive-sync";
  const TREASURER_EMAIL_API = "https://pack3963-treasury-email.cubscouts3963.workers.dev/api/treasurer/send-email";
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
  });
  const state = { user: null, access: null, accounts: [], entries: [], expenses: [], receipts: [], summary: null, users: [], audit: [], householdContacts: [], importRows: [], rosterRows: [], rosterHouseholds: [], rosterFileName: "", activeLedgerId: null };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
  const signedMoney = (entry) => `${entry.entry_type === "charge" ? "+" : "−"}${money(entry.amount_cents)}`;
  const entryMoneyClass = (entry) => entry.entry_type === "charge" ? "balance-due" : "balance-credit";
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
      if (state.access?.role === "admin") {
        requests.push(client.from("authorized_users").select("*").order("email"));
        requests.push(client.from("audit_log").select("*").order("changed_at", { ascending: false }).limit(1000));
      }
      const results = await Promise.all(requests);
      state.accounts = checked(results[0].data, results[0].error) || [];
      state.entries = checked(results[1].data, results[1].error) || [];
      state.expenses = checked(results[2].data, results[2].error) || [];
      state.receipts = checked(results[3].data, results[3].error) || [];
      state.summary = checked(results[4].data, results[4].error) || {};
      state.householdContacts = checked(results[5].data, results[5].error) || [];
      state.users = results[6] ? checked(results[6].data, results[6].error) || [] : [];
      state.audit = results[7] ? checked(results[7].data, results[7].error) || [] : [];
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
    renderSummary(); renderAccounts(); renderTransactions(); renderExpenses(); renderAccess(); renderAudit(); populateAccounts();
  }

  function renderSummary() {
    const s = state.summary || {};
    $("#summary-bank").textContent = s.projected_bank_balance_cents == null ? "—" : money(s.projected_bank_balance_cents);
    $("#summary-bank-date").textContent = s.latest_bank_balance_date ? `Projected from snapshot dated ${s.latest_bank_balance_date}` : "No snapshot yet";
    $("#bank-current-balance").textContent = $("#summary-bank").textContent;
    $("#bank-current-date").textContent = s.latest_bank_balance_date ? `Projected from reconciled balance dated ${s.latest_bank_balance_date}` : "No balance recorded yet";
    $("#bank-reconciliation").hidden = s.latest_bank_balance_cents == null;
    $("#bank-snapshot-balance").textContent = money(s.latest_bank_balance_cents);
    $("#bank-income").textContent = "+" + money(s.pack_income_since_snapshot_cents);
    $("#bank-spending").textContent = "−" + money(s.pack_spending_since_snapshot_cents);
    $("#summary-due").textContent = money(s.total_due_cents);
    $("#summary-credits").textContent = money(s.total_credit_cents);
    $("#summary-expenses").textContent = money(s.total_expenses_cents);
    const familyBalances = familyGroups().filter(group => group.active);
    const due = familyBalances.filter(group => group.balance_cents > 0).length;
    const credits = familyBalances.filter(group => group.balance_cents < 0).length;
    $("#summary-due-count").textContent = `${due} famil${due === 1 ? "y" : "ies"} with a balance`;
    $("#summary-credit-count").textContent = `${credits} famil${credits === 1 ? "y" : "ies"} with credit`;
    $("#summary-reimbursements").textContent = `${money(s.reimbursements_due_cents)} awaiting reimbursement`;
    const missing = state.expenses.filter(e => !e.voided_at && !state.receipts.some(r => r.expense_id === e.id)).length;
    const unpaid = state.expenses.filter(e => !e.voided_at && e.expense_type === "reimbursement" && e.status !== "paid").length;
    const priorities = [
      `${due} famil${due === 1 ? "y" : "ies"} currently ${due === 1 ? "has" : "have"} a balance due.`,
      `${unpaid} reimbursement${unpaid === 1 ? "" : "s"} still need payment.`,
      `${missing} expense${missing === 1 ? "" : "s"} do not have a receipt attached.`
    ];
    $("#priority-list").innerHTML = priorities.map(x => `<li>${esc(x)}</li>`).join("");
    const recent = state.entries.filter(e => !e.voided_at).slice(0, 8);
    $("#recent-activity").innerHTML = recent.length ? recent.map(e => `<tr><td>${esc(e.occurred_on)}</td><td>${esc(accountName(e.account_id))}</td><td>${esc(human(e.entry_type))}</td><td>${esc(e.description)}</td><td class="money ${entryMoneyClass(e)}">${signedMoney(e)}</td></tr>`).join("") : emptyRow(5, "No activity recorded yet.");
  }

  function familyGroups() {
    const households = state.accounts.filter(account => account.account_type === "household");
    const linkedIds = new Set();
    const groups = households.map(family => {
      const scouts = state.accounts.filter(account => account.account_type === "scout" && account.parent_account_id === family.id);
      const members = [family, ...scouts];
      members.forEach(member => linkedIds.add(member.id));
      return {
        family, scouts, members,
        contacts: state.householdContacts.filter(contact => contact.household_account_id === family.id && contact.active),
        balance_cents: members.reduce((sum, member) => sum + Number(member.balance_cents || 0), 0),
        active: Boolean(family.active)
      };
    });
    state.accounts.filter(account => !linkedIds.has(account.id)).forEach(account => {
      groups.push({
        family: account,
        scouts: account.account_type === "scout" ? [account] : [],
        members: [account],
        contacts: [],
        balance_cents: Number(account.balance_cents || 0),
        active: Boolean(account.active),
        unlinked: true
      });
    });
    return groups;
  }

  function filteredAccounts() {
    const q = $("#account-search").value.trim().toLowerCase();
    const statusFilter = $("#balance-filter").value;
    return familyGroups().filter(group => {
      const searchableAccounts = group.members.flatMap(account => [account.display_name, account.den, account.household_name, account.bsa_member_id, account.scoutbook_user_id]);
      const searchableContacts = group.contacts.flatMap(contact => [contact.full_name, contact.email, contact.phone]);
      const hay = [...searchableAccounts, ...searchableContacts].filter(Boolean).join(" ").toLowerCase();
      const b = group.balance_cents;
      const statusMatch = statusFilter === "current" ? group.active : statusFilter === "due" ? b > 0 && group.active : statusFilter === "credit" ? b < 0 && group.active : statusFilter === "paid" ? b === 0 && group.active : statusFilter === "inactive" ? !group.active : true;
      return (!q || hay.includes(q)) && statusMatch;
    });
  }

  function renderAccounts() {
    const canWrite = ["admin", "treasurer"].includes(state.access?.role);
    const rows = filteredAccounts();
    $("#accounts-table").innerHTML = rows.length ? rows.map(group => {
      const a = group.family;
      const b = group.balance_cents;
      const cls = b > 0 ? "balance-due" : b < 0 ? "balance-credit" : "";
      const label = b > 0 ? "Due" : b < 0 ? "Credit" : "Paid / even";
      const primary = group.contacts.find(contact => contact.is_primary) || group.contacts[0];
      const contactNames = group.contacts.length ? group.contacts.map(contact => contact.full_name).join(", ") : "No contacts listed";
      const contactEmail = primary?.email || a.contact_email || "No email on file";
      const scoutList = group.scouts.length ? group.scouts.map(scout => `<span class="family-scout"><strong>${esc(scout.display_name)}</strong>${scout.den ? `<small>${esc(scout.den)}</small>` : ""}</span>`).join("") : '<span class="family-scout"><small>No Scouts linked</small></span>';
      const action = canWrite ? `<button class="action-button" data-account-active="${a.active ? "false" : "true"}" data-account-id="${a.id}" type="button">${a.active ? "Remove" : "Restore"}</button>` : "";
      const note = group.unlinked ? '<br><small class="balance-due">Needs a family link</small>' : "";
      return `<tr class="${a.active ? "" : "is-voided"}"><td><button class="ledger-link" data-view-ledger="${a.id}" type="button"><strong>${esc(a.display_name)}</strong></button>${note}</td><td><div class="family-scout-list">${scoutList}</div></td><td><strong>${esc(contactNames)}</strong><br><small>${esc(contactEmail)}</small></td><td class="money ${cls}">${money(Math.abs(b))}</td><td><span class="status-pill">${esc(a.active ? label : "Inactive")}</span></td><td><div class="family-row-actions"><button class="action-button" data-view-ledger="${a.id}" type="button">View family ledger</button>${action}</div></td></tr>`;
    }).join("") : emptyRow(6, "No matching families.");
  }


  function ledgerScope(account) {
    if (account.account_type !== "household") return [account];
    return [account, ...state.accounts.filter(a => a.parent_account_id === account.id)];
  }

  function ledgerRows(account, includeVoided = false) {
    const ids = new Set(ledgerScope(account).map(a => a.id));
    let running = 0;
    return state.entries.filter(e => ids.has(e.account_id) && (includeVoided || !e.voided_at)).sort((a, b) =>
      String(a.occurred_on).localeCompare(String(b.occurred_on)) || String(a.created_at).localeCompare(String(b.created_at))
    ).map(entry => {
      const impact = entry.voided_at ? 0 : (entry.entry_type === "charge" ? Number(entry.amount_cents) : -Number(entry.amount_cents));
      running += impact;
      return { ...entry, running_balance_cents: running };
    });
  }

  function ledgerFamily(account) {
    return account?.account_type === "scout"
      ? state.accounts.find(a => a.id === account.parent_account_id) || null
      : account?.account_type === "household" ? account : null;
  }

  function familyContacts(account) {
    const family = ledgerFamily(account);
    if (!family) return { family: null, contacts: [] };
    const contacts = state.householdContacts
      .filter(contact => contact.household_account_id === family.id && contact.active)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || String(a.full_name).localeCompare(String(b.full_name)));
    return { family, contacts };
  }

  function primaryFamilyContact(account) {
    const { family, contacts } = familyContacts(account);
    return { family, contact: contacts[0] || null };
  }

  function renderLedgerContact(account) {
    const { family, contacts } = familyContacts(account);
    const canWrite = !!family && ["admin", "treasurer"].includes(state.access?.role);
    const fallbackEmail = family?.contact_email || account.contact_email || "";
    const visibleContacts = contacts.length ? contacts : (fallbackEmail ? [{
      id: "", full_name: family?.display_name || account.display_name, email: fallbackEmail,
      relationship: "Parent / guardian", is_primary: true, legacy: true
    }] : []);
    $("#ledger-contact-list").innerHTML = visibleContacts.length ? visibleContacts.map(contact => `
      <article class="ledger-contact-card">
        <div class="ledger-contact-copy">
          <div><strong>${esc(contact.full_name || "Parent / guardian")}</strong>${contact.is_primary ? '<span class="contact-badge">Primary</span>' : ""}</div>
          <a href="mailto:${esc(contact.email || "")}">${esc(contact.email || "No email on file")}</a>
          <small>${esc(contact.relationship || "Parent / guardian")}</small>
        </div>
        ${canWrite ? `<div class="ledger-contact-actions"><button class="btn-secondary" type="button" data-edit-family-contact="${esc(contact.id || "")}">Edit</button>${contact.id ? `<button class="text-button danger-link" type="button" data-remove-family-contact="${esc(contact.id)}">Remove</button>` : ""}</div>` : ""}
      </article>`).join("") : '<p class="empty-contact">No parent or guardian contact is on file.</p>';
    $("#add-ledger-contact").hidden = !canWrite;
    $("#email-account-balance").hidden = !canWrite || !visibleContacts.some(contact => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email || ""));
  }

  function renderAccountLedger(id) {
    const account = state.accounts.find(a => a.id === id);
    if (!account) return;
    const switching = state.activeLedgerId && state.activeLedgerId !== id;
    state.activeLedgerId = id;
    if (switching) {
      $("#ledger-contact-form").hidden = true;
      $("#ledger-email-form").hidden = true;
    }
    const paymentForm = $("#ledger-payment-form");
    if (paymentForm.dataset.accountId !== id) { paymentForm.hidden = true; paymentForm.reset(); delete paymentForm.dataset.paymentId; }
    paymentForm.dataset.accountId = id;
    $("#show-ledger-payment").hidden = !account.active || !["admin", "treasurer"].includes(state.access?.role);
    const scope = ledgerScope(account);
    const allRows = ledgerRows(account, $("#show-removed-ledger")?.checked);
    const accountFilter = $("#ledger-account-filter");
    const priorFilter = accountFilter.value || "all";
    accountFilter.innerHTML = '<option value="all">Entire family</option>' + scope.map(member => `<option value="${member.id}">${esc(member.account_type === "household" ? "Family-level charges" : member.display_name)}</option>`).join("");
    accountFilter.value = scope.some(member => member.id === priorFilter) ? priorFilter : "all";
    const rows = accountFilter.value === "all" ? allRows : allRows.filter(entry => entry.account_id === accountFilter.value);
    const activeRows = allRows.filter(e => !e.voided_at);
    const charges = activeRows.filter(e => e.entry_type === "charge").reduce((sum, e) => sum + Number(e.amount_cents), 0);
    const payments = activeRows.filter(e => e.entry_type !== "charge").reduce((sum, e) => sum + Number(e.amount_cents), 0);
    const balance = scope.reduce((sum, a) => sum + Number(a.balance_cents || 0), 0);
    $("#ledger-title").textContent = account.display_name;
    $("#ledger-meta").textContent = account.account_type === "household"
      ? `${scope.length - 1} Scout${scope.length - 1 === 1 ? "" : "s"} · one consolidated balance for the family`
      : `${human(account.account_type)}${account.den ? " · " + account.den : ""}`;
    renderLedgerContact(account);
    $("#ledger-members").innerHTML = scope.map(member => {
      const memberBalance = Number(member.balance_cents || 0);
      const memberClass = memberBalance > 0 ? "balance-due" : memberBalance < 0 ? "balance-credit" : "";
      const memberLabel = member.account_type === "household" ? "Family-level charges" : [member.display_name, member.den].filter(Boolean).join(" · ");
      return `<button type="button" class="family-member-balance${accountFilter.value === member.id ? " is-selected" : ""}" data-ledger-member="${member.id}"><span>${esc(memberLabel)}</span><strong class="${memberClass}">${money(Math.abs(memberBalance))}</strong><small>${memberBalance > 0 ? "Due" : memberBalance < 0 ? "Credit" : "Paid / even"}</small></button>`;
    }).join("");
    $("#ledger-charges").textContent = money(charges);
    $("#ledger-payments").textContent = money(payments);
    $("#ledger-balance").textContent = money(balance);
    $("#ledger-balance").className = balance > 0 ? "balance-due" : balance < 0 ? "balance-credit" : "";
    $("#ledger-table").innerHTML = rows.length ? rows.map(e => `<tr class="${e.voided_at ? "is-voided" : ""}"><td>${esc(e.occurred_on)}</td><td>${esc(accountName(e.account_id))}</td><td><strong>${esc(e.description)}</strong>${e.category ? `<br><small>${esc(e.category)}</small>` : ""}${e.affects_pack_balance ? '<br><small class="balance-credit">Included in Pack balance</small>' : ""}</td><td>${esc(human(e.entry_type))}</td><td class="money ${entryMoneyClass(e)}">${signedMoney(e)}</td><td class="money">${money(e.running_balance_cents)}</td><td>${e.voided_at ? "Removed" : "Posted"}</td></tr>`).join("") : emptyRow(7, "No matching ledger entries for this family.");
    $("#account-ledger").hidden = false;
    $("#account-ledger").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openLedgerContactForm(contactId = "") {
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    const { family, contacts } = familyContacts(account);
    if (!family) throw new Error("This account is not linked to a family account.");
    const contact = contacts.find(item => item.id === contactId) || null;
    const form = $("#ledger-contact-form");
    form.reset();
    form.elements.household_account_id.value = family.id;
    form.elements.contact_id.value = contact?.id || "";
    form.elements.full_name.value = contact?.full_name || "";
    form.elements.email.value = contact?.email || "";
    form.elements.relationship.value = contact?.relationship || "Parent";
    form.elements.is_primary.checked = contact ? !!contact.is_primary : contacts.length === 0;
    $("#ledger-contact-form-title").textContent = contact ? "Edit parent or guardian" : "Add parent or guardian";
    status("", "", "#ledger-contact-status");
    form.hidden = false;
    form.elements.full_name.focus();
  }

  async function syncLegacyFamilyEmail(householdId) {
    const current = state.householdContacts
      .filter(contact => contact.household_account_id === householdId && contact.active && contact.email)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0];
    const email = current?.email || null;
    let result = await client.from("financial_accounts").update({ contact_email: email }).eq("id", householdId);
    if (result.error) throw result.error;
    result = await client.from("financial_accounts").update({ contact_email: email }).eq("parent_account_id", householdId);
    if (result.error) throw result.error;
  }

  async function saveLedgerContact(form) {
    if (!["admin", "treasurer"].includes(state.access?.role)) throw new Error("Your role cannot edit family contacts.");
    const f = new FormData(form), householdId = String(f.get("household_account_id") || "");
    const family = state.accounts.find(a => a.id === householdId && a.account_type === "household");
    if (!family) throw new Error("The linked family account could not be found.");
    const fullName = String(f.get("full_name") || "").trim();
    const email = String(f.get("email") || "").trim().toLowerCase();
    const relationship = String(f.get("relationship") || "Parent").slice(0, 80);
    const currentContacts = state.householdContacts.filter(contact => contact.household_account_id === householdId && contact.active);
    const makePrimary = f.get("is_primary") === "on" || currentContacts.length === 0;
    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter the parent or guardian name and a valid email address.");
    if (makePrimary && currentContacts.length) {
      const demote = await client.from("household_contacts").update({ is_primary: false }).eq("household_account_id", householdId).eq("active", true);
      if (demote.error) throw demote.error;
    }
    const payload = { full_name: fullName, email, relationship, is_primary: makePrimary, active: true };
    let result;
    if (f.get("contact_id")) {
      result = await client.from("household_contacts").update(payload).eq("id", f.get("contact_id")).eq("household_account_id", householdId);
    } else {
      result = await client.from("household_contacts").insert({ household_account_id: householdId, ...payload, source: "manual" });
    }
    if (result.error) throw result.error;
    form.hidden = true;
    await loadAll();
    await syncLegacyFamilyEmail(householdId);
    await loadAll();
    if (state.activeLedgerId) renderAccountLedger(state.activeLedgerId);
  }

  async function removeLedgerContact(contactId) {
    if (!["admin", "treasurer"].includes(state.access?.role)) throw new Error("Your role cannot remove family contacts.");
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    const { family, contacts } = familyContacts(account);
    const contact = contacts.find(item => item.id === contactId);
    if (!family || !contact) throw new Error("That contact could not be found.");
    const result = await client.from("household_contacts").update({ active: false, is_primary: false }).eq("id", contactId).eq("household_account_id", family.id);
    if (result.error) throw result.error;
    const remaining = contacts.filter(item => item.id !== contactId);
    if (contact.is_primary && remaining.length) {
      const promote = await client.from("household_contacts").update({ is_primary: true }).eq("id", remaining[0].id);
      if (promote.error) throw promote.error;
    }
    await loadAll();
    await syncLegacyFamilyEmail(family.id);
    await loadAll();
    renderAccountLedger(state.activeLedgerId);
  }

  function ledgerEmailEntries(account) {
    const ids = new Set(ledgerScope(account).map(member => member.id));
    return state.entries
      .filter(entry => ids.has(entry.account_id) && !entry.voided_at)
      .sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.created_at).localeCompare(String(a.created_at)));
  }

  function updateLedgerEmailCounts() {
    const recipients = $$("#ledger-email-recipients input:checked").length;
    const entries = $$("#ledger-email-items input:checked").length;
    $("#send-ledger-email").textContent = `Send ${entries} item${entries === 1 ? "" : "s"} to ${recipients} contact${recipients === 1 ? "" : "s"}`;
  }

  function setLedgerItemSelection(mode) {
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    const rows = ledgerEmailEntries(account);
    $$("#ledger-email-items input").forEach(input => {
      const entry = rows.find(row => row.id === input.value);
      input.checked = mode === "all" || (mode === "outstanding" && entry?.entry_type === "charge" && chargeRemaining(entry) > 0);
    });
    updateLedgerEmailCounts();
  }

  function composeLedgerBalanceEmail() {
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    const { family, contacts } = familyContacts(account);
    const validContacts = contacts.filter(contact => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email || ""));
    if (!family || !validContacts.length) throw new Error("Add a family email address before sending balance details.");
    const rows = ledgerEmailEntries(account);
    if (!rows.length) throw new Error("This family does not have any ledger items to email.");
    $("#ledger-email-recipients").innerHTML = validContacts.map(contact => `<label class="ledger-email-option"><input type="checkbox" value="${esc(contact.id)}" ${contact.is_primary || validContacts.length === 1 ? "checked" : ""}><span><strong>${esc(contact.full_name)}</strong><small>${esc(contact.email)}${contact.relationship ? " · " + esc(contact.relationship) : ""}</small></span></label>`).join("");
    $("#ledger-email-items").innerHTML = rows.map(entry => {
      const outstanding = entry.entry_type === "charge" && chargeRemaining(entry) > 0;
      return `<label class="ledger-email-option"><input type="checkbox" value="${esc(entry.id)}" ${outstanding ? "checked" : ""}><span><strong>${esc(entry.description)}</strong><small>${esc(entry.occurred_on)} · ${esc(accountName(entry.account_id))} · ${signedMoney(entry)}${outstanding ? " · " + money(chargeRemaining(entry)) + " outstanding" : ""}</small></span></label>`;
    }).join("");
    const form = $("#ledger-email-form");
    form.elements.subject.value = `Pack 3963 balance details — ${family.display_name}`;
    form.elements.body_text.value = "Here are the selected details from your Pack 3963 family account. Please review the items below and contact us if a payment is missing or you have a question.\n\nThank you for supporting Pack 3963.";
    status("", "", "#ledger-email-status");
    form.hidden = false;
    updateLedgerEmailCounts();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function sendLedgerBalanceEmail(form) {
    if (!["admin", "treasurer"].includes(state.access?.role)) throw new Error("Your role cannot send family account email.");
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    const { family } = familyContacts(account);
    if (!family) throw new Error("This family account could not be found.");
    const contactIds = $$("#ledger-email-recipients input:checked").map(input => input.value);
    const entryIds = $$("#ledger-email-items input:checked").map(input => input.value);
    if (!contactIds.length) throw new Error("Select at least one parent or guardian.");
    if (!entryIds.length) throw new Error("Select at least one ledger item.");
    const session = (await client.auth.getSession()).data.session;
    if (!session) throw new Error("Your session expired. Sign in again.");
    const f = new FormData(form);
    const response = await fetch(TREASURER_EMAIL_API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + session.access_token },
      body: JSON.stringify({
        household_ids: [family.id],
        contact_ids: contactIds,
        ledger_entry_ids: entryIds,
        delivery_mode: "ledger",
        message_type: "invoice",
        subject: String(f.get("subject") || "").trim(),
        body_text: String(f.get("body_text") || "").trim()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to send the family email.");
    if (Array.isArray(data.invoice_ids) && data.invoice_ids.length) {
      try { data.drive_archive = await requestInvoiceDriveSync({ invoice_ids: data.invoice_ids }); }
      catch (error) { data.drive_archive = { synced: 0, failed: data.invoice_ids.length, error: error.message || "Invoice archive failed." }; }
    }
    return data;
  }

  function chargeRemaining(charge) {
    const settled = state.entries.filter(entry => entry.related_charge_id === charge.id && !entry.voided_at && entry.entry_type !== "charge")
      .reduce((sum, entry) => sum + Number(entry.amount_cents), 0);
    return Math.max(0, Number(charge.amount_cents) - settled);
  }

  function syncLedgerSettlementForm() {
    const form = $("#ledger-payment-form");
    const assistance = form.elements.settlement_type.value === "assistance";
    $("#ledger-settlement-heading").textContent = assistance ? "Record Pack-covered assistance" : "Record a family payment";
    $("#ledger-payment-method-field").hidden = assistance;
    form.elements.payment_method.required = !assistance;
    $("#ledger-balance-impact-field").hidden = assistance;
    $("#ledger-balance-impact-help").hidden = assistance;
    $("#ledger-assistance-help").hidden = !assistance;
    form.elements.notes.required = assistance;
    form.elements.charge_id.required = assistance;
    $("#save-ledger-settlement").textContent = assistance ? "Apply Pack assistance" : "Save payment";
    const option = form.elements.charge_id.selectedOptions[0];
    if (option?.dataset.remaining && (assistance || !form.elements.amount.value)) {
      form.elements.amount.value = (Number(option.dataset.remaining) / 100).toFixed(2);
    }
  }

  function openLedgerPayment() {
    if (!["admin", "treasurer"].includes(state.access?.role)) return;
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    if (!account?.active) return;
    const form = $("#ledger-payment-form"); form.reset(); form.dataset.accountId = account.id; delete form.dataset.settlementId;
    form.elements.occurred_on.value = today();
    form.elements.affects_pack_balance.checked = true;
    $("#ledger-payment-account").textContent = `Record money received from ${account.display_name}. Apply it to a specific family or Scout charge, or leave it as a general family payment.`;
    const scopeIds = new Set(ledgerScope(account).map(member => member.id));
    const charges = state.entries.filter(entry => scopeIds.has(entry.account_id) && entry.entry_type === "charge" && !entry.voided_at)
      .map(charge => ({ charge, remaining: chargeRemaining(charge) })).filter(item => item.remaining > 0);
    $("#ledger-payment-charge").innerHTML = '<option value="">General family payment</option>' + charges.map(({ charge, remaining }) =>
      `<option value="${esc(charge.id)}" data-remaining="${remaining}">${esc(accountName(charge.account_id))}: ${esc(charge.description)} — ${money(remaining)} remaining</option>`).join("");
    syncLedgerSettlementForm();
    status("", "", "#ledger-payment-status"); form.hidden = false;
  }

  async function saveLedgerPayment(form) {
    if (!["admin", "treasurer"].includes(state.access?.role)) throw new Error("Only admins and treasurers can record payments or assistance.");
    const account = state.accounts.find(a => a.id === form.dataset.accountId);
    if (!account?.active) throw new Error("Choose an active account.");
    const f = new FormData(form), amount = String(f.get("amount") || ""), amount_cents = cents(amount);
    const settlementType = String(f.get("settlement_type") || "payment");
    if (!["payment", "assistance"].includes(settlementType)) throw new Error("Choose whether this is a family payment or Pack assistance.");
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(amount_cents) || amount_cents <= 0 || amount_cents > 2147483647) throw new Error("Enter a positive amount with no more than two decimal places.");
    const occurred_on = String(f.get("occurred_on") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred_on) || !Number.isFinite(Date.parse(occurred_on)) || new Date(occurred_on).toISOString().slice(0, 10) !== occurred_on) throw new Error("Enter a valid date.");
    if (settlementType === "assistance" && !f.get("charge_id")) throw new Error("Choose the specific fee the Pack is covering.");
    if (settlementType === "assistance" && !String(f.get("notes") || "").trim()) throw new Error("Add a note explaining the financial assistance.");
    const method = String(f.get("payment_method") || "");
    if (settlementType === "payment" && !["cash", "zelle", "venmo", "check", "card", "bank_transfer", "other"].includes(method)) throw new Error("Choose a payment method.");
    let targetAccount = account;
    if (f.get("charge_id")) {
      const chargeResult = await client.from("ledger_entries").select("*").eq("id", f.get("charge_id")).maybeSingle();
      if (chargeResult.error) throw chargeResult.error;
      const charge = chargeResult.data;
      const scopeIds = new Set(ledgerScope(account).map(member => member.id));
      if (!charge || !scopeIds.has(charge.account_id) || charge.entry_type !== "charge" || charge.voided_at) throw new Error("The selected charge is no longer available. Reopen the form.");
      targetAccount = state.accounts.find(member => member.id === charge.account_id) || account;
    }
    form.dataset.settlementId ||= crypto.randomUUID();
    const result = await client.rpc("record_account_settlement", {
      p_entry_id: form.dataset.settlementId,
      p_account_id: targetAccount.id,
      p_entry_type: settlementType,
      p_amount_cents: amount_cents,
      p_occurred_on: occurred_on,
      p_charge_id: f.get("charge_id") || null,
      p_payment_method: settlementType === "payment" ? method : null,
      p_reference: String(f.get("reference") || "").trim() || null,
      p_notes: String(f.get("notes") || "").trim() || null,
      p_affects_pack_balance: settlementType === "payment" && f.has("affects_pack_balance")
    });
    if (result.error) throw result.error;
    form.hidden = true; form.reset(); delete form.dataset.settlementId;
    await loadAll();
    if (state.activeLedgerId === account.id) renderAccountLedger(account.id);
    window.dispatchEvent(new Event("treasury-ledger-updated"));
    status(`${settlementType === "assistance" ? "Pack assistance" : "Payment"} of ${money(amount_cents)} recorded for ${account.display_name}.`, "success");
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportAccountLedger() {
    const account = state.accounts.find(a => a.id === state.activeLedgerId);
    if (!account) return;
    const rows = ledgerRows(account, $("#show-removed-ledger")?.checked);
    const data = [
      ["Date","Account","Type","Description","Category","Payment method","Reference","Amount","Running balance","Status","Notes"],
      ...rows.map(e => [e.occurred_on, accountName(e.account_id), human(e.entry_type), e.description, e.category || "", human(e.payment_method), e.reference || "", ((e.entry_type === "charge" ? 1 : -1) * Number(e.amount_cents) / 100).toFixed(2), (Number(e.running_balance_cents) / 100).toFixed(2), e.voided_at ? "Removed" : "Posted", e.notes || ""])
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
      return `<tr class="${e.voided_at ? "is-voided" : ""}"><td>${esc(e.occurred_on)}</td><td>${esc(accountName(e.account_id))}</td><td>${esc(human(e.entry_type))}</td><td><strong>${esc(e.description)}</strong>${e.category ? `<br><small>${esc(e.category)}</small>` : ""}${e.affects_pack_balance ? '<br><small class="balance-credit">Included in Pack balance</small>' : ""}${e.void_reason ? `<br><small>Removed: ${esc(e.void_reason)}</small>` : ""}</td><td>${esc(human(e.payment_method) || "—")}</td><td class="money ${entryMoneyClass(e)}">${signedMoney(e)}</td><td class="write-control"><div class="action-group">${action}</div></td></tr>`;
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
      const receipt = receipts.length ? receipts.map(r => {
        const driveStatus = r.drive_sync_status === "synced"
          ? `<small class="balance-credit">Saved to Google Drive${r.drive_filename ? ` as ${esc(r.drive_filename)}` : ""}</small>`
          : r.drive_sync_status === "syncing"
            ? '<small>Saving to Google Drive…</small>'
            : r.drive_sync_status === "error"
              ? `<small class="balance-due">Drive sync failed</small>${canWrite ? `<br><button class="text-button" type="button" data-sync-receipt="${r.id}">Retry Drive sync</button>` : ""}`
              : `<small>Waiting for Google Drive</small>${canWrite ? `<br><button class="text-button" type="button" data-sync-receipt="${r.id}">Sync now</button>` : ""}`;
        return `<button class="text-button" type="button" data-open-receipt="${r.storage_path}">${esc(r.original_filename)}</button><br>${driveStatus}`;
      }).join("<br>") : "Missing";
      const action = canWrite ? (e.voided_at
        ? `<button class="action-button" data-restore-expense="${e.id}" type="button">Restore</button>`
        : `<div class="action-group"><button class="action-button" data-edit-expense="${e.id}" type="button">Edit</button><button class="action-button" data-void-expense="${e.id}" type="button">Remove</button></div>`) : "";
      return `<tr class="${e.voided_at ? "is-voided" : ""}"><td>${esc(e.purchased_on)}</td><td><strong>${esc(e.vendor)}</strong>${e.category ? `<br><small>${esc(e.category)}</small>` : ""}</td><td>${esc(human(e.expense_type))}<br><span class="status-pill">${esc(human(e.status))}</span></td><td>${esc(e.expense_type === "reimbursement" ? e.reimburse_to : e.purchased_by || "Pack")}</td><td>${e.affects_pack_balance ? '<span class="status-pill">Deducted</span>' : "Not deducted"}</td><td>${receipt}</td><td class="money">${money(e.amount_cents)}</td><td class="write-control">${action}</td></tr>`;
    }).join("") : emptyRow(8, "No matching expenses.");
  }

  function renderAccess() {
    if (state.access?.role !== "admin") return;
    $("#access-table").innerHTML = state.users.length ? state.users.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.display_name || "—")}</td><td>${esc(human(u.role))}</td><td>${u.active ? "Active" : "Disabled"}</td><td>${u.active ? `<button type="button" class="btn-secondary" data-invite-user="${esc(u.email)}">Resend invitation</button>` : "—"}</td></tr>`).join("") : emptyRow(5, "No authorized users.");
  }

  function auditDetails(item) {
    const before = item.old_data || {}, after = item.new_data || {};
    const ignored = new Set(["updated_at", "created_at", "created_by", "voided_by"]);
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (item.action === "INSERT") return fields.slice(0, 4).map(key => `${human(key)}: ${after[key] ?? "—"}`).join("; ") || "Record created";
    if (item.action === "DELETE") return "Record deleted";
    return fields.slice(0, 5).map(key => `${human(key)}: ${before[key] ?? "—"} → ${after[key] ?? "—"}`).join("; ") || "Record updated";
  }

  function renderAudit() {
    if (state.access?.role !== "admin") return;
    const filter = $("#audit-table-filter"), selected = filter.value || "all";
    const tables = [...new Set(state.audit.map(item => item.table_name))].sort();
    filter.innerHTML = '<option value="all">All areas</option>' + tables.map(name => `<option value="${esc(name)}">${esc(human(name))}</option>`).join("");
    filter.value = tables.includes(selected) ? selected : "all";
    const query = $("#audit-search").value.trim().toLowerCase();
    const rows = state.audit.filter(item => {
      const hay = [item.changed_by_email, item.table_name, item.action, item.record_id, auditDetails(item)].join(" ").toLowerCase();
      return (filter.value === "all" || item.table_name === filter.value) && (!query || hay.includes(query));
    });
    $("#audit-count").textContent = `${rows.length} activit${rows.length === 1 ? "y" : "ies"}`;
    $("#audit-table").innerHTML = rows.length ? rows.map(item => `<tr><td>${esc(new Date(item.changed_at).toLocaleString())}</td><td>${esc(item.changed_by_email || "System")}</td><td>${esc(human(item.table_name))}</td><td><span class="status-pill">${esc(human(item.action))}</span></td><td><small>${esc(item.record_id || "—")}</small></td><td class="audit-details">${esc(auditDetails(item))}</td></tr>`).join("") : emptyRow(6, "No matching activity.");
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
      notes: String(f.get("notes") || "").trim() || null, batch_id: batch,
      affects_pack_balance: f.get("entry_type") === "payment" && f.has("affects_pack_balance")
    }));
    const { error } = await client.from("ledger_entries").insert(rows); if (error) throw error;
  }

  async function saveExpense(form) {
    const f = new FormData(form);
    const expenseId = String(f.get("expense_id") || "");
    const expenseType = String(f.get("expense_type") || "");
    const expenseStatus = String(f.get("status") || "");
    const row = {
      expense_type: expenseType, amount_cents: cents(f.get("amount")), purchased_on: f.get("purchased_on"),
      vendor: String(f.get("vendor")).trim(), category: String(f.get("category") || "").trim() || null,
      purchased_by: String(f.get("purchased_by") || "").trim() || null, reimburse_to: String(f.get("reimburse_to") || "").trim() || null,
      status: expenseStatus, description: String(f.get("description") || "").trim() || null, notes: String(f.get("notes") || "").trim() || null,
      affects_pack_balance: expenseType === "pack_card" || (expenseType === "reimbursement" && expenseStatus === "paid" && f.has("affects_pack_balance"))
    };
    const savedExpense = expenseId
      ? await client.from("expenses").update(row).eq("id", expenseId).is("voided_at", null).select().single()
      : await client.from("expenses").insert(row).select().single();
    const { data, error } = savedExpense; if (error) throw error;
    const file = f.get("receipt");
    if (file && file.size) {
      if (file.size > 10485760) throw new Error("Expense saved, but the receipt is larger than 10 MB.");
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${data.id}/${Date.now()}-${safe}`;
      const uploaded = await client.storage.from("pack-receipts").upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) throw new Error(`Expense saved, but receipt upload failed: ${uploaded.error.message}`);
      const saved = await client.from("expense_receipts").insert({ expense_id: data.id, storage_path: path, original_filename: file.name, content_type: file.type || null, size_bytes: file.size }).select().single();
      if (saved.error) throw saved.error;
      const drive = await attemptReceiptDriveSync({ receipt_id: saved.data.id });
      delete form.dataset.editing;
      return { message: drive.failed ? "Expense saved. The receipt remains safely stored in the portal and is waiting for Google Drive retry." : "Expense and receipt saved to Google Drive." };
    }
    const hasReceipts = state.receipts.some(receipt => receipt.expense_id === data.id);
    const drive = hasReceipts ? await attemptReceiptDriveSync({ expense_id: data.id }) : { failed: 0, synced: 0 };
    delete form.dataset.editing;
    return { message: drive.failed ? "Expense corrections saved. The receipt remains safely stored and needs a Google Drive retry." : hasReceipts ? "Expense saved and its Google Drive receipt was reorganized." : "Expense saved." };
  }

  async function requestReceiptDriveSync(payload) {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your session expired. Sign in again before synchronizing receipts.");
    const response = await fetch(RECEIPT_DRIVE_SYNC_API, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && !result.results) throw new Error(result.error || "Google Drive synchronization failed.");
    return result;
  }

  async function attemptReceiptDriveSync(payload) {
    try { return await requestReceiptDriveSync(payload); }
    catch (error) { return { synced: 0, failed: 1, error: error.message || "Google Drive synchronization failed." }; }
  }

  async function requestInvoiceDriveSync(payload) {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your session expired. Sign in again before archiving invoices.");
    const response = await fetch(INVOICE_DRIVE_SYNC_API, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && !result.results) throw new Error(result.error || "Invoice archiving failed.");
    return result;
  }

  async function syncPendingDriveReceipts() {
    const button = $("#sync-drive-receipts");
    button.disabled = true;
    status("Reviewing existing receipts and organizing Google Drive…", "", "#drive-sync-status");
    try {
      const [receiptResult, invoiceResult] = await Promise.all([
        requestReceiptDriveSync({ review_all: true }),
        requestInvoiceDriveSync({ sync_pending: true })
      ]);
      const failed = Number(receiptResult.failed || 0) + Number(invoiceResult.failed || 0);
      const message = `${receiptResult.synced} receipt${receiptResult.synced === 1 ? "" : "s"} reviewed and organized; ${invoiceResult.synced} invoice${invoiceResult.synced === 1 ? "" : "s"} archived.${failed ? " " + failed + " item" + (failed === 1 ? "" : "s") + " still need attention." : ""}`;
      status(message, failed ? "error" : "success", "#drive-sync-status");
      await loadAll();
    } catch (error) {
      status(error.message || "Unable to synchronize receipts.", "error", "#drive-sync-status");
    } finally {
      button.disabled = false;
    }
  }

  function syncExpenseBalanceControl() {
    const form = $("#expense-form"), type = form.elements.expense_type.value, paid = form.elements.status.value === "paid";
    const checkbox = form.elements.affects_pack_balance;
    if (type === "pack_card") { checkbox.checked = true; checkbox.disabled = true; }
    else { checkbox.disabled = !paid; checkbox.checked = paid; }
    $("#expense-balance-help").textContent = type === "pack_card"
      ? "Pack-card and Pack-bank purchases are automatically deducted from the projected balance."
      : paid ? "This paid reimbursement will be deducted from the projected balance." : "This reimbursement will not affect the projected balance until its status is Paid.";
  }

  function openNewExpense() {
    const form = $("#expense-form");
    form.reset(); form.elements.expense_id.value = ""; delete form.dataset.editing;
    $("#expense-form-heading").textContent = "Record Pack expense";
    $("#save-expense").textContent = "Save expense";
    setDefaults(); syncExpenseBalanceControl();
    form.hidden = false; form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function editExpense(id) {
    const expense = state.expenses.find(item => item.id === id && !item.voided_at);
    if (!expense) throw new Error("The expense could not be found.");
    const form = $("#expense-form");
    form.reset(); form.dataset.editing = "true";
    for (const key of ["expense_type", "purchased_on", "vendor", "category", "purchased_by", "reimburse_to", "status", "description", "notes"]) {
      if (form.elements[key]) form.elements[key].value = expense[key] || "";
    }
    form.elements.expense_id.value = expense.id;
    form.elements.amount.value = (Number(expense.amount_cents) / 100).toFixed(2);
    form.elements.affects_pack_balance.checked = Boolean(expense.affects_pack_balance);
    $("#expense-form-heading").textContent = "Edit Pack expense";
    $("#save-expense").textContent = "Save corrections";
    syncExpenseBalanceControl();
    form.hidden = false; form.scrollIntoView({ behavior: "smooth", block: "start" });
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
    try { const result = await action(form); form.reset(); setDefaults(); if (form.classList.contains("collapsible-form")) form.hidden = true; status(result?.message || success, "success"); await loadAll(); }
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
    [["#show-account-form","#account-form"],["#show-entry-form","#entry-form"],["#show-bank-form","#bank-form"]].forEach(([button, form]) => $(button).addEventListener("click", () => { $(form).hidden = false; $(form).scrollIntoView({ behavior: "smooth", block: "start" }); }));
    $("#show-expense-form").addEventListener("click", openNewExpense);
    $("#sync-drive-receipts").addEventListener("click", syncPendingDriveReceipts);
    $$("[data-close-form]").forEach(b => b.addEventListener("click", () => { $("#" + b.dataset.closeForm).hidden = true; }));
    $("#account-search").addEventListener("input", renderAccounts); $("#balance-filter").addEventListener("change", renderAccounts);
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
    $("#entry-form [name='entry_type']").addEventListener("change", e => {
      const hidden = e.target.value !== "payment";
      $("#entry-balance-impact-field").hidden = hidden;
      $("#entry-balance-impact-help").hidden = hidden;
    });
    $("#expense-search").addEventListener("input", renderExpenses); $("#expense-filter").addEventListener("change", renderExpenses);
    $("#expense-form [name='expense_type']").addEventListener("change", syncExpenseBalanceControl);
    $("#expense-form [name='status']").addEventListener("change", syncExpenseBalanceControl);
    $("#audit-search").addEventListener("input", renderAudit); $("#audit-table-filter").addEventListener("change", renderAudit);
    $("#refresh-audit").addEventListener("click", loadAll);
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
    $("#add-ledger-contact").addEventListener("click", () => { try { openLedgerContactForm(); } catch (error) { status(error.message, "error"); } });
    $("#ledger-contact-list").addEventListener("click", async event => {
      const edit = event.target.closest("[data-edit-family-contact]");
      if (edit) { try { openLedgerContactForm(edit.dataset.editFamilyContact); } catch (error) { status(error.message, "error"); } return; }
      const remove = event.target.closest("[data-remove-family-contact]");
      if (!remove || !confirm("Remove this parent or guardian from the active family contacts? Existing email history will be kept.")) return;
      remove.disabled = true;
      try { await removeLedgerContact(remove.dataset.removeFamilyContact); status("Family contact removed.", "success"); }
      catch (error) { status(error.message || "Unable to remove the contact.", "error"); }
      finally { remove.disabled = false; }
    });
    $("#cancel-ledger-contact").addEventListener("click", () => { $("#ledger-contact-form").hidden = true; });
    $("#ledger-contact-form").addEventListener("submit", async e => {
      e.preventDefault(); const button = e.currentTarget.querySelector("button[type=submit]"); button.disabled = true;
      status("Saving contact…", "", "#ledger-contact-status");
      try { await saveLedgerContact(e.currentTarget); status("Contact updated.", "success"); }
      catch (error) { status(error.message || "Unable to save the contact.", "error", "#ledger-contact-status"); }
      finally { button.disabled = false; }
    });
    $("#email-account-balance").addEventListener("click", () => { try { composeLedgerBalanceEmail(); } catch (error) { status(error.message, "error"); } });
    $("#close-ledger-email").addEventListener("click", () => { $("#ledger-email-form").hidden = true; });
    $("#ledger-email-recipients").addEventListener("change", updateLedgerEmailCounts);
    $("#ledger-email-items").addEventListener("change", updateLedgerEmailCounts);
    $("#select-outstanding-ledger-items").addEventListener("click", () => setLedgerItemSelection("outstanding"));
    $("#select-all-ledger-items").addEventListener("click", () => setLedgerItemSelection("all"));
    $("#clear-ledger-items").addEventListener("click", () => setLedgerItemSelection("none"));
    $("#ledger-email-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget, button = $("#send-ledger-email");
      if (button.disabled || !confirm("Send these balance details to the selected family contact(s)?")) return;
      button.disabled = true;
      status("Sending family balance email…", "", "#ledger-email-status");
      try {
        const result = await sendLedgerBalanceEmail(form);
        status(`Sent to ${result.sent} contact${result.sent === 1 ? "" : "s"}.${result.drive_archive?.synced ? " Invoice saved to Google Drive." : ""}${result.drive_archive?.failed ? " Invoice sent, but the Drive archive needs attention." : ""}${result.failed ? " " + result.failed + " failed." : ""}`, result.failed || result.drive_archive?.failed ? "error" : "success", "#ledger-email-status");
      } catch (error) { status(error.message || "Unable to send the family email.", "error", "#ledger-email-status"); }
      finally { button.disabled = false; updateLedgerEmailCounts(); }
    });
    $("#show-removed-ledger").addEventListener("change", () => { if (state.activeLedgerId) renderAccountLedger(state.activeLedgerId); });
    $("#ledger-account-filter").addEventListener("change", () => { if (state.activeLedgerId) renderAccountLedger(state.activeLedgerId); });
    $("#ledger-members").addEventListener("click", e => {
      const button = e.target.closest("[data-ledger-member]"); if (!button || !state.activeLedgerId) return;
      $("#ledger-account-filter").value = button.dataset.ledgerMember;
      renderAccountLedger(state.activeLedgerId);
    });
    $("#export-ledger-csv").addEventListener("click", exportAccountLedger);
    $("#show-ledger-payment").addEventListener("click", openLedgerPayment);
    $("#ledger-settlement-type").addEventListener("change", syncLedgerSettlementForm);
    $("#ledger-payment-charge").addEventListener("change", syncLedgerSettlementForm);
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
        if (b.dataset.editExpense) { editExpense(b.dataset.editExpense); return; }
        if (b.dataset.voidExpense) await voidRecord("expenses", b.dataset.voidExpense);
        if (b.dataset.restoreExpense) await voidRecord("expenses", b.dataset.restoreExpense, true);
        if (b.dataset.openReceipt) { const { data, error } = await client.storage.from("pack-receipts").createSignedUrl(b.dataset.openReceipt, 60); if (error) throw error; window.open(data.signedUrl, "_blank", "noopener"); }
        if (b.dataset.syncReceipt) {
          status("Synchronizing receipt with Google Drive…", "", "#drive-sync-status");
          const result = await requestReceiptDriveSync({ receipt_id: b.dataset.syncReceipt });
          status(result.failed ? "The receipt is still waiting for Google Drive. Check the connection and try again." : "Receipt organized in Google Drive.", result.failed ? "error" : "success", "#drive-sync-status");
          await loadAll();
        }
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
