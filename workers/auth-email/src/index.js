
const ACTIONS = {
  signup: ["Your one-time Pack 3963 sign-in link", "TREASURER PORTAL", "Here is your one-time sign-in link", "Use the secure button below to sign in to the Cub Scout Pack 3963 Treasurer Portal.", "Sign in to the Treasurer Portal"],
  magiclink: ["Your one-time Pack 3963 sign-in link", "TREASURER PORTAL", "Here is your one-time sign-in link", "Use the secure button below to sign in to the Cub Scout Pack 3963 Treasurer Portal.", "Sign in to the Treasurer Portal"],
  invite: ["You are invited to the Pack 3963 Treasurer Portal", "PACK INVITATION", "You have been invited", "Use the secure button below to accept your invitation to the Cub Scout Pack 3963 Treasurer Portal.", "Accept invitation"],
  recovery: ["Reset your Pack 3963 portal password", "ACCOUNT RECOVERY", "Reset your password", "Use the secure button below to choose a new password for your Pack 3963 account.", "Reset password"],
  email_change: ["Confirm your Pack 3963 email change", "ACCOUNT UPDATE", "Confirm your email change", "Use the secure button below to confirm this email address for your Pack 3963 account.", "Confirm email change"],
  reauthentication: ["Confirm your Pack 3963 account", "SECURITY CHECK", "Confirm it is you", "Use the secure button below to complete this security check for your Pack 3963 account.", "Confirm account"]
};
const DEFAULT_COPY = ACTIONS.magiclink;
const MAX_BODY = 65536;
const SKEW = 300;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "pack3963-auth-email" });
    }
    if (request.method !== "POST" || url.pathname !== "/hooks/supabase/send-email") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const statedLength = Number(request.headers.get("content-length") || "0");
    if (statedLength > MAX_BODY) return Response.json({ error: "payload_too_large" }, { status: 413 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY) {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    try {
      await verifyWebhook(raw, request.headers, env.SUPABASE_AUTH_HOOK_SECRET);
    } catch {
      console.warn(JSON.stringify({ event: "auth_email_rejected", reason: "invalid_signature" }));
      return Response.json({ error: "invalid_signature" }, { status: 401 });
    }

    let event;
    try { event = JSON.parse(raw); }
    catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

    const action = event?.email_data?.email_action_type;
    const copy = ACTIONS[action] || DEFAULT_COPY;
    const sentAt = Number(request.headers.get("webhook-timestamp")) || Math.floor(Date.now() / 1000);
    const ttl = Math.max(1, Number(env.LINK_TTL_MINUTES || 60));
    const expiry = formatChicago(new Date((sentAt + ttl * 60) * 1000));
    const deliveries = getDeliveries(event, action);
    if (!deliveries.length) {
      console.error(JSON.stringify({ event: "auth_email_failed", action, reason: "invalid_payload" }));
      return Response.json({ error: { http_code: 400, message: "Invalid email hook payload" } }, { status: 400 });
    }

    for (const delivery of deliveries) {
      const link = verifyUrl(env.SUPABASE_URL, delivery.hash, action, event.email_data.redirect_to);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: "Bearer " + env.RESEND_API_KEY,
          "content-type": "application/json",
          "idempotency-key": (request.headers.get("webhook-id") || crypto.randomUUID()) + ":" + delivery.kind
        },
        body: JSON.stringify({
          from: env.FROM_EMAIL,
          to: [delivery.email],
          subject: copy[0],
          html: htmlEmail(copy, link, expiry, ttl, env.SUPPORT_EMAIL),
          text: textEmail(copy, link, expiry, ttl, env.SUPPORT_EMAIL)
        })
      });
      if (!response.ok) {
        console.error(JSON.stringify({ event: "auth_email_failed", action, provider_status: response.status }));
        return Response.json({ error: { http_code: response.status, message: "Email provider rejected the message" } }, { status: 502 });
      }
    }
    console.log(JSON.stringify({ event: "auth_email_sent", action, delivery_count: deliveries.length }));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  }
};

