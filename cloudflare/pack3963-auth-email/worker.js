import { invitationEmail } from "./invitation.mjs";
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
    if (url.pathname === "/api/treasurer/invite-user") {
      if (request.method === "OPTIONS") return corsResponse(request, null, 204);
      if (request.method === "POST") return handleUserInvitation(request, env);
      return corsResponse(request, { error: "method_not_allowed" }, 405);
    }
    if (request.method === "OPTIONS" && url.pathname === "/api/treasurer/send-email") return corsResponse(request, null, 204);
    if (request.method === "POST" && url.pathname === "/api/treasurer/send-email") return handleTreasurerEmail(request, env);
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


const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
async function handleUserInvitation(request, env) {
  if (!allowedOrigin(request)) return corsResponse(request, { error: "origin_not_allowed" }, 403);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return corsResponse(request, { error: "Sign in again before sending an invitation." }, 401);
  const token = authorization.replace(/^Bearer\s+/i, "");
  try {
    const auth = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization }, signal: AbortSignal.timeout(10000)
    });
    if (!auth.ok) return corsResponse(request, { error: "Your session expired. Sign in again." }, 401);
    const actor = await auth.json();
    const access = await sbFetch(env, token, "authorized_users?select=role,active&email=eq." + encodeURIComponent(String(actor.email || "").toLowerCase()) + "&active=eq.true");
    if (access[0]?.role !== "admin") return corsResponse(request, { error: "Only an active administrator can invite users." }, 403);
    if (Number(request.headers.get("content-length") || 0) > 4096) return corsResponse(request, { error: "Invitation request is too large." }, 413);
    // Bound streamed bodies too; Content-Length is optional and untrusted.
    const reader = request.body?.getReader();
    const chunks = []; let size = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) { await reader.cancel(); return corsResponse(request, { error: "Invitation request is too large." }, 413); }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return corsResponse(request, { error: "Invalid invitation request." }, 400); }
    const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!validEmail(email) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload?.request_id || "")) {
      return corsResponse(request, { error: "A valid email and request ID are required." }, 400);
    }
    // Read recipient and role from the approved access list, never from browser claims.
    const users = await sbFetch(env, token, "authorized_users?select=email,display_name,role,active&email=eq." + encodeURIComponent(email) + "&active=eq.true");
    const user = users[0];
    if (!user || !["admin", "treasurer", "viewer"].includes(user.role)) return corsResponse(request, { error: "Save active portal access for this user before sending an invitation." }, 400);
    const message = invitationEmail(user, env.SUPPORT_EMAIL);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([actor.id, payload.request_id, user.email, user.display_name, user.role])));
    const key = "portal-invite-" + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ from: env.FROM_EMAIL, to: [user.email], reply_to: env.SUPPORT_EMAIL, ...message })
    });
    if (!sent.ok) {
      console.warn(JSON.stringify({ event: "portal_invitation_failed", provider_status: sent.status }));
      return corsResponse(request, { error: "Invitation could not be sent. Access is saved; use Resend invitation to retry." }, 502);
    }
    console.log(JSON.stringify({ event: "portal_invitation_accepted" }));
    return corsResponse(request, { ok: true });
  } catch {
    console.error(JSON.stringify({ event: "portal_invitation_failed", reason: "request_failed" }));
    return corsResponse(request, { error: "Unable to confirm invitation delivery. Use Resend invitation to retry." }, 502);
  }
}
const ALLOWED_ORIGINS = ["https://pack3963.com","https://www.pack3963.com","https://pack3963.pages.dev"];
function allowedOrigin(request) {
  const o=request.headers.get("origin")||"";
  return ALLOWED_ORIGINS.includes(o)||/^https:\/\/[a-z0-9-]+\.pack3963\.pages\.dev$/i.test(o)?o:"";
}
function corsResponse(request, body, status=200) {
  const o=allowedOrigin(request);
  if(!o) return Response.json({error:"origin_not_allowed"},{status:403});
  const h={"access-control-allow-origin":o,"access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"authorization, content-type","access-control-max-age":"86400","vary":"Origin"};
  return body==null?new Response(null,{status,headers:h}):Response.json(body,{status,headers:h});
}
async function sbFetch(env,token,path,init={}) {
  const h=new Headers(init.headers||{}); h.set("apikey",SUPABASE_PUBLISHABLE_KEY); h.set("authorization","Bearer "+token);
  if(init.body) h.set("content-type","application/json");
  const r=await fetch(env.SUPABASE_URL+"/rest/v1/"+path,{...init,headers:h});
  const t=await r.text(); const d=t?JSON.parse(t):null;
  if(!r.ok) throw new Error(d?.message||"Database request failed");
  return d;
}
async function handleTreasurerEmail(request,env) {
  if(!allowedOrigin(request)) return corsResponse(request,{error:"origin_not_allowed"},403);
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return corsResponse(request,{error:"missing_session"},401);
  try {
    const ur=await fetch(env.SUPABASE_URL+"/auth/v1/user",{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+token}});
    if(!ur.ok) return corsResponse(request,{error:"invalid_session"},401);
    const user=await ur.json();
    const access=await sbFetch(env,token,"authorized_users?select=email,role,active&email=eq."+encodeURIComponent(String(user.email||"").toLowerCase())+"&active=eq.true");
    if(!access.length||!["admin","treasurer"].includes(access[0].role)) return corsResponse(request,{error:"not_authorized"},403);
    const p=await request.json();
    const ids=[...new Set(Array.isArray(p.household_ids)?p.household_ids:[])].filter(v=>/^[0-9a-f-]{36}$/i.test(v)).slice(0,100);
    const type=p.message_type==="custom"?"custom":"invoice", subject=String(p.subject||"").trim().slice(0,180), body=String(p.body_text||"").trim().slice(0,8000);
    if(!ids.length||!subject||!body) return corsResponse(request,{error:"missing_required_fields"},400);
    const made=await sbFetch(env,token,"email_messages",{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify({message_type:type,subject,body_text:body,status:"sending",sent_by_email:user.email,recipient_count:0})});
    const message=made[0]; let sent=0,failed=0,skipped=0;
    for(const hid of ids) {
      const hs=await sbFetch(env,token,"financial_accounts?select=id,display_name&id=eq."+hid+"&account_type=eq.household&active=eq.true");
      if(!hs.length){skipped++;continue}
      const cs=await sbFetch(env,token,"household_contacts?select=full_name,email,is_primary&household_account_id=eq."+hid+"&active=eq.true&email=not.is.null&order=is_primary.desc");
      const c=cs.find(x=>validEmail(x.email)); if(!c){skipped++;continue}
      const bs=await sbFetch(env,token,"account_balances?select=id,balance_cents&or=(id.eq."+hid+",parent_account_id.eq."+hid+")");
      const due=bs.reduce((n,x)=>n+Math.max(0,Number(x.balance_cents||0)),0);
      let provider=null,rs="failed",err=null;
      try {
        const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:"Bearer "+env.RESEND_API_KEY,"content-type":"application/json","idempotency-key":message.id+":"+hid},body:JSON.stringify({from:env.FROM_EMAIL,to:[c.email],subject,html:treasurerHtml(hs[0].display_name,subject,body,type==="invoice"?due:null,env.SUPPORT_EMAIL),text:treasurerText(hs[0].display_name,body,type==="invoice"?due:null,env.SUPPORT_EMAIL),reply_to:env.SUPPORT_EMAIL})});
        const rd=await rr.json(); if(!rr.ok) throw new Error(rd?.message||"Email provider rejected the message");
        provider=rd.id||null;rs="sent";sent++;
      } catch(e){err=String(e.message||e).slice(0,500);failed++}
      await sbFetch(env,token,"email_recipients",{method:"POST",headers:{prefer:"return=minimal"},body:JSON.stringify({message_id:message.id,household_account_id:hid,recipient_name:c.full_name,recipient_email:c.email,provider_message_id:provider,status:rs,error_message:err,sent_at:rs==="sent"?new Date().toISOString():null})});
    }
    const final=sent&&!failed&&!skipped?"sent":sent?"partial":"failed";
    await sbFetch(env,token,"email_messages?id=eq."+message.id,{method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({status:final,recipient_count:sent,sent_at:new Date().toISOString()})});
    return corsResponse(request,{ok:sent>0,message_id:message.id,sent,failed,skipped,status:final},sent>0?200:400);
  } catch(e){console.error(JSON.stringify({event:"treasurer_email_failed",reason:String(e.message||e)}));return corsResponse(request,{error:String(e.message||"Unable to send email")},500)}
}
function fmtMoney(v){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(v)||0)/100)}
function treasurerHtml(family,subject,body,due,support){
  const ps=String(body).split(/\n{2,}/).map(p=>"<p style='font-size:16px;line-height:1.6;margin:0 0 16px'>"+esc(p).replace(/\n/g,"<br>")+"</p>").join("");
  const bal=due==null?"":"<div style='margin:20px 0;padding:18px;background:#f4f8fc;border-left:5px solid #d71920;border-radius:7px'><div style='font-size:13px;font-weight:800;color:#526474'>CURRENT PACK BALANCE DUE</div><div style='font-size:30px;font-weight:800;color:#004b8d;margin-top:4px'>"+fmtMoney(due)+"</div></div>";
  return "<!doctype html><html><body style='margin:0;background:#eef3f8;color:#243447;font-family:Arial,Helvetica,sans-serif'><table width='100%' role='presentation' style='padding:24px 12px'><tr><td align='center'><table width='100%' role='presentation' style='max-width:620px;background:#fff;border-radius:15px;overflow:hidden'><tr><td style='background:#004b8d;padding:26px 30px;border-bottom:8px solid #f7c600;color:#fff'><div style='font-size:25px;font-weight:800'>Cub Scout Pack 3963</div><div style='color:#d9ecff;margin-top:5px'>Pack Treasurer</div></td></tr><tr><td style='padding:30px'><div style='color:#d71920;font-size:12px;font-weight:800;letter-spacing:1px'>PACK ACCOUNT</div><h1 style='color:#004b8d;font-size:25px;margin:8px 0 18px'>"+esc(subject)+"</h1><p style='font-size:16px;line-height:1.6'>Hello "+esc(family)+",</p>"+ps+bal+"<p style='font-size:13px;color:#607284;margin-top:24px'>Questions? Reply or contact <a href='mailto:"+esc(support)+"'>"+esc(support)+"</a>.</p></td></tr><tr><td style='background:#003f75;color:#d9ecff;padding:17px 30px;font-size:12px'>Cub Scout Pack 3963 · Chicago, Illinois</td></tr></table></td></tr></table></body></html>"
}
function treasurerText(family,body,due,support){return "CUB SCOUT PACK 3963\n\nHello "+family+",\n\n"+body+(due==null?"":"\n\nCurrent Pack balance due: "+fmtMoney(due))+"\n\nQuestions? Contact "+support}

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
