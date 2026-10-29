import { invitationEmail } from "./invitation.mjs";
const ACTIONS = {
  signup: ["Your one-time Pack 3963 sign-in link", "TREASURER PORTAL", "Here is your one-time sign-in link", "Use the secure button below to sign in to the Cub Scout Pack 3963 Treasurer Portal.", "Sign in to the Treasurer Portal"],
  magiclink: ["Your one-time Pack 3963 sign-in link", "TREASURER PORTAL", "Here is your one-time sign-in link", "Use the secure button below to sign in to the Cub Scout Pack 3963 Treasurer Portal.", "Sign in to the Treasurer Portal"],
  invite: ["You are invited to the Pack 3963 Treasurer Portal", "PACK INVITATION", "You have been invited", "Use the secure button below to accept your invitation to the Cub Scout Pack 3963 Treasurer Portal.", "Accept invitation"],
  recovery: ["Reset your Pack 3963 portal password", "ACCOUNT RECOVERY", "Reset your password", "Use the secure button below to choose a new password for your Pack 3963 account.", "Reset password"],
  email_change: ["Confirm your Pack 3963 email change", "ACCOUNT UPDATE", "Confirm your email change", "Use the secure button below to confirm this email address for your Pack 3963 account.", "Confirm email change"],
  reauthentication: ["Confirm your Pack 3963 account", "SECURITY CHECK", "Confirm it is you", "Use the secure button below to complete this security check for your Pack 3963 account.", "Confirm account"]
};
const PARENT_ACTIONS = {
  signup: ["Your one-time Pack 3963 Parent Portal sign-in link", "PARENT PORTAL", "Here is your one-time parent portal sign-in link", "Use the secure button below to sign in to the Cub Scouts Pack 3963 Parent Portal.", "Sign into the Parent Portal"],
  magiclink: ["Your one-time Pack 3963 Parent Portal sign-in link", "PARENT PORTAL", "Here is your one-time parent portal sign-in link", "Use the secure button below to sign in to the Cub Scouts Pack 3963 Parent Portal.", "Sign into the Parent Portal"]
};
const DEFAULT_COPY = ACTIONS.magiclink;
const MAX_BODY = 65536;
const SKEW = 300;
const RECEIPT_SYNC_PATH = "/api/treasurer/receipt-drive-sync";
const INVOICE_SYNC_PATH = "/api/treasurer/invoice-drive-sync";

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
    if (url.pathname === RECEIPT_SYNC_PATH) {
      if (request.method === "OPTIONS") return corsResponse(request, null, 204);
      if (request.method === "POST") return handleReceiptDriveSync(request, env);
      return corsResponse(request, { error: "method_not_allowed" }, 405);
    }
    if (url.pathname === INVOICE_SYNC_PATH) {
      if (request.method === "OPTIONS") return corsResponse(request, null, 204);
      if (request.method === "POST") return handleInvoiceDriveSync(request, env);
      return corsResponse(request, { error: "method_not_allowed" }, 405);
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
    const isParentPortal = isParentRedirect(event?.email_data?.redirect_to);
    const copy = (isParentPortal ? PARENT_ACTIONS[action] : ACTIONS[action]) || DEFAULT_COPY;
    const sender = isParentPortal ? (env.PARENT_PORTAL_FROM_EMAIL || env.FROM_EMAIL) : env.FROM_EMAIL;
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
          from: sender,
          to: [delivery.email],
          reply_to: env.SUPPORT_EMAIL,
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

async function activeTreasuryUser(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Your session expired. Sign in again.", status: 401 };
  const response = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: "Bearer " + token },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return { error: "Your session expired. Sign in again.", status: 401 };
  const user = await response.json();
  const access = await sbFetch(env, token, "authorized_users?select=role,active&email=eq." + encodeURIComponent(String(user.email || "").toLowerCase()) + "&active=eq.true");
  if (!access.length || !["admin", "treasurer"].includes(access[0].role)) {
    return { error: "Only an active administrator or treasurer can synchronize receipts.", status: 403 };
  }
  return { token, user, role: access[0].role };
}

