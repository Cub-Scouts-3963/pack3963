(() => {
  "use strict";

  const SUPABASE_URL = "https://buvrqioskjjhszqkpypa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
  const AUTH_STORAGE_KEY = "pack3963-family-account-session";
  const LEGACY_AUTH_STORAGE_KEY = "sb-buvrqioskjjhszqkpypa-auth-token";
  try { window.localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY); } catch (_) { /* Storage may be unavailable. */ }
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      storage: window.sessionStorage,
      storageKey: AUTH_STORAGE_KEY,
      detectSessionInUrl: true,
      autoRefreshToken: true
    }
  });
  const state = { portal: null, householdIndex: 0, session: null };
  const $ = selector => document.querySelector(selector);

  const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
  const money = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
  const date = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const human = value => ({ charge: "Charge", payment: "Payment", credit: "Credit", assistance: "Pack assistance" })[value] || value;
  const signedAmount = entry => entry.entry_type === "charge" ? Number(entry.amount_cents) : -Number(entry.amount_cents);

  function setStatus(message = "", kind = "") {
    const node = $("#family-login-status");
    node.textContent = message;
    node.className = `family-status${kind ? ` is-${kind}` : ""}`;
  }

  function show(panel) {
    $("#family-auth-panel").hidden = panel !== "auth";
    $("#family-loading").hidden = panel !== "loading";
    $("#family-empty").hidden = panel !== "empty";
    $("#family-account-app").hidden = panel !== "app";
  }

  function currentHousehold() {
    return state.portal?.households?.[state.householdIndex] || null;
  }

  function ledgerTotals(ledger) {
    return ledger.reduce((totals, entry) => {
      if (entry.entry_type === "charge") totals.charges += Number(entry.amount_cents) || 0;
      else totals.payments += Number(entry.amount_cents) || 0;
      totals.balance += signedAmount(entry);
      return totals;
    }, { charges: 0, payments: 0, balance: 0 });
  }

  function renderScouts(household) {
    const scouts = household.scouts || [];
    $("#family-scout-count").textContent = `${scouts.length} Scout${scouts.length === 1 ? "" : "s"}`;
    $("#family-scouts").innerHTML = scouts.length ? scouts.map(scout => `
      <article class="family-scout-card">
        <strong>${esc(scout.name)}</strong>
        <span>${esc(scout.den || "Den not listed")}</span>
        ${scout.member_id_last4 ? `<small>Scouting member ID ending in ${esc(scout.member_id_last4)}</small>` : ""}
      </article>`).join("") : '<p>No active Scouts are currently linked to this family account.</p>';

    const options = [
      '<option value="all">Entire family</option>',
      '<option value="family">Family-level activity</option>',
      ...scouts.map(scout => `<option value="${esc(scout.id)}">${esc(scout.name)}</option>`)
    ];
    $("#family-activity-filter").innerHTML = options.join("");
  }

  function renderLedger(household) {
    const filter = $("#family-activity-filter").value;
    const rows = [...(household.ledger || [])]
      .filter(entry => filter === "all" || (filter === "family" ? entry.account_name === "Family-level" : entry.account_id === filter))
      .sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)));

    $("#family-ledger").innerHTML = rows.length ? rows.map(entry => {
      const signed = signedAmount(entry);
      const due = entry.entry_type === "charge" && entry.due_on ? `<small>Due ${esc(date(entry.due_on))}</small>` : "";
      return `<tr>
        <td>${esc(date(entry.occurred_on))}</td>
        <td>${esc(entry.account_name)}</td>
        <td><strong>${esc(entry.description)}</strong>${entry.category ? `<small>${esc(entry.category)}</small>` : ""}${due}</td>
        <td>${esc(human(entry.entry_type))}</td>
        <td class="family-money ${signed > 0 ? "family-charge" : "family-credit"}">${signed > 0 ? "+" : "−"}${esc(money(Math.abs(signed)))}</td>
      </tr>`;
    }).join("") : '<tr><td class="family-empty-row" colspan="5">No account activity matches this selection.</td></tr>';
  }

  function renderInvoices(household) {
    const invoices = household.invoices || [];
    $("#family-invoice-count").textContent = `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`;
    $("#family-invoices").innerHTML = invoices.length ? invoices.map(invoice => `
      <article class="family-invoice-card">
        <div><strong>${esc(invoice.invoice_number)}</strong><span>${esc(invoice.subject || "Pack 3963 family invoice")}</span><small>Issued ${esc(date(invoice.invoice_date))} · Due ${esc(date(invoice.due_date))}</small></div>
        <span class="family-invoice-amount">${esc(money(invoice.balance_cents))}</span>
        <a class="btn-secondary" href="/invoice/?token=${encodeURIComponent(invoice.public_token)}" target="_blank" rel="noopener">View invoice</a>
      </article>`).join("") : '<p>No official invoices have been created for this family yet.</p>';
  }

  function renderHousehold() {
    const household = currentHousehold();
    if (!household) return;
    const contact = household.matched_contact || {};
    const totals = ledgerTotals(household.ledger || []);

    $("#family-welcome").textContent = household.name;
    $("#family-signed-in").textContent = `Signed in as ${contact.email || state.portal.email}`;
    $("#family-balance").textContent = money(Math.abs(totals.balance));
    $("#family-balance-status").textContent = totals.balance > 0 ? "Amount due" : totals.balance < 0 ? "Account credit" : "Paid / even";
    $("#family-total-charges").textContent = money(totals.charges);
    $("#family-total-payments").textContent = money(totals.payments);
    $("#family-balance").style.color = totals.balance < 0 ? "#b9f7cf" : "#fff";

    renderScouts(household);
    renderLedger(household);
    renderInvoices(household);
  }

  function renderPortal() {
    const households = state.portal?.households || [];
    if (!households.length) {
      show("empty");
      return;
    }

    state.householdIndex = Math.min(state.householdIndex, households.length - 1);
    const switcher = $("#family-switcher");
    switcher.innerHTML = households.map((household, index) => `<option value="${index}">${esc(household.name)}</option>`).join("");
    switcher.value = String(state.householdIndex);
    $("#family-switcher-wrap").hidden = households.length < 2;
    renderHousehold();
    show("app");
  }

  async function loadPortal() {
    show("loading");
    const { data, error } = await client.rpc("get_family_account_portal");
    if (error) throw error;
    state.portal = data;
    renderPortal();
  }

  async function signOut() {
    await client.auth.signOut({ scope: "local" });
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
    state.portal = null;
    state.session = null;
    history.replaceState({}, document.title, location.pathname);
    setStatus("");
    show("auth");
  }

  $("#family-login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim().toLowerCase();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus("Sending your secure link…");
    const redirectTo = `${location.origin}/family-account.html`;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true }
    });
    button.disabled = false;
    if (error) {
      setStatus(error.message.includes("rate limit") ? "Please wait a minute before requesting another sign-in email." : error.message, "error");
      return;
    }
    setStatus("Check your email for a one-time Pack 3963 sign-in link.", "success");
  });

  $("#family-switcher").addEventListener("change", event => {
    state.householdIndex = Number(event.target.value) || 0;
    renderHousehold();
  });
  $("#family-activity-filter").addEventListener("change", () => renderLedger(currentHousehold()));
  $("#family-refresh").addEventListener("click", () => loadPortal().catch(handleError));
  $("#family-sign-out").addEventListener("click", signOut);
  $("#family-empty-sign-out").addEventListener("click", signOut);

  function handleError(error) {
    console.error(error);
    show("auth");
    setStatus("We could not open the family account. Please try again or contact Pack 3963 for help.", "error");
  }

  client.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === "SIGNED_OUT") show("auth");
  });

  window.addEventListener("pagehide", () => {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  });

  client.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    state.session = data.session;
    if (state.session) return loadPortal();
    show("auth");
  }).catch(handleError);
})();
