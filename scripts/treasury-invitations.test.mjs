import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import worker from "../cloudflare/pack3963-auth-email/worker.js";
import legacyWorker from "../workers/auth-email/src/index.js";
import { invitationEmail } from "../cloudflare/pack3963-auth-email/invitation.mjs";

const origin = "https://www.pack3963.com";
const endpoint = "https://worker.example/api/treasurer/invite-user";
const env = { SUPABASE_URL: "https://project.supabase.co", SUPPORT_EMAIL: "help@example.org", FROM_EMAIL: "Pack <portal@example.org>", RESEND_API_KEY: "test-only" };
const requestId = "b7b74d4f-12af-4336-8da7-01fe8bc49f30";
const recipient = { email: "leader@example.org", display_name: "Pack Leader", role: "treasurer", active: true };
const request = (payload = {}, headers = {}) => new Request(endpoint, { method: "POST", headers: { origin, authorization: "Bearer valid-session", "content-type": "application/json", ...headers }, body: JSON.stringify({ email: recipient.email, request_id: requestId, ...payload }) });

function mockProvider(t, options = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    url = String(url); calls.push({ url, ...init });
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "actor-id", email: "admin@example.org" }, { status: options.authStatus || 200 });
    if (url.includes("/rest/v1/authorized_users")) {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer valid-session");
      if (url.includes("admin%40example.org")) return Response.json(options.actorInactive ? [] : [{ role: options.actorRole || "admin", active: true }]);
      return Response.json(options.targetDisabled ? [] : [{ ...recipient, ...options.target }]);
    }
    if (url === "https://api.resend.com/emails") {
      if (options.networkError) throw new Error("Network failure with sensitive details");
      return Response.json({ id: "email-id" }, { status: options.sendStatus || 200 });
    }
    assert.fail(`Unexpected external request: ${url}`);
  });
  return calls;
}

test("only an active admin can send an invitation", async t => {
  for (const options of [{ actorRole: "viewer" }, { actorRole: "treasurer" }, { actorInactive: true }, { authStatus: 401 }]) {
    await t.test(JSON.stringify(options), async t => {
      const calls = mockProvider(t, options);
      const response = await worker.fetch(request(), env);
      assert.equal(response.status, options.authStatus ? 401 : 403);
      assert.ok(calls.every(c => c.url !== "https://api.resend.com/emails"));
    });
  }
});

test("rejects missing sessions and unapproved origins before fetching", async t => {
  const calls = mockProvider(t);
  assert.equal((await worker.fetch(request({}, { authorization: "" }), env)).status, 401);
  assert.equal((await worker.fetch(request({}, { origin: "https://untrusted.example" }), env)).status, 403);
  assert.equal((await worker.fetch(request({}, { origin: "https://pack3963.com.evil.example" }), env)).status, 403);
  assert.equal(calls.length, 0);
});

test("refuses disabled/unapproved recipients and invalid requests without sending", async t => {
  for (const [name, options, payload] of [
    ["disabled", { targetDisabled: true }, {}],
    ["invalid role", { target: { role: "owner" } }, {}],
    ["invalid email", {}, { email: "bad\r\nBcc: victim@example.org" }],
    ["missing request ID", {}, { request_id: "" }]
  ]) {
    await t.test(name, async t => {
      const calls = mockProvider(t, options);
      assert.equal((await worker.fetch(request(payload), env)).status, 400);
      assert.ok(calls.every(c => c.url !== "https://api.resend.com/emails"));
    });
  }
});

test("rejects an oversized body even without Content-Length", async t => {
  const calls = mockProvider(t);
  const response = await worker.fetch(request({ padding: "x".repeat(5000) }), env);
  assert.equal(response.status, 413);
  assert.ok(calls.every(c => c.url !== "https://api.resend.com/emails"));
});