async function handleReceiptDriveSync(request, env) {
  if (!allowedOrigin(request)) return corsResponse(request, { error: "origin_not_allowed" }, 403);
  try {
    const actor = await activeTreasuryUser(request, env);
    if (actor.error) return corsResponse(request, { error: actor.error }, actor.status);
    const statedLength = Number(request.headers.get("content-length") || 0);
    if (statedLength > 4096) return corsResponse(request, { error: "Receipt sync request is too large." }, 413);
    const payload = await request.json();
    const receiptId = validUuid(payload?.receipt_id) ? payload.receipt_id : null;
    const expenseId = validUuid(payload?.expense_id) ? payload.expense_id : null;
    const syncPending = payload?.sync_pending === true;
    const reviewAll = payload?.review_all === true;
    if (!receiptId && !expenseId && !syncPending && !reviewAll) return corsResponse(request, { error: "Choose a receipt, expense, the pending queue, or a full attachment review." }, 400);

    const filters = receiptId
      ? "id=eq." + receiptId + "&"
      : expenseId
        ? "expense_id=eq." + expenseId + "&"
        : reviewAll
          ? ""
          : "drive_sync_status=in.(pending,error)&";
    const receipts = await sbFetch(env, actor.token, "expense_receipts?select=*&" + filters + "order=created_at.asc&limit=100");
    if (!receipts.length) return corsResponse(request, { ok: true, synced: 0, failed: 0, results: [] });

    const accessToken = await googleAccessToken(env);
    const results = [];
    for (const receipt of receipts) {
      try {
        const result = await syncReceiptToDrive(env, actor.token, accessToken, receipt);
        results.push({ receipt_id: receipt.id, ok: true, ...result });
      } catch (error) {
        const message = publicDriveError(error);
        await updateReceiptSync(env, actor.token, receipt.id, {
          drive_sync_status: "error",
          drive_sync_error: message,
          drive_last_attempt_at: new Date().toISOString()
        });
        console.warn(JSON.stringify({ event: "receipt_drive_sync_failed", receipt_id: receipt.id, reason: message }));
        results.push({ receipt_id: receipt.id, ok: false, error: message });
      }
    }
    const synced = results.filter(item => item.ok).length;
    const failed = results.length - synced;
    console.log(JSON.stringify({ event: "receipt_drive_sync_complete", requested: results.length, synced, failed }));
    return corsResponse(request, { ok: failed === 0, synced, failed, results }, failed === results.length ? 502 : 200);
  } catch (error) {
    const message = publicDriveError(error);
    console.error(JSON.stringify({ event: "receipt_drive_sync_failed", reason: message }));
    return corsResponse(request, { error: message }, 500);
  }
}

async function syncReceiptToDrive(env, token, accessToken, receipt) {
  await updateReceiptSync(env, token, receipt.id, {
    drive_sync_status: "syncing",
    drive_sync_error: null,
    drive_last_attempt_at: new Date().toISOString()
  });
  const expenses = await sbFetch(env, token, "expenses?select=id,purchased_on,vendor,category,amount_cents,description,voided_at&id=eq." + receipt.expense_id + "&limit=1");
  const expense = expenses[0];
  if (!expense) throw new Error("The linked expense no longer exists.");
  if (expense.voided_at) throw new Error("Restore the removed expense before synchronizing its receipt.");

  const folderName = driveFolderName(expense.purchased_on);
  const folderId = await findOrCreateDriveFolder(env, accessToken, folderName);
  let filename = driveReceiptFilename(expense, receipt);
  let driveFile;
  if (receipt.drive_file_id) {
    try {
      driveFile = await updateDriveFile(accessToken, receipt.drive_file_id, filename, folderId, receipt.drive_folder_id);
    } catch (error) {
      if (error.status !== 404) throw error;
      filename = await uniqueDriveFilename(accessToken, folderId, filename);
      const stored = await fetchStoredReceipt(env, token, receipt.storage_path);
      driveFile = await uploadDriveFile(accessToken, stored, filename, folderId, receipt.content_type, receipt.size_bytes);
    }
  } else {
    filename = await uniqueDriveFilename(accessToken, folderId, filename);
    const stored = await fetchStoredReceipt(env, token, receipt.storage_path);
    driveFile = await uploadDriveFile(accessToken, stored, filename, folderId, receipt.content_type, receipt.size_bytes);
  }
  const syncedAt = new Date().toISOString();
  await updateReceiptSync(env, token, receipt.id, {
    drive_file_id: driveFile.id,
    drive_folder_id: folderId,
    drive_filename: driveFile.name || filename,
    drive_web_view_link: driveFile.webViewLink || null,
    drive_sync_status: "synced",
    drive_sync_error: null,
    drive_last_attempt_at: syncedAt,
    drive_synced_at: syncedAt
  });
  return { drive_file_id: driveFile.id, drive_filename: driveFile.name || filename, folder_name: folderName };
}

async function googleAccessToken(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN || !env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
    throw new Error("Google Drive synchronization is not configured yet.");
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error("Google authorization needs to be reconnected.");
  return result.access_token;
}

