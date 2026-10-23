-- Track the Google Drive mirror for every private Supabase receipt.
-- Existing receipts remain available in Supabase and begin in the pending queue.

alter table public.expense_receipts
  add column if not exists drive_file_id text,
  add column if not exists drive_folder_id text,
  add column if not exists drive_filename text,
  add column if not exists drive_web_view_link text,
  add column if not exists drive_sync_status text not null default 'pending',
  add column if not exists drive_sync_error text,
  add column if not exists drive_last_attempt_at timestamptz,
  add column if not exists drive_synced_at timestamptz;

alter table public.expense_receipts
  drop constraint if exists expense_receipts_drive_sync_status_check;

alter table public.expense_receipts
  add constraint expense_receipts_drive_sync_status_check
  check (drive_sync_status in ('pending', 'syncing', 'synced', 'error'));

create unique index if not exists expense_receipts_drive_file_id_key
  on public.expense_receipts (drive_file_id)
  where drive_file_id is not null;

create index if not exists expense_receipts_drive_sync_queue_idx
  on public.expense_receipts (drive_sync_status, created_at)
  where drive_sync_status in ('pending', 'error');

update public.expense_receipts
set drive_sync_status = 'pending',
    drive_sync_error = null
where drive_file_id is null
  and drive_sync_status <> 'pending';
