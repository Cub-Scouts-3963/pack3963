create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  message_type text not null check (message_type in ('invoice','custom')),
  subject text not null,
  body_text text not null,
  status text not null default 'sending' check (status in ('sending','sent','partial','failed')),
  sent_by uuid default auth.uid(),
  sent_by_email text,
  recipient_count integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.email_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.email_messages(id) on delete cascade,
  household_account_id uuid references public.financial_accounts(id),
  recipient_name text,
  recipient_email text not null,
  provider_message_id text,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_recipients_message_idx on public.email_recipients(message_id);
create index if not exists email_recipients_household_idx on public.email_recipients(household_account_id);
alter table public.email_messages enable row level security;
alter table public.email_recipients enable row level security;
drop policy if exists email_messages_read on public.email_messages;
create policy email_messages_read on public.email_messages for select using (private.is_authorized());
drop policy if exists email_messages_write on public.email_messages;
create policy email_messages_write on public.email_messages for all using (private.can_write()) with check (private.can_write());
drop policy if exists email_recipients_read on public.email_recipients;
create policy email_recipients_read on public.email_recipients for select using (private.is_authorized());
drop policy if exists email_recipients_write on public.email_recipients;
create policy email_recipients_write on public.email_recipients for all using (private.can_write()) with check (private.can_write());
grant select,insert,update on public.email_messages, public.email_recipients to authenticated;
