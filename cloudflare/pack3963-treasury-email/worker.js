const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
const ALLOWED_ORIGINS = ["https://pack3963.com", "https://www.pack3963.com", "https://pack3963.pages.dev"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, service: "pack3963-treasury-email" });
    const supported = ["/api/treasurer/send-email", "/api/treasurer/create-invoice"];
    if (!supported.includes(url.pathname)) return Response.json({ error: "not_found" }, { status: 404 });
    if (request.method === "OPTIONS") return corsResponse(request, null, 204);
    if (request.method !== "POST") return corsResponse(request, { error: "method_not_allowed" }, 405);
    if (Number(request.headers.get("content-length") || 0) > 65536) return corsResponse(request, { error: "request_too_large" }, 413);
    return url.pathname.endsWith("create-invoice") ? handleCreateInvoice(request, env) : handleTreasurerEmail(request, env);
  }
};

function allowedOrigin(request) {
  const origin = request.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.pack3963\.pages\.dev$/i.test(origin) ? origin : "";
}

function corsResponse(request, body, status = 200) {
  const origin = allowedOrigin(request);
  if (!origin) return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  const headers = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
  return body == null ? new Response(null, { status, headers }) : Response.json(body, { status, headers });
}

async function sbFetch(env, token, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);
  headers.set("authorization", "Bearer " + token);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, { ...init, headers, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error("Database returned an invalid response"); }
  if (!response.ok) throw new Error(data?.message || "Database request failed");
  return data;
}

async function authorize(request, env) {
  if (!allowedOrigin(request)) throw new HttpError("origin_not_allowed", 403);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError("missing_session", 401);
  const response = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: "Bearer " + token },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new HttpError("invalid_session", 401);
  const user = await response.json();
  const access = await sbFetch(env, token, "authorized_users?select=email,role,active&email=eq." + encodeURIComponent(String(user.email || "").toLowerCase()) + "&active=eq.true");
  if (!access.length || !["admin", "treasurer"].includes(access[0].role)) throw new HttpError("not_authorized", 403);
  return { token, user };
}

async function invoiceContext(env, token, householdId, entryIds, mode) {
  const households = await sbFetch(env, token, "financial_accounts?select=id,display_name&id=eq." + householdId + "&account_type=eq.household&active=eq.true");
  if (!households.length) throw new HttpError("family_not_found", 404);
  const contacts = await sbFetch(env, token, "household_contacts?select=id,full_name,email,relationship,is_primary&household_account_id=eq." + householdId + "&active=eq.true&order=is_primary.desc");
  const accounts = await sbFetch(env, token, "account_balances?select=id,display_name,account_type,den,parent_account_id,balance_cents&or=(id.eq." + householdId + ",parent_account_id.eq." + householdId + ")");
  const accountIds = accounts.map(account => account.id).filter(validUuid);
  const accountNames = Object.fromEntries(accounts.map(account => [account.id, account.display_name]));
  const balanceCents = Math.max(0, accounts.reduce((sum, account) => sum + Number(account.balance_cents || 0), 0));
  let activity = [];
  if (accountIds.length) {
    const filter = mode === "ledger"
      ? "id=in.(" + entryIds.join(",") + ")&account_id=in.(" + accountIds.join(",") + ")"
      : "voided_at=is.null&account_id=in.(" + accountIds.join(",") + ")&limit=50";
    activity = (await sbFetch(env, token, "ledger_entries?select=id,account_id,entry_type,amount_cents,occurred_on,due_on,description,category&" + filter + "&order=occurred_on.desc"))
      .map(entry => ({ ...entry, account_name: accountNames[entry.account_id] || "Pack account" }));
  }
  if (mode === "ledger" && activity.length !== entryIds.length) throw new HttpError("selected_ledger_items_changed", 409);
  return {
    household: households[0], contacts, activity, balanceCents,
    billTo: contacts.map(contact => contact.full_name).filter(Boolean).join(", ") || households[0].display_name,
    scouts: accounts.filter(account => account.account_type === "scout").map(account => ({ name: account.display_name, den: account.den || "" }))
  };
}

async function createInvoiceRecord(env, token, values) {
  const invoiceDate = chicagoDate();
  const seed = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const dueDate = invoiceDueDate(values.requestedDueDate, values.activity, invoiceDate);
  const invoiceNumber = "P3963-" + invoiceDate.replaceAll("-", "") + "-" + seed;
  const created = await sbFetch(env, token, "invoice_documents", {
    method: "POST", headers: { prefer: "return=representation" },
    body: JSON.stringify({
      message_id: values.messageId || null, household_account_id: values.household.id,
      invoice_number: invoiceNumber, invoice_date: invoiceDate, due_date: dueDate,
      family_name: values.household.display_name, bill_to: values.billTo, scout_names: values.scouts,
      subject: values.subject, body_text: values.body, balance_cents: values.balanceCents,
      line_items: values.activity, support_email: env.SUPPORT_EMAIL,
      payment_instructions: env.ZELLE_PAYMENT_INFO, drive_sync_status: "pending"
    })
  });
  if (!created[0]?.id || !created[0]?.public_token) throw new Error("Invoice record was not created");
  return { ...created[0], invoice_url: values.invoiceBaseUrl ? values.invoiceBaseUrl + "?token=" + encodeURIComponent(created[0].public_token) : null };
}

