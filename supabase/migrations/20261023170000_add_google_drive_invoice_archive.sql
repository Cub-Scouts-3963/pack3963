-- Archive generated family invoices in Google Drive while keeping a durable Supabase audit record.

create table if not exists public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.email_messages(id) on delete cascade,
  household_account_id uuid not null references public.financial_accounts(id),
  invoice_number text not null unique,
  invoice_date date not null,
  family_name text not null,
  subject text not null,
  body_text text not null,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  line_items jsonb not null default '[]'::jsonb check (jsonb_typeof(line_items) = 'array'),
  support_email text,
  drive_file_id text,
  drive_folder_id text,
  drive_filename text,
  drive_web_view_link text,
  drive_sync_status text not null default 'pending'
    check (drive_sync_status in ('pending', 'syncing', 'synced', 'error')),
  drive_sync_error text,
  drive_last_attempt_at timestamptz,
  drive_synced_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (message_id, household_account_id)
);

create unique index if not exists invoice_documents_drive_file_id_key
  on public.invoice_documents (drive_file_id)
  where drive_file_id is not null;

create index if not exists invoice_documents_drive_sync_queue_idx
  on public.invoice_documents (drive_sync_status, created_at)
  where drive_sync_status in ('pending', 'error');

create index if not exists invoice_documents_household_idx
  on public.invoice_documents (household_account_id);

alter table public.invoice_documents enable row level security;

drop policy if exists invoice_documents_read on public.invoice_documents;
create policy invoice_documents_read on public.invoice_documents
  for select to authenticated
  using (private.is_authorized());

drop policy if exists invoice_documents_insert on public.invoice_documents;
create policy invoice_documents_insert on public.invoice_documents
  for insert to authenticated
  with check (private.can_write());

drop policy if exists invoice_documents_update on public.invoice_documents;
create policy invoice_documents_update on public.invoice_documents
  for update to authenticated
  using (private.can_write())
  with check (private.can_write());

grant select, insert, update on public.invoice_documents to authenticated;

drop trigger if exists invoice_documents_audit on public.invoice_documents;
create trigger invoice_documents_audit
  after insert or update or delete on public.invoice_documents
  for each row execute function private.capture_audit();
