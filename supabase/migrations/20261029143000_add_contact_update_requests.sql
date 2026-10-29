-- Parent-submitted contact changes are reviewed before they reach Google Contacts.
create table if not exists public.contact_update_requests (
  id uuid primary key default gen_random_uuid(),
  household_account_id uuid not null references public.financial_accounts(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_email text not null,
  proposed_contact jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','needs_info','synced','sync_failed')),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewer_note text,
  reviewed_at timestamptz,
  synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_update_requests_household_idx
  on public.contact_update_requests(household_account_id, status, created_at desc);

alter table public.contact_update_requests enable row level security;

create or replace function public.submit_contact_update_request(proposed jsonb)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  portal_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  household_id uuid;
  request_id uuid;
begin
  if auth.uid() is null or portal_email = '' then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select hc.household_account_id into household_id
  from public.household_contacts hc
  where hc.active
    and lower(trim(hc.email)) = portal_email
  order by hc.is_primary desc, hc.created_at
  limit 1;

  if household_id is null then
    raise exception 'No active family account is linked to this email.' using errcode = '42501';
  end if;

  if jsonb_typeof(proposed) <> 'object'
     or nullif(trim(proposed ->> 'full_name'), '') is null
     or nullif(trim(proposed ->> 'email'), '') is null
     or nullif(trim(proposed ->> 'phone'), '') is null then
    raise exception 'Name, email, and phone are required.' using errcode = '22023';
  end if;

  insert into public.contact_update_requests
    (household_account_id, submitted_by, submitted_email, proposed_contact)
  values
    (household_id, auth.uid(), portal_email, proposed)
  returning id into request_id;

  return request_id;
end;
$$;

revoke all on function public.submit_contact_update_request(jsonb) from public, anon;
grant execute on function public.submit_contact_update_request(jsonb) to authenticated;

create policy contact_update_requests_submit
  on public.contact_update_requests for insert
  to authenticated
  with check (
    submitted_by = (select auth.uid())
    and lower(trim(submitted_email)) = lower(trim(coalesce((select auth.jwt() ->> 'email'), '')))
  );

create policy contact_update_requests_parent_read
  on public.contact_update_requests for select
  to authenticated
  using (submitted_by = (select auth.uid()));

create policy contact_update_requests_leader_read
  on public.contact_update_requests for select
  to authenticated
  using (private.is_authorized());

create policy contact_update_requests_leader_update
  on public.contact_update_requests for update
  to authenticated
  using (private.can_write())
  with check (private.can_write());

grant select, insert on public.contact_update_requests to authenticated;
grant update on public.contact_update_requests to authenticated;