async function findOrCreateDriveFolder(env, accessToken, folderName, parentId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
  const rootId = String(parentId);
  const escapedName = folderName.replace(/'/g, "\\'");
  const q = `'${rootId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const search = await googleFetch("https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=10&fields=files(id,name)&q=" + encodeURIComponent(q), accessToken);
  if (search.files?.length) return search.files[0].id;
  const created = await googleFetch("https://www.googleapis.com/drive/v3/files?fields=id,name", accessToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [rootId] })
  });
  return created.id;
}

async function fetchStoredReceipt(env, token, storagePath) {
  const path = String(storagePath || "").split("/").map(encodeURIComponent).join("/");
  const response = await fetch(env.SUPABASE_URL + "/storage/v1/object/authenticated/pack-receipts/" + path, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: "Bearer " + token },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok || !response.body) throw new Error("The private Supabase receipt could not be downloaded.");
  return response;
}

async function uploadDriveFile(accessToken, stored, filename, folderId, contentType, sizeBytes) {
  const type = contentType || stored.headers.get("content-type") || "application/octet-stream";
  const length = Number(sizeBytes || stored.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length <= 0 || length > 10485760) throw new Error("Receipt size is invalid or exceeds 10 MB.");
  const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,parents", {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": type,
      "x-upload-content-length": String(length)
    },
    body: JSON.stringify({ name: filename, parents: [folderId] }),
    signal: AbortSignal.timeout(15000)
  });
  if (!start.ok) throw new Error("Google Drive rejected the receipt upload.");
  const location = start.headers.get("location");
  if (!location) throw new Error("Google Drive did not provide an upload location.");
  const uploaded = await fetch(location, {
    method: "PUT",
    headers: { "content-type": type, "content-length": String(length) },
    body: stored.body,
    signal: AbortSignal.timeout(60000)
  });
  if (!uploaded.ok) throw new Error("Google Drive could not finish the receipt upload.");
  return uploaded.json();
}

async function updateDriveFile(accessToken, fileId, filename, folderId, previousFolderId) {
  const url = new URL("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId));
  url.searchParams.set("fields", "id,name,webViewLink,parents");
  if (folderId && folderId !== previousFolderId) url.searchParams.set("addParents", folderId);
  if (previousFolderId && folderId !== previousFolderId) url.searchParams.set("removeParents", previousFolderId);
  return googleFetch(url.toString(), accessToken, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: filename })
  });
}

async function uniqueDriveFilename(accessToken, folderId, filename) {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  const escapedStem = stem.replace(/'/g, "\\'");
  const q = `'${folderId}' in parents and name contains '${escapedStem}' and trashed = false`;
  const result = await googleFetch("https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=100&fields=files(name)&q=" + encodeURIComponent(q), accessToken);
  const names = new Set((result.files || []).map(file => file.name));
  if (!names.has(filename)) return filename;
  for (let number = 2; number <= 100; number++) {
    const candidate = `${stem} (${number})${extension}`;
    if (!names.has(candidate)) return candidate;
  }
  throw new Error("Too many receipts have the same generated filename.");
}

async function googleFetch(url, accessToken, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("authorization", "Bearer " + accessToken);
  const response = await fetch(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result?.error?.message || "Google Drive request failed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function updateReceiptSync(env, token, receiptId, values) {
  await sbFetch(env, token, "expense_receipts?id=eq." + receiptId, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(values)
  });
}


async function handleInvoiceDriveSync(request, env) {
  if (!allowedOrigin(request)) return corsResponse(request, { error: "origin_not_allowed" }, 403);
  try {
    const actor = await activeTreasuryUser(request, env);
    if (actor.error) return corsResponse(request, { error: actor.error }, actor.status);
    const payload = await request.json();
    const invoiceIds = [...new Set(Array.isArray(payload?.invoice_ids) ? payload.invoice_ids : [])].filter(validUuid).slice(0, 50);
    const syncPending = payload?.sync_pending === true;
    if (!invoiceIds.length && !syncPending) return corsResponse(request, { error: "Choose one or more invoices or the pending invoice queue." }, 400);
    const filter = invoiceIds.length
      ? "id=in.(" + invoiceIds.join(",") + ")"
      : "drive_sync_status=in.(pending,error)";
    const invoices = await sbFetch(env, actor.token, "invoice_documents?select=*&" + filter + "&order=created_at.asc&limit=50");
    if (!invoices.length) return corsResponse(request, { ok: true, synced: 0, failed: 0, results: [] });

    const accessToken = await googleAccessToken(env);
    const results = [];
    for (const invoice of invoices) {
      try {
        const result = await syncInvoiceToDrive(env, actor.token, accessToken, invoice);
        results.push({ invoice_id: invoice.id, ok: true, ...result });
      } catch (error) {
        const message = publicDriveError(error);
        await updateInvoiceSync(env, actor.token, invoice.id, {
          drive_sync_status: "error",
          drive_sync_error: message,
          drive_last_attempt_at: new Date().toISOString()
        });
        console.warn(JSON.stringify({ event: "invoice_drive_sync_failed", invoice_id: invoice.id, reason: message }));
        results.push({ invoice_id: invoice.id, ok: false, error: message });
      }
    }
    const synced = results.filter(item => item.ok).length;
    const failed = results.length - synced;
    return corsResponse(request, { ok: failed === 0, synced, failed, results }, failed === results.length ? 502 : 200);
  } catch (error) {
    const message = publicDriveError(error);
    console.error(JSON.stringify({ event: "invoice_drive_sync_failed", reason: message }));
    return corsResponse(request, { error: message }, 500);
  }
}

async function syncInvoiceToDrive(env, token, accessToken, invoice) {
  await updateInvoiceSync(env, token, invoice.id, {
    drive_sync_status: "syncing",
    drive_sync_error: null,
    drive_last_attempt_at: new Date().toISOString()
  });
  const invoicesFolderId = await findOrCreateDriveFolder(env, accessToken, "Invoices");
  const year = /^\d{4}/.test(String(invoice.invoice_date || "")) ? String(invoice.invoice_date).slice(0, 4) : "Undated";
  const yearFolderId = await findOrCreateDriveFolder(env, accessToken, year, invoicesFolderId);
  const filename = driveInvoiceFilename(invoice);
  let driveFile;
  if (invoice.drive_file_id) {
    try {
      driveFile = await updateDriveFile(accessToken, invoice.drive_file_id, filename, yearFolderId, invoice.drive_folder_id);
    } catch (error) {
      if (error.status !== 404) throw error;
      driveFile = await uploadDriveDocument(accessToken, invoiceDocumentHtml(invoice), filename, yearFolderId);
    }
  } else {
    driveFile = await uploadDriveDocument(accessToken, invoiceDocumentHtml(invoice), filename, yearFolderId);
  }
  const syncedAt = new Date().toISOString();
  await updateInvoiceSync(env, token, invoice.id, {
    drive_file_id: driveFile.id,
    drive_folder_id: yearFolderId,
    drive_filename: driveFile.name || filename,
    drive_web_view_link: driveFile.webViewLink || null,
    drive_sync_status: "synced",
    drive_sync_error: null,
    drive_last_attempt_at: syncedAt,
    drive_synced_at: syncedAt
  });
  return { drive_file_id: driveFile.id, drive_filename: driveFile.name || filename, drive_web_view_link: driveFile.webViewLink || null, folder_name: "Invoices/" + year };
}

async function uploadDriveDocument(accessToken, html, filename, folderId) {
  const boundary = "pack3963-" + crypto.randomUUID();
  const metadata = { name: filename, mimeType: "application/vnd.google-apps.document", parents: [folderId] };
  const body = [
    "--" + boundary,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    "--" + boundary,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    "--" + boundary + "--"
  ].join("\\r\\n");
  return googleFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,parents", accessToken, {
    method: "POST",
    headers: { "content-type": "multipart/related; boundary=" + boundary },
    body
  });
}

export function driveInvoiceFilename(invoice) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(invoice.invoice_date || "")) ? invoice.invoice_date : "Undated";
  const family = cleanDriveName(invoice.family_name || "Family");
  const number = cleanDriveName(invoice.invoice_number || String(invoice.id || "").slice(0, 8));
  return cleanDriveName(date + " - " + family + " - Invoice " + number);
}

export function invoiceDocumentHtml(invoice) {
  const items = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  const scouts = Array.isArray(invoice.scout_names) ? invoice.scout_names : [];
  const charges = items.filter(item => item.entry_type === "charge").reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
  const credits = items.filter(item => item.entry_type !== "charge").reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
  const rows = items.map(item => {
    const signed = (item.entry_type === "charge" ? 1 : -1) * Number(item.amount_cents || 0);
    return "<tr><td>" + esc(item.occurred_on || "") + "</td><td><strong>" + esc(item.description || "") + "</strong><br><small>" + (item.category ? esc(item.category) : "") + "</small></td><td>" + esc(item.account_name || "") + "</td><td style='text-align:right'>" + (signed < 0 ? "−" : "") + formatDriveMoney(Math.abs(signed)) + "</td></tr>";
  }).join("");
  const scoutLine = scouts.length ? scouts.map(scout => esc(scout.name) + (scout.den ? " — " + esc(scout.den) : "")).join(", ") : "";
  return "<!doctype html><html><head><meta charset='utf-8'><style>body{font-family:Arial,sans-serif;color:#243447;max-width:760px;margin:28px auto}header{display:flex;gap:22px;padding:22px 0;border-top:10px solid #f7c600;border-bottom:3px solid #004b8d}header img{width:110px;height:auto}.brand h1{margin:0;color:#004b8d}.brand p{margin:3px 0;color:#607284}.details{margin-left:auto;text-align:right}.details strong{display:block;color:#004b8d;font-size:24px}.bill{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:24px 0}.bill div:last-child{padding-left:18px;border-left:5px solid #f7c600}.label{color:#607284;font-size:11px;font-weight:bold;text-transform:uppercase}.message{padding:12px 14px;border-left:5px solid #004b8d;background:#f4f8fc}.balance{font-size:24px;color:#004b8d;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #d8e0e8;text-align:left}th{background:#eef3f8}.totals{width:330px;margin:20px 0 0 auto}.totals p{display:flex;justify-content:space-between}.totals .balance{padding-top:12px;border-top:4px solid #f7c600}.payment{margin-top:24px;padding:16px;border-left:6px solid #f7c600;background:#fff8d9}footer{margin-top:30px;padding-top:10px;border-top:2px solid #f7c600;color:#607284;font-size:12px}</style></head><body><header><img src='https://www.pack3963.com/assets/images/cubscoutlogo.png' alt='Pack 3963'><div class='brand'><h1>Cub Scout Pack 3963</h1><p>Pathway to Adventure Council • Scouting America</p><p>c/o Eden United Church of Christ</p><p>5051 W. Gunnison Street • Chicago, IL 60630</p><p>" + esc(invoice.support_email || "cubscouts3963@gmail.com") + " • pack3963.com</p></div><div class='details'><strong>INVOICE</strong><p># " + esc(invoice.invoice_number || "") + "</p><p>Issued: " + esc(invoice.invoice_date || "") + "</p><p>Due: " + esc(invoice.due_date || "") + "</p></div></header><section class='bill'><div><span class='label'>Bill to</span><h2>" + esc(invoice.bill_to || invoice.family_name || "Family account") + "</h2><p>" + esc(invoice.family_name || "") + "</p><p>" + scoutLine + "</p></div><div><span class='label'>Chartered organization</span><h2>Eden United Church of Christ</h2><p>5051 W. Gunnison Street<br>Chicago, IL 60630</p></div></section><p class='message'>" + esc(invoice.body_text || "").replace(/
/g, "<br>") + "</p><table><thead><tr><th>Date</th><th>Description</th><th>Account</th><th style='text-align:right'>Amount</th></tr></thead><tbody>" + rows + "</tbody></table><section class='totals'><p><span>Charges</span><strong>" + formatDriveMoney(charges) + "</strong></p><p><span>Payments / credits</span><strong>−" + formatDriveMoney(credits) + "</strong></p><p class='balance'><span>Balance due</span><strong>" + formatDriveMoney(invoice.balance_cents) + "</strong></p></section><section class='payment'><strong>Payment instructions</strong><p>Pay with cash at a Pack meeting or send Zelle to " + esc(invoice.payment_instructions || "the Pack Treasurer") + " (Kevin Goldsmith, Pack Treasurer). Include the family name and invoice number in the memo.</p></section><footer>Cub Scout Pack 3963 • c/o Eden United Church of Christ • 5051 W. Gunnison Street, Chicago, IL 60630<br>Pathway to Adventure Council • Scouting America</footer></body></html>";
}

function formatDriveMoney(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
}

async function updateInvoiceSync(env, token, invoiceId, values) {
  await sbFetch(env, token, "invoice_documents?id=eq." + invoiceId, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(values)
  });
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function driveFolderName(purchasedOn) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(purchasedOn || ""))) throw new Error("The expense needs a valid purchase date.");
  const date = new Date(String(purchasedOn) + "T12:00:00Z");
  if (Number.isNaN(date.valueOf())) throw new Error("The expense needs a valid purchase date.");
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function driveReceiptFilename(expense, receipt) {
  const original = String(receipt?.original_filename || "receipt");
  const extensionMatch = original.match(/\.[a-zA-Z0-9]{1,8}$/);
  const extension = extensionMatch ? extensionMatch[0].toLowerCase() : extensionForType(receipt?.content_type);
  const vendor = cleanDriveName(expense?.vendor || "Unknown vendor");
  const category = cleanDriveName(expense?.category || expense?.description || "Expense");
  const amount = ((Number(expense?.amount_cents) || 0) / 100).toFixed(2);
  return cleanDriveName(`${expense?.purchased_on || "Undated"} - ${vendor} - ${category} - $${amount}`) + extension;
}

function cleanDriveName(value) {
  return String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").replace(/\s*-\s*-+/g, " - ").trim().slice(0, 180) || "Receipt";
}

function extensionForType(type) {
  return ({ "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" })[type] || ".bin";
}

function publicDriveError(error) {
  const message = String(error?.message || error || "Google Drive synchronization failed.");
  if (/authorization|configured|purchase date|expense|receipt|invoice|Google Drive|10 MB|Supabase/i.test(message)) return message.slice(0, 300);
  return "Google Drive synchronization failed. Try again or reconnect Google Drive.";
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
    const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
    const ids=[...new Set(Array.isArray(p.household_ids)?p.household_ids:[])].filter(uuid).slice(0,100);
    const contactIds=[...new Set(Array.isArray(p.contact_ids)?p.contact_ids:[])].filter(uuid).slice(0,20);
    const entryIds=[...new Set(Array.isArray(p.ledger_entry_ids)?p.ledger_entry_ids:[])].filter(uuid).slice(0,100);
    const mode=p.delivery_mode==="ledger"?"ledger":"bulk";
    const type=p.message_type==="custom"?"custom":"invoice", subject=String(p.subject||"").trim().slice(0,180), body=String(p.body_text||"").trim().slice(0,8000);
    if(!ids.length||!subject||!body) return corsResponse(request,{error:"missing_required_fields"},400);
    if(mode==="ledger"&&(ids.length!==1||!contactIds.length||!entryIds.length||type!=="invoice")) return corsResponse(request,{error:"select_recipients_and_ledger_items"},400);
    const made=await sbFetch(env,token,"email_messages",{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify({message_type:type,subject,body_text:body,status:"sending",sent_by_email:user.email,recipient_count:0})});
    const message=made[0]; let sent=0,failed=0,skipped=0;
    for(const hid of ids) {
      const hs=await sbFetch(env,token,"financial_accounts?select=id,display_name&id=eq."+hid+"&account_type=eq.household&active=eq.true");
      if(!hs.length){skipped++;continue}
      const cs=await sbFetch(env,token,"household_contacts?select=id,full_name,email,relationship,is_primary&household_account_id=eq."+hid+"&active=eq.true&email=not.is.null&order=is_primary.desc");
      const recipients=cs.filter(c=>validEmail(c.email)&&(mode!=="ledger"||contactIds.includes(c.id)));
      if(!recipients.length){skipped+=mode==="ledger"?contactIds.length:1;continue}
      const bs=await sbFetch(env,token,"account_balances?select=id,display_name,balance_cents&or=(id.eq."+hid+",parent_account_id.eq."+hid+")");
      const due=Math.max(0,bs.reduce((n,x)=>n+Number(x.balance_cents||0),0));
      const accountIds=bs.map(x=>x.id).filter(uuid);
      const accountNames=Object.fromEntries(bs.map(x=>[x.id,x.display_name]));
      let activity=[];
      if(type==="invoice"&&accountIds.length) {
        const filter=mode==="ledger"
          ?"id=in.("+entryIds.join(",")+")&account_id=in.("+accountIds.join(",")+")"
          :"voided_at=is.null&account_id=in.("+accountIds.join(",")+")&limit=50";
        activity=(await sbFetch(env,token,"ledger_entries?select=id,account_id,entry_type,amount_cents,occurred_on,description,category&"+filter+"&order=occurred_on.desc")).map(x=>({...x,account_name:accountNames[x.account_id]||"Pack account"}));
      }
      if(mode==="ledger"&&activity.length!==entryIds.length){skipped+=recipients.length;continue}
      for(const c of recipients) {
        let provider=null,rs="failed",err=null;
        try {
          const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:"Bearer "+env.RESEND_API_KEY,"content-type":"application/json","idempotency-key":message.id+":"+hid+":"+c.id},body:JSON.stringify({from:env.FROM_EMAIL,to:[c.email],subject,html:treasurerHtml(c.full_name,hs[0].display_name,subject,body,type==="invoice"?due:null,activity,env.SUPPORT_EMAIL,type==="invoice"?env.ZELLE_PAYMENT_INFO:null,mode),text:treasurerText(c.full_name,hs[0].display_name,body,type==="invoice"?due:null,activity,env.SUPPORT_EMAIL,type==="invoice"?env.ZELLE_PAYMENT_INFO:null,mode),reply_to:env.SUPPORT_EMAIL})});
          const rd=await rr.json(); if(!rr.ok) throw new Error(rd?.message||"Email provider rejected the message");
          provider=rd.id||null;rs="sent";sent++;
        } catch(e){err=String(e.message||e).slice(0,500);failed++}
        await sbFetch(env,token,"email_recipients",{method:"POST",headers:{prefer:"return=minimal"},body:JSON.stringify({message_id:message.id,household_account_id:hid,recipient_name:c.full_name,recipient_email:c.email,provider_message_id:provider,status:rs,error_message:err,sent_at:rs==="sent"?new Date().toISOString():null})});
      }
    }
    const final=sent&&!failed&&!skipped?"sent":sent?"partial":"failed";
    await sbFetch(env,token,"email_messages?id=eq."+message.id,{method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({status:final,recipient_count:sent,sent_at:new Date().toISOString()})});
    return corsResponse(request,{ok:sent>0,message_id:message.id,sent,failed,skipped,status:final},sent>0?200:400);
  } catch(e){console.error(JSON.stringify({event:"treasurer_email_failed",reason:String(e.message||e)}));return corsResponse(request,{error:String(e.message||"Unable to send email")},500)}
}
function fmtMoney(v){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(v)||0)/100)}
function activityAmount(entry){return (entry.entry_type==="charge"?1:-1)*Number(entry.amount_cents||0)}
function treasurerActivityHtml(activity,mode){
  if(!activity?.length)return "";
  const rows=activity.map(x=>"<tr><td style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px'>"+esc(x.occurred_on)+"</td><td style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px'><strong>"+esc(x.description)+"</strong><br><span style='color:#607284'>"+esc(x.account_name)+(x.category?" · "+esc(x.category):"")+"</span></td><td align='right' style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px;font-weight:700;color:"+(activityAmount(x)>0?"#a1122f":"#24633f")+"'>"+(activityAmount(x)>0?"+":"−")+fmtMoney(Math.abs(activityAmount(x)))+"</td></tr>").join("");
  return "<h2 style='color:#004b8d;font-size:19px;margin:24px 0 10px'>"+(mode==="ledger"?"Selected account details":"Recent account activity")+"</h2><table role='presentation' width='100%' cellspacing='0' cellpadding='0' border='0'><tr><th align='left' style='padding:8px;background:#eef3f8;font-size:12px'>DATE</th><th align='left' style='padding:8px;background:#eef3f8;font-size:12px'>DETAIL</th><th align='right' style='padding:8px;background:#eef3f8;font-size:12px'>AMOUNT</th></tr>"+rows+"</table>";
}
function treasurerActivityText(activity,mode){return activity?.length?"

"+(mode==="ledger"?"SELECTED ACCOUNT DETAILS":"RECENT ACCOUNT ACTIVITY")+"
"+activity.map(x=>x.occurred_on+" | "+x.account_name+" | "+x.description+" | "+(activityAmount(x)>0?"+":"-")+fmtMoney(Math.abs(activityAmount(x)))).join("
"):""}
function paymentHtml(zelle){
  if(!zelle)return "";
  return "<div style='margin:22px 0;padding:18px;background:#fff8d9;border-left:5px solid #f7c600;border-radius:7px'><div style='font-size:13px;font-weight:800;color:#004b8d;letter-spacing:.4px'>PAYMENT OPTIONS</div><p style='font-size:15px;line-height:1.55;margin:8px 0 0'>Pay with cash at a Pack meeting or send Zelle to <strong>"+esc(zelle)+"</strong> (Kevin Goldsmith, Pack Treasurer). Include your family name and what the payment covers in the memo.</p></div>";
}
function paymentText(zelle){return zelle?"

PAYMENT OPTIONS
Pay with cash at a Pack meeting or send Zelle to "+zelle+" (Kevin Goldsmith, Pack Treasurer). Include your family name and what the payment covers in the memo.":""}
function emailLogo(){return "<img src='https://www.pack3963.com/assets/images/cubscoutlogo.png' width='170' alt='Cub Scout Pack 3963' style='display:block;width:170px;max-width:100%;height:auto;border:0;margin:0 auto 10px'>"}
function treasurerHtml(contact,family,subject,body,due,activity,support,zelle,mode){
  const ps=String(body).split(/
{2,}/).map(p=>"<p style='font-size:16px;line-height:1.6;margin:0 0 16px'>"+esc(p).replace(/
/g,"<br>")+"</p>").join("");
  const bal=due==null?"":"<div style='margin:20px 0;padding:18px;background:#f4f8fc;border-left:5px solid #d71920;border-radius:7px'><div style='font-size:13px;font-weight:800;color:#526474'>CURRENT FAMILY BALANCE DUE</div><div style='font-size:30px;font-weight:800;color:#004b8d;margin-top:4px'>"+fmtMoney(due)+"</div><div style='font-size:13px;color:#607284;margin-top:4px'>"+esc(family)+"</div></div>";
  return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>"+esc(subject)+"</title></head><body style='margin:0;background:#eef3f8;color:#243447;font-family:Arial,Helvetica,sans-serif'><div style='display:none;max-height:0;overflow:hidden'>Pack 3963 family account details for "+esc(family)+"</div><table width='100%' cellspacing='0' cellpadding='0' role='presentation' style='background:#eef3f8;padding:24px 12px'><tr><td align='center'><table width='100%' cellspacing='0' cellpadding='0' role='presentation' style='max-width:620px;background:#fff;border-radius:15px;overflow:hidden'><tr><td align='center' style='background:#004b8d;padding:22px 30px;border-bottom:8px solid #f7c600;color:#fff'>"+emailLogo()+"<div style='font-size:15px;font-weight:700'>Pack Treasurer</div></td></tr><tr><td style='padding:30px'><div style='color:#d71920;font-size:12px;font-weight:800;letter-spacing:1px'>FAMILY ACCOUNT</div><h1 style='color:#004b8d;font-size:25px;margin:8px 0 18px'>"+esc(subject)+"</h1><p style='font-size:16px;line-height:1.6'>Hello "+esc(contact)+",</p>"+ps+bal+treasurerActivityHtml(activity,mode)+paymentHtml(zelle)+"<p style='font-size:13px;color:#607284;margin-top:24px'>Questions? Reply or contact <a href='mailto:"+esc(support)+"'>"+esc(support)+"</a>.</p></td></tr><tr><td style='background:#003f75;color:#d9ecff;padding:17px 30px;font-size:12px'>Cub Scout Pack 3963 · Chicago, Illinois</td></tr></table></td></tr></table></body></html>"
}
function treasurerText(contact,family,body,due,activity,support,zelle,mode){return "CUB SCOUT PACK 3963

Hello "+contact+",

"+body+(due==null?"":"

Current family balance due for "+family+": "+fmtMoney(due))+treasurerActivityText(activity,mode)+paymentText(zelle)+"

Questions? Contact "+support}

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
function isParentRedirect(redirect) {
  try {
    const path = new URL(redirect || "").pathname;
    return path === "/family-account.html" || path === "/contact-update.html" || path === "/family-account";
  } catch { return false; }
}
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
<tr><td align="center" style="background:#004b8d;padding:22px 32px;border-bottom:8px solid #f7c600;"><img src="https://www.pack3963.com/assets/images/cubscoutlogo.png" width="170" alt="Cub Scout Pack 3963" style="display:block;width:170px;max-width:100%;height:auto;border:0;margin:0 auto 10px;"><div style="color:#d9ecff;font-size:14px;font-weight:700;">Treasurer Portal</div></td></tr>
<tr><td style="padding:34px 32px 18px;"><div style="color:#d71920;font-size:12px;font-weight:800;letter-spacing:1.2px;">${esc(copy[1])}</div>
<h1 style="color:#004b8d;font-size:28px;line-height:1.25;margin:10px 0 14px;">${esc(copy[2])}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 24px;">${esc(copy[3])}</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#f7c600;border-radius:8px;"><a href="${u}" style="display:inline-block;color:#003f75;font-weight:800;font-size:16px;text-decoration:none;padding:15px 22px;">${esc(copy[4])}</a></td></tr></table>
<div style="margin:26px 0 0;padding:16px 18px;background:#f4f8fc;border-left:4px solid #d71920;border-radius:6px;"><div style="font-size:14px;font-weight:700;color:#004b8d;">This link expires at ${e}</div><div style="font-size:13px;color:#526474;margin-top:4px;">That is ${ttl} minutes after this email was sent. The link can be used only for this request.</div></div>
<p style="font-size:13px;line-height:1.5;color:#607284;margin:24px 0 0;">If the button does not work, copy and paste this address into your browser:</p><p style="font-size:12px;line-height:1.5;word-break:break-all;margin:6px 0 0;"><a href="${u}" style="color:#004b8d;">${u}</a></p></td></tr>
<tr><td style="padding:18px 32px 30px;"><p style="font-size:13px;line-height:1.5;color:#607284;margin:0;">If you did not request this email, you can safely ignore it. Questions? Contact <a href="mailto:${s}" style="color:#004b8d;">${s}</a>.</p></td></tr>
<tr><td style="background:#003f75;color:#d9ecff;padding:18px 32px;font-size:12px;">Cub Scout Pack 3963 · Chicago, Illinois</td></tr></table></td></tr></table></body></html>`;
}
function textEmail(copy, link, expiry, ttl, support) {
  return [copy[1] === "PARENT PORTAL" ? "CUB SCOUTS PACK 3963 — PARENT PORTAL" : "CUB SCOUT PACK 3963 — TREASURER PORTAL", "", copy[2], "", copy[3], "", copy[4] + ":", link, "", "This link expires at " + expiry + " (" + ttl + " minutes after this email was sent).", "", "If you did not request this email, you can safely ignore it.", "Questions? Contact " + support].join("\
");
}