async function handleCreateInvoice(request, env) {
  try {
    const { token } = await authorize(request, env);
    const payload = await request.json();
    const invoiceBaseUrl = await invoiceBaseUrlFor(request);
    if (!invoiceBaseUrl) throw new HttpError("invoice_page_not_available", 503);
    const householdId = validUuid(payload.household_id) ? payload.household_id : "";
    const entryIds = uniqueUuids(payload.ledger_entry_ids, 100);
    const subject = String(payload.subject || "Pack 3963 family invoice").trim().slice(0, 180);
    const body = String(payload.body_text || "Please review the account details below.").trim().slice(0, 8000);
    if (!householdId || !entryIds.length || !subject || !body) throw new HttpError("missing_required_fields", 400);
    const context = await invoiceContext(env, token, householdId, entryIds, "ledger");
    const invoice = await createInvoiceRecord(env, token, { ...context, subject, body, requestedDueDate: payload.due_date, invoiceBaseUrl });
    return corsResponse(request, { ok: true, invoice_id: invoice.id, invoice_number: invoice.invoice_number, due_date: invoice.due_date, invoice_url: invoice.invoice_url });
  } catch (error) {
    console.error(JSON.stringify({ event: "invoice_create_failed", reason: String(error.message || error) }));
    return corsResponse(request, { error: String(error.message || "Unable to create invoice") }, error.status || 500);
  }
}

async function handleTreasurerEmail(request, env) {
  try {
    const { token, user } = await authorize(request, env);
    const payload = await request.json();
    const invoiceBaseUrl = await invoiceBaseUrlFor(request);
    const householdIds = uniqueUuids(payload.household_ids, 100);
    const contactIds = uniqueUuids(payload.contact_ids, 20);
    const entryIds = uniqueUuids(payload.ledger_entry_ids, 100);
    const mode = payload.delivery_mode === "ledger" ? "ledger" : "bulk";
    const type = payload.message_type === "custom" ? "custom" : "invoice";
    const subject = String(payload.subject || "").trim().slice(0, 180);
    const body = String(payload.body_text || "").trim().slice(0, 8000);
    if (!householdIds.length || !subject || !body) throw new HttpError("missing_required_fields", 400);
    if (mode === "ledger" && (householdIds.length !== 1 || !contactIds.length || !entryIds.length || type !== "invoice")) throw new HttpError("select_recipients_and_ledger_items", 400);
    const messages = await sbFetch(env, token, "email_messages", {
      method: "POST", headers: { prefer: "return=representation" },
      body: JSON.stringify({ message_type: type, subject, body_text: body, status: "sending", sent_by_email: user.email, recipient_count: 0 })
    });
    const message = messages[0];
    let sent = 0, failed = 0, skipped = 0;
    const invoiceIds = [], invoiceUrls = [];
    for (const householdId of householdIds) {
      let context;
      try { context = await invoiceContext(env, token, householdId, entryIds, mode); } catch { skipped++; continue; }
      const recipients = context.contacts.filter(contact => validEmail(contact.email) && (mode !== "ledger" || contactIds.includes(contact.id)));
      if (!recipients.length) { skipped += mode === "ledger" ? contactIds.length : 1; continue; }
      let invoice = null;
      if (type === "invoice") {
        invoice = await createInvoiceRecord(env, token, { ...context, messageId: message.id, subject, body, requestedDueDate: payload.due_date, invoiceBaseUrl });
        invoiceIds.push(invoice.id); invoiceUrls.push(invoice.invoice_url);
      }
      for (const contact of recipients) {
        let providerId = null, recipientStatus = "failed", errorMessage = null;
        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json", "idempotency-key": message.id + ":" + householdId + ":" + contact.id },
            body: JSON.stringify({
              from: env.FROM_EMAIL, to: [contact.email], subject,
              html: treasurerHtml(contact.full_name, context.household.display_name, subject, body, type === "invoice" ? context.balanceCents : null, context.activity, env.SUPPORT_EMAIL, type === "invoice" ? env.ZELLE_PAYMENT_INFO : null, mode, invoice),
              text: treasurerText(contact.full_name, context.household.display_name, body, type === "invoice" ? context.balanceCents : null, context.activity, env.SUPPORT_EMAIL, type === "invoice" ? env.ZELLE_PAYMENT_INFO : null, mode, invoice),
              reply_to: env.SUPPORT_EMAIL
            })
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result?.message || "Email provider rejected the message");
          providerId = result.id || null; recipientStatus = "sent"; sent++;
        } catch (error) { errorMessage = String(error.message || error).slice(0, 500); failed++; }
        await sbFetch(env, token, "email_recipients", {
          method: "POST", headers: { prefer: "return=minimal" },
          body: JSON.stringify({ message_id: message.id, household_account_id: householdId, recipient_name: contact.full_name, recipient_email: contact.email, provider_message_id: providerId, status: recipientStatus, error_message: errorMessage, sent_at: recipientStatus === "sent" ? new Date().toISOString() : null })
        });
      }
    }
    const finalStatus = sent && !failed && !skipped ? "sent" : sent ? "partial" : "failed";
    await sbFetch(env, token, "email_messages?id=eq." + message.id, {
      method: "PATCH", headers: { prefer: "return=minimal" },
      body: JSON.stringify({ status: finalStatus, recipient_count: sent, sent_at: new Date().toISOString() })
    });
    return corsResponse(request, { ok: sent > 0, message_id: message.id, invoice_ids: invoiceIds, invoice_urls: invoiceUrls, sent, failed, skipped, status: finalStatus }, sent > 0 ? 200 : 400);
  } catch (error) {
    console.error(JSON.stringify({ event: "treasurer_email_failed", reason: String(error.message || error) }));
    return corsResponse(request, { error: String(error.message || "Unable to send email") }, error.status || 500);
  }
}

