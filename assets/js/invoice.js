(() => {
  "use strict";

  const SUPABASE_URL = "https://buvrqioskjjhszqkpypa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
  const $ = selector => document.querySelector(selector);
  const money = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
  const date = value => value ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z")) : "—";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));

  function render(invoice) {
    const items = Array.isArray(invoice.line_items) ? invoice.line_items : [];
    const scouts = Array.isArray(invoice.scout_names) ? invoice.scout_names : [];
    const charges = items.filter(item => item.entry_type === "charge").reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
    const credits = items.filter(item => item.entry_type !== "charge").reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
    document.title = `Invoice ${invoice.invoice_number} — Pack 3963`;
    $("#invoice-number").textContent = invoice.invoice_number;
    $("#invoice-issued").textContent = date(invoice.invoice_date);
    $("#invoice-due").textContent = date(invoice.due_date);
    $("#invoice-bill-to").textContent = invoice.bill_to || invoice.family_name;
    $("#invoice-family").textContent = invoice.family_name;
    $("#invoice-scouts").textContent = scouts.length ? "Scout" + (scouts.length === 1 ? ": " : "s: ") + scouts.map(scout => `${scout.name}${scout.den ? " — " + scout.den : ""}`).join(", ") : "";
    $("#invoice-message").textContent = invoice.body_text || "Please review the account details below.";
    $("#invoice-items").innerHTML = items.length ? items.map(item => {
      const signed = (item.entry_type === "charge" ? 1 : -1) * Number(item.amount_cents || 0);
      return `<tr><td>${esc(date(item.occurred_on))}</td><td><strong>${esc(item.description)}</strong>${item.category ? `<small>${esc(item.category)}</small>` : ""}</td><td>${esc(item.account_name || invoice.family_name)}</td><td class="amount">${signed < 0 ? "−" : ""}${esc(money(Math.abs(signed)))}</td></tr>`;
    }).join("") : '<tr><td colspan="4">No ledger items were included.</td></tr>';
    $("#invoice-charges").textContent = money(charges);
    $("#invoice-credits").textContent = credits ? "−" + money(credits) : money(0);
    $("#invoice-balance").textContent = money(invoice.balance_cents);
    $("#invoice-payment").textContent = invoice.payment_instructions || "the Pack Treasurer";
    $("#invoice-payment-number").textContent = invoice.invoice_number;
    const support = invoice.support_email || "cubscouts3963@gmail.com";
    $("#invoice-support").textContent = support;
    $("#invoice-support").href = "mailto:" + support;
    $("#invoice-loading").hidden = true;
    $("#invoice").hidden = false;
    $("#invoice-tools").hidden = false;
  }

  async function load() {
    const token = new URLSearchParams(location.search).get("token") || "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) throw new Error("Invalid invoice token");
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_invoice_by_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ p_token: token }),
      referrerPolicy: "no-referrer"
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data) || !data.length) throw new Error("Invoice not found");
    render(data[0]);
    if (new URLSearchParams(location.search).get("print") === "1") setTimeout(() => window.print(), 250);
  }

  $("#invoice-print").addEventListener("click", () => window.print());
  if (!document.referrer.includes(location.host)) $("#invoice-back").hidden = true;
  load().catch(() => {
    $("#invoice-loading").hidden = true;
    $("#invoice-error").hidden = false;
  });
})();
