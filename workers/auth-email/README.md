# Pack 3963 authentication email Worker

This Cloudflare Worker handles Supabase Auth's **Send Email** HTTP hook and sends the resulting branded messages through Resend.

## Endpoint

- Health check: `GET /health`
- Supabase hook: `POST /hooks/supabase/send-email`
- Production URL: `https://pack3963-auth-email.cubscouts3963.workers.dev/hooks/supabase/send-email`

## Required encrypted secrets

Set these as Cloudflare Worker secrets. Never commit their values.

- `RESEND_API_KEY` — Resend sending-only key restricted to `pack3963.com`
- `SUPABASE_AUTH_HOOK_SECRET` — the full secret generated when the Supabase Send Email HTTP hook is created, including the `v1,whsec_` prefix

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