export function invoiceDueDate(requested, activity, invoiceDate) {
  if (validDate(requested)) return requested;
  const dueDates = activity.filter(entry => entry.entry_type === "charge" && validDate(entry.due_on)).map(entry => entry.due_on).sort();
  if (dueDates.length) return dueDates[dueDates.length - 1];
  const value = new Date(invoiceDate + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + 14);
  return value.toISOString().slice(0, 10);
}

async function invoiceBaseUrlFor(request) {
  const origin = allowedOrigin(request);
  if (!origin) return null;
  const url = origin.replace(/\/$/, "") + "/invoice/";
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return response.ok ? url : null;
  } catch {
    return null;
  }
}

function chicagoDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}
function fmtMoney(value) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(value) || 0) / 100); }
function activityAmount(entry) { return (entry.entry_type === "charge" ? 1 : -1) * Number(entry.amount_cents || 0); }
function invoiceButton(invoice) { return invoice?.invoice_url ? "<div style='text-align:center;margin:24px 0'><a href='" + esc(invoice.invoice_url) + "' style='display:inline-block;padding:13px 22px;border-radius:7px;background:#004b8d;color:#fff;font-size:15px;font-weight:800;text-decoration:none'>View official invoice</a><div style='margin-top:8px;color:#607284;font-size:12px'>Invoice " + esc(invoice.invoice_number) + " · Due " + esc(invoice.due_date) + "</div></div>" : ""; }
function invoiceText(invoice) { return invoice?.invoice_url ? "\n\nOFFICIAL INVOICE\n" + invoice.invoice_number + " · Due " + invoice.due_date + "\n" + invoice.invoice_url : ""; }
function treasurerActivityHtml(activity, mode) {
  if (!activity?.length) return "";
  const rows = activity.map(entry => "<tr><td style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px'>" + esc(entry.occurred_on) + "</td><td style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px'><strong>" + esc(entry.description) + "</strong><br><span style='color:#607284'>" + esc(entry.account_name) + (entry.category ? " · " + esc(entry.category) : "") + "</span></td><td align='right' style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px;font-weight:700;color:" + (activityAmount(entry) > 0 ? "#a1122f" : "#24633f") + "'>" + (activityAmount(entry) > 0 ? "+" : "−") + fmtMoney(Math.abs(activityAmount(entry))) + "</td></tr>").join("");
  return "<h2 style='color:#004b8d;font-size:19px;margin:24px 0 10px'>" + (mode === "ledger" ? "Selected account details" : "Recent account activity") + "</h2><table role='presentation' width='100%' cellspacing='0' cellpadding='0' border='0'><tr><th align='left' style='padding:8px;background:#eef3f8;font-size:12px'>DATE</th><th align='left' style='padding:8px;background:#eef3f8;font-size:12px'>DETAIL</th><th align='right' style='padding:8px;background:#eef3f8;font-size:12px'>AMOUNT</th></tr>" + rows + "</table>";
}
function treasurerActivityText(activity, mode) { return activity?.length ? "\n\n" + (mode === "ledger" ? "SELECTED ACCOUNT DETAILS" : "RECENT ACCOUNT ACTIVITY") + "\n" + activity.map(entry => entry.occurred_on + " | " + entry.account_name + " | " + entry.description + " | " + (activityAmount(entry) > 0 ? "+" : "-") + fmtMoney(Math.abs(activityAmount(entry)))).join("\n") : ""; }
function paymentHtml(zelle) { return zelle ? "<div style='margin:22px 0;padding:18px;background:#fff8d9;border-left:5px solid #f7c600;border-radius:7px'><div style='font-size:13px;font-weight:800;color:#004b8d;letter-spacing:.4px'>PAYMENT OPTIONS</div><p style='font-size:15px;line-height:1.55;margin:8px 0 0'>Pay with cash at a Pack meeting or send Zelle to <strong>" + esc(zelle) + "</strong> (Kevin Goldsmith, Pack Treasurer). Include your family name and invoice number in the memo.</p></div>" : ""; }
function paymentText(zelle) { return zelle ? "\n\nPAYMENT OPTIONS\nPay with cash at a Pack meeting or send Zelle to " + zelle + " (Kevin Goldsmith, Pack Treasurer). Include your family name and invoice number in the memo." : ""; }
function emailLogo() { return "<img src='https://www.pack3963.com/assets/images/cubscoutlogo.png' width='170' alt='Cub Scout Pack 3963' style='display:block;width:170px;max-width:100%;height:auto;border:0;margin:0 auto 10px'>"; }
function treasurerHtml(contact, family, subject, body, due, activity, support, zelle, mode, invoice) {
  const paragraphs = String(body).split(/\n{2,}/).map(paragraph => "<p style='font-size:16px;line-height:1.6;margin:0 0 16px'>" + esc(paragraph).replace(/\n/g, "<br>") + "</p>").join("");
  const balance = due == null ? "" : "<div style='margin:20px 0;padding:18px;background:#f4f8fc;border-left:5px solid #d71920;border-radius:7px'><div style='font-size:13px;font-weight:800;color:#526474'>CURRENT FAMILY BALANCE DUE</div><div style='font-size:30px;font-weight:800;color:#004b8d;margin-top:4px'>" + fmtMoney(due) + "</div><div style='font-size:13px;color:#607284;margin-top:4px'>" + esc(family) + "</div></div>";
  return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>" + esc(subject) + "</title></head><body style='margin:0;background:#eef3f8;color:#243447;font-family:Arial,Helvetica,sans-serif'><div style='display:none;max-height:0;overflow:hidden'>Pack 3963 family account details for " + esc(family) + "</div><table width='100%' cellspacing='0' cellpadding='0' role='presentation' style='background:#eef3f8;padding:24px 12px'><tr><td align='center'><table width='100%' cellspacing='0' cellpadding='0' role='presentation' style='max-width:620px;background:#fff;border-radius:15px;overflow:hidden'><tr><td align='center' style='background:#004b8d;padding:22px 30px;border-bottom:8px solid #f7c600;color:#fff'>" + emailLogo() + "<div style='font-size:15px;font-weight:700'>Pack Treasurer</div></td></tr><tr><td style='padding:30px'><div style='color:#d71920;font-size:12px;font-weight:800;letter-spacing:1px'>FAMILY ACCOUNT</div><h1 style='color:#004b8d;font-size:25px;margin:8px 0 18px'>" + esc(subject) + "</h1><p style='font-size:16px;line-height:1.6'>Hello " + esc(contact) + ",</p>" + paragraphs + balance + invoiceButton(invoice) + treasurerActivityHtml(activity, mode) + paymentHtml(zelle) + "<p style='font-size:13px;color:#607284;margin-top:24px'>Questions? Reply or contact <a href='mailto:" + esc(support) + "'>" + esc(support) + "</a>.</p></td></tr><tr><td style='background:#003f75;color:#d9ecff;padding:17px 30px;font-size:12px'>Cub Scout Pack 3963 · c/o Eden United Church of Christ · Chicago, Illinois</td></tr></table></td></tr></table></body></html>";
}
function treasurerText(contact, family, body, due, activity, support, zelle, mode, invoice) { return "CUB SCOUT PACK 3963\nPathway to Adventure Council · Scouting America\nc/o Eden United Church of Christ\n\nHello " + contact + ",\n\n" + body + (due == null ? "" : "\n\nCurrent family balance due for " + family + ": " + fmtMoney(due)) + invoiceText(invoice) + treasurerActivityText(activity, mode) + paymentText(zelle) + "\n\nQuestions? Contact " + support; }
function uniqueUuids(values, limit) { return [...new Set(Array.isArray(values) ? values : [])].filter(validUuid).slice(0, limit); }
function validUuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function validDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T12:00:00Z")); }
function validEmail(value) { return typeof value === "string" && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function esc(value) { return String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char])); }
class HttpError extends Error { constructor(message, status) { super(message); this.status = status; } }
