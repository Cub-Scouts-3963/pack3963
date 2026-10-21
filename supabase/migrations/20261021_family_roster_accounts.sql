-- Family accounts and annual roster support for the private Pack 3963 Treasurer Portal.
-- Roster member names and contact data are intentionally not stored in source control.

create table if not exists public.roster_imports (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  roster_date date not null,
  scout_count integer not null check (scout_count >= 0),
  household_count integer not null check (household_count >= 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

alter table public.roster_imports enable row level security;

alter table public.financial_accounts
  add column if not exists parent_account_id uuid references public.financial_accounts(id) on delete set null,
  add column if not exists roster_key text,
  add column if not exists roster_managed boolean not null default false,
  add column if not exists last_seen_roster_on date,
  add column if not exists last_roster_import_id uuid references public.roster_imports(id) on delete set null;

create table if not exists public.household_contacts (
  id uuid primary key default gen_random_uuid(),
  household_account_id uuid not null references public.financial_accounts(id) on delete cascade,
  full_name text not null,
  email text,
  relationship text,
  is_primary boolean not null default false,
  source text not null default 'manual' check (source in ('manual','roster','google_contacts')),
  google_contact_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

alter table public.household_contacts enable row level security;

create policy roster_imports_select on public.roster_imports
  for select to authenticated using (private.is_authorized());
create policy roster_imports_insert on public.roster_imports
  for insert to authenticated with check (private.can_write());
create policy household_contacts_select on public.household_contacts
  for select to authenticated using (private.is_authorized());
create policy household_contacts_insert on public.household_contacts
  for insert to authenticated with check (private.can_write());
create policy household_contacts_update on public.household_contacts
  for update to authenticated using (private.can_write()) with check (private.can_write());

create unique index if not exists financial_accounts_roster_key_uidx
  on public.financial_accounts(roster_key);
create index if not exists financial_accounts_parent_account_idx
  on public.financial_accounts(parent_account_id);
create index if not exists financial_accounts_last_roster_import_idx
  on public.financial_accounts(last_roster_import_id);
create unique index if not exists household_contacts_name_uidx
  on public.household_contacts(household_account_id, lower(full_name));

grant select, insert on public.roster_imports to authenticated;
grant select, insert, update on public.household_contacts to authenticated;

create or replace view public.account_balances
with (security_invoker = true)
as
select
  a.id, a.account_type, a.display_name, a.scout_first_name, a.scout_last_name,
  a.household_name, a.den, a.bsa_member_id, a.scoutbook_user_id, a.contact_email, a.active,
  coalesce(sum(case when e.voided_at is not null then 0 when e.entry_type = 'charge' then e.amount_cents else -e.amount_cents end), 0::bigint) as balance_cents,
  greatest(coalesce(sum(case when e.voided_at is not null then 0 when e.entry_type = 'charge' then e.amount_cents else -e.amount_cents end), 0::bigint), 0::bigint) as amount_due_cents,
  greatest(-coalesce(sum(case when e.voided_at is not null then 0 when e.entry_type = 'charge' then e.amount_cents else -e.amount_cents end), 0::bigint), 0::bigint) as credit_cents,
  max(e.occurred_on) filter (where e.voided_at is null) as last_activity_on,
  a.notes, a.parent_account_id, a.roster_key, a.roster_managed,
  a.last_seen_roster_on, a.last_roster_import_id
from public.financial_accounts a
left join public.ledger_entries e on e.account_id = a.id
group by a.id;

grant select on public.account_balances to authenticated;