function getDeliveries(event, action) {
  const user = event?.user || {};
  const data = event?.email_data || {};
  if (action !== "email_change") {
    return validEmail(user.email) && data.token_hash ? [{ email: user.email, hash: data.token_hash, kind: "primary" }] : [];
  }
  const out = [];
  if (validEmail(user.email) && data.token_hash_new) out.push({ email: user.email, hash: data.token_hash_new, kind: "current" });
  if (validEmail(user.new_email) && data.token_hash) out.push({ email: user.new_email, hash: data.token_hash, kind: "new" });
  if (!out.length && validEmail(user.new_email || user.email) && data.token_hash) {
    out.push({ email: user.new_email || user.email, hash: data.token_hash, kind: "single" });
  }
  return out;
}
function validEmail(v) { return typeof v === "string" && v.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function verifyUrl(base, hash, type, redirect) {
  const url = new URL("/auth/v1/verify", base);
  url.searchParams.set("token", hash);
  url.searchParams.set("type", type);
  if (redirect) url.searchParams.set("redirect_to", redirect);
  return url.toString();
}
async function verifyWebhook(payload, headers, secretValue) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!secretValue || !id || !timestamp || !signatures) throw new Error("missing");
  const time = Number(timestamp);
  if (!Number.isFinite(time) || Math.abs(Date.now() / 1000 - time) > SKEW) throw new Error("stale");
  const secret = secretValue.replace(/^v1,whsec_/, "");
  const key = await crypto.subtle.importKey("raw", fromBase64(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id + "." + timestamp + "." + payload)));
  const candidates = signatures.split(" ").map(v => v.split(",")).filter(v => v[0] === "v1" && v[1]).map(v => v[1]);
  for (const candidate of candidates) {
    try { if (sameBytes(expected, fromBase64(candidate))) return; } catch {}
  }
  throw new Error("signature");
}
function fromBase64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function formatChicago(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
  }).format(date);
}
function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function htmlEmail(copy, link, expiry, ttl, support) {
  const u = esc(link), e = esc(expiry), s = esc(support);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(copy[0])}</title></head>
<body style="margin:0;background:#eef3f8;color:#243447;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(copy[2])} — valid for ${ttl} minutes.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(0,46,93,.12);">
<tr><td style="background:#004b8d;padding:28px 32px;border-bottom:8px solid #f7c600;"><div style="color:#fff;font-size:26px;font-weight:800;line-height:1.2;">Cub Scout Pack 3963</div><div style="color:#d9ecff;font-size:14px;margin-top:6px;">Treasurer Portal</div></td></tr>
<tr><td style="padding:34px 32px 18px;"><div style="color:#d71920;font-size:12px;font-weight:800;letter-spacing:1.2px;">${esc(copy[1])}</div>
<h1 style="color:#004b8d;font-size:28px;line-height:1.25;margin:10px 0 14px;">${esc(copy[2])}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 24px;">${esc(copy[3])}</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#f7c600;border-radius:8px;"><a href="${u}" style="display:inline-block;color:#003f75;font-weight:800;font-size:16px;text-decoration:none;padding:15px 22px;">${esc(copy[4])}</a></td></tr></table>
<div style="margin:26px 0 0;padding:16px 18px;background:#f4f8fc;border-left:4px solid #d71920;border-radius:6px;"><div style="font-size:14px;font-weight:700;color:#004b8d;">This link expires at ${e}</div><div style="font-size:13px;color:#526474;margin-top:4px;">That is ${ttl} minutes after this email was sent. The link can be used only for this request.</div></div>
<p style="font-size:13px;line-height:1.5;color:#607284;margin:24px 0 0;">If the button does not work, copy and paste this address into your browser:</p><p style="font-size:12px;line-height:1.5;word-break:break-all;margin:6px 0 0;"><a href="${u}" style="color:#004b8d;">${u}</a></p></td></tr>
<tr><td style="padding:18px 32px 30px;"><p style="font-size:13px;line-height:1.5;color:#607284;margin:0;">If you did not request this email, you can safely ignore it. Questions? Contact <a href="mailto:${s}" style="color:#004b8d;">${s}</a>.</p></td></tr>
<tr><td style="background:#003f75;color:#d9ecff;padding:18px 32px;font-size:12px;">Cub Scout Pack 3963 · Chicago, Illinois</td></tr></table></td></tr></table></body></html>`;
}
function textEmail(copy, link, expiry, ttl, support) {
  return ["CUB SCOUT PACK 3963 — TREASURER PORTAL", "", copy[2], "", copy[3], "", copy[4] + ":", link, "", "This link expires at " + expiry + " (" + ttl + " minutes after this email was sent).", "", "If you did not request this email, you can safely ignore it.", "Questions? Contact " + support].join("\\n");
}
