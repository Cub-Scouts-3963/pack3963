# Pack 3963 authentication email Worker

This Cloudflare Worker handles Supabase Auth's **Send Email** HTTP hook and sends the resulting branded messages through Resend.

## Endpoint

- Health check: `GET /health`
- Supabase hook: `POST /hooks/supabase/send-email`
- Production URL: `https://pack3963-auth-email.cubscouts3963.workers.dev/hooks/supabase/send-email`
- Admin invitations: `POST /api/treasurer/invite-user` (authenticated administrator only)
- Google Drive receipt sync: `POST /api/treasurer/receipt-drive-sync` (authenticated administrator or treasurer only)

## Treasury receipt archive

The receipt-sync endpoint mirrors the private `pack-receipts` Supabase object into the Pack-owned `2026 - 2027 Scouting Season` Google Drive folder. It keeps the Supabase object as the portal fallback and records the Drive file ID, generated filename, month folder, status, and timestamps on `expense_receipts`.

Month folders are based on the expense's `purchased_on` date—not the upload date. Files use the format `YYYY-MM-DD - Vendor - Category - $0.00.ext`. Editing an expense synchronizes its existing Drive file, including moving it to the correct month folder. Missing/deleted Drive copies are recreated from the private Supabase copy. Duplicate generated names receive a numeric suffix.

The portal includes **Organize receipts in Google Drive** for migrating pending or failed receipts in batches of 25. Every receipt-row change is captured by the treasury audit trigger.

## Portal invitations

In **Access**, **Save access & send invitation** saves the user's approved role and sends a welcome email. **Resend invitation** sends the same guide to an existing active user. The email includes their saved role, dashboard guide, confidentiality reminder, Pack support address, and a link to `https://www.pack3963.com/treasurer.html`.

The invitation opens the portal; it is not an authentication token. Recipients enter their invited email address and request their own one-time sign-in email. This works for new and existing Supabase accounts, without creating a password or an expiring welcome link.

The endpoint verifies the caller with Supabase Auth, requires a current active admin row, and reads the recipient and role from `authorized_users` using that caller's JWT and RLS. It does not grant access. It rejects inactive recipients, limits body size, and passes a stable retry key to Resend. A successful response means Resend accepted the email, not that inbox delivery is guaranteed. If sending fails, access remains saved and the admin sees a retry message.

The canonical Worker is `cloudflare/pack3963-auth-email/worker.js`; `wrangler.jsonc` points there so deployment includes the authentication hook, family emails, and invitation endpoint. The old `src/index.js` re-exports it for compatibility.

Run `node --test scripts/treasury-invitations.test.mjs` from the repository root. Tests mock all external calls and send no real email. Deploy the Worker using `workers/auth-email/wrangler.jsonc` before publishing the updated portal. Preserve the existing secrets and variables. No database migration is required for invitations.

## Required encrypted secrets

Set these as Cloudflare Worker secrets. Never commit their values.

- `RESEND_API_KEY` — Resend sending-only key restricted to `pack3963.com`
- `SUPABASE_AUTH_HOOK_SECRET` — the full secret generated when the Supabase Send Email HTTP hook is created, including the `v1,whsec_` prefix
- `GOOGLE_CLIENT_ID` — OAuth web application client ID for the Pack Google Cloud project
- `GOOGLE_CLIENT_SECRET` — OAuth web application client secret
- `GOOGLE_REFRESH_TOKEN` — offline OAuth refresh token granted by `cubscouts3963@gmail.com` with Drive file access

`GOOGLE_DRIVE_ROOT_FOLDER_ID` is non-secret configuration in `wrangler.jsonc`. Google OAuth values must remain encrypted Worker secrets.

## Supabase activation

In the Pack 3963 Supabase project:

1. Open **Authentication → Hooks**.
2. Create a **Send Email** hook using the HTTPS option.
3. Enter the production hook URL above.
4. Generate and save the webhook secret.
5. Replace the Worker's `SUPABASE_AUTH_HOOK_SECRET` encrypted binding with that exact value.
6. Request a test sign-in link and verify delivery, wording, expiration time, and redirect before relying on the hook.

Supabase uses the hook instead of SMTP after it is enabled. If the hook is disabled, the current SMTP configuration remains the fallback.

## Message behavior

The Worker:

- verifies Standard Webhooks signatures and rejects stale or oversized requests;
- sends through `Cub Scout Pack 3963 <portal@pack3963.com>`;
- provides HTML and plain-text versions;
- displays the one-hour expiration in America/Chicago time;
- supports sign-in, signup, invitation, password recovery, email change, and reauthentication actions;
- avoids logging email addresses, links, tokens, or secrets;
- handles Supabase secure email-change token/hash mapping.