test("uses saved recipient and role, fixes the portal destination, and reuses retry keys", async t => {
  const calls = mockProvider(t, { target: { role: "viewer" } });
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(request({ role: "admin", display_name: "Spoofed Name", portal_url: "https://evil.example" }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(await response.json(), { ok: true });
  }
  const sends = calls.filter(c => c.url === "https://api.resend.com/emails");
  assert.equal(sends.length, 2);
  assert.equal(sends[0].headers["idempotency-key"], sends[1].headers["idempotency-key"]);
  const email = JSON.parse(sends[0].body);
  assert.deepEqual(email.to, [recipient.email]);
  assert.equal(email.reply_to, env.SUPPORT_EMAIL);
  assert.match(email.text, /YOUR ACCESS: View only/);
  assert.match(email.text, /You cannot change records/);
  assert.match(email.text, /https:\/\/www.pack3963.com\/treasurer.html/);
  assert.doesNotMatch(email.text + email.html, /evil\.example|Spoofed Name/);
  assert.ok(email.text.includes("\n"));
});

test("a deliberate resend gets a new provider key", async t => {
  const calls = mockProvider(t);
  await worker.fetch(request(), env);
  await worker.fetch(request({ request_id: "c7b74d4f-12af-4336-8da7-01fe8bc49f30" }), env);
  const sends = calls.filter(c => c.url === "https://api.resend.com/emails");
  assert.notEqual(sends[0].headers["idempotency-key"], sends[1].headers["idempotency-key"]);
});

test("provider and network failures never claim success or expose sensitive errors", async t => {
  for (const options of [{ sendStatus: 429 }, { sendStatus: 500 }, { networkError: true }]) {
    await t.test(JSON.stringify(options), async t => {
      mockProvider(t, options);
      const response = await worker.fetch(request(), env);
      assert.equal(response.status, 502);
      const result = await response.json();
      assert.equal(result.ok, undefined);
      assert.doesNotMatch(result.error, /sensitive details|test-only/);
    });
  }
});

test("HTML escapes personalized content and all roles get accurate onboarding", () => {
  for (const role of ["admin", "treasurer", "viewer"]) {
    const email = invitationEmail({ ...recipient, role, display_name: '<img src=x onerror="alert(1)">' });
    assert.ok(email.html.includes("&lt;img"));
    assert.doesNotMatch(email.html, /<img src=x/);
    assert.match(email.html, /cubscoutlogo\.png/);
    assert.match(email.html, /lang="en"/);
    assert.match(email.text, /There is no password/);
    assert.match(email.text, /Scouts & accounts:/);
    assert.match(email.text, /Family emails:/);
    if (role === "viewer") assert.match(email.text, /You cannot change records, send emails, or manage access/);
    if (role === "admin") assert.match(email.text, /Add or update authorized users/);
  }
});

test("preflight, health, and existing auth hook routing still work", async () => {
  assert.equal(legacyWorker, worker);
  const preflight = await worker.fetch(new Request(endpoint, { method: "OPTIONS", headers: { origin } }), env);
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /authorization/);
  assert.equal((await worker.fetch(new Request("https://worker.example/health"), env)).status, 200);
  const hook = await worker.fetch(new Request("https://worker.example/hooks/supabase/send-email", { method: "POST", body: "{}" }), env);
  assert.equal(hook.status, 401);
});

test("existing signed sign-in emails still reach the provider", async t => {
  let sent;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails"); sent = JSON.parse(init.body);
    return Response.json({ id: "auth-email-id" });
  });
  const raw = JSON.stringify({ user: { email: "leader@example.org" }, email_data: { email_action_type: "magiclink", token_hash: "test-token", redirect_to: "https://www.pack3963.com/treasurer.html" } });
  const secret = btoa("a-test-secret-with-enough-bytes");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret), c => c.charCodeAt(0)), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("hook-id." + timestamp + "." + raw)))));
  const response = await worker.fetch(new Request("https://worker.example/hooks/supabase/send-email", {method:"POST",body:raw,headers:{"webhook-id":"hook-id","webhook-timestamp":timestamp,"webhook-signature":"v1,"+signature}}), {...env,SUPABASE_AUTH_HOOK_SECRET:"v1,whsec_"+secret});
  assert.equal(response.status, 200);
  assert.match(sent.subject, /one-time Pack 3963 sign-in link/);
  assert.match(sent.html, /token=test-token/);
});

function portalHarness(sendResponse, upsertError = null) {
  const statusElement = {textContent:"",className:""};
  const button = {disabled:false};
  const form = {dataset:{},querySelector:()=>button,reset(){this.didReset=true;},values:{email:" Leader@Example.org ",display_name:"Leader",role:"viewer"}};
  let calls=0, reloads=0;
  const client = {from:()=>({upsert:async()=>({error:upsertError})}),auth:{getSession:async()=>({data:{session:{access_token:"session"}}})}};
  const context = vm.createContext({
    document:{querySelector:()=>statusElement,addEventListener(){}},window:{supabase:{createClient:()=>client}},
    FormData:class{constructor(form){this.form=form;}get(k){return this.form.values[k];}},crypto,AbortSignal,
    fetch:async()=>{calls++;return sendResponse();},reload:()=>{reloads++;}
  });
  const source = readFileSync(new URL("../assets/js/treasurer.js", import.meta.url), "utf8").replace(/\}\)\(\);\s*$/, "loadAll = async () => reload(); globalThis.portalTest = { savePortalAccess };})();");
  vm.runInContext(source, context);
  return {form,button,statusElement,save:()=>context.portalTest.savePortalAccess(form),calls:()=>calls,reloads:()=>reloads};
}

test("portal preserves saved access and retry ID when sending fails", async () => {
  const h=portalHarness(()=>Response.json({error:"Provider unavailable"},{status:502}));
  await h.save(); const id=h.form.dataset.invitationRequestId;
  assert.match(h.statusElement.textContent,/Access is saved, but invitation delivery was not confirmed/);
  assert.ok(id); assert.equal(h.form.didReset,undefined); assert.equal(h.button.disabled,false);
  await h.save(); assert.equal(h.form.dataset.invitationRequestId,id);
  assert.equal(h.reloads(),2);
});

test("portal reports email acceptance after refreshing and blocks duplicate submits", async () => {
  let release;
  const h=portalHarness(()=>new Promise(resolve=>{release=()=>resolve(Response.json({ok:true}));}));
  const pending=h.save();
  while(!release) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.button.disabled,true);
  await h.save(); assert.equal(h.calls(),1);
  release(); await pending;
  assert.match(h.statusElement.textContent,/Invitation email accepted for leader@example.org/);
  assert.equal(h.form.didReset,true); assert.equal(h.form.dataset.invitationRequestId,undefined); assert.equal(h.reloads(),1);
});

test("portal never sends when access could not be saved", async () => {
  const h=portalHarness(()=>Response.json({ok:true}),new Error("Access denied"));
  await h.save(); assert.equal(h.calls(),0); assert.match(h.statusElement.textContent,/Access denied/);
});
