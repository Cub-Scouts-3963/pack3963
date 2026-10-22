-- Track Pack-level cash movement and distinguish family payments from Pack-covered assistance.
alter table public.ledger_entries
  add column if not exists related_charge_id uuid references public.ledger_entries(id) on delete set null,
  add column if not exists affects_pack_balance boolean not null default false;

alter table public.expenses
  add column if not exists affects_pack_balance boolean not null default false;

alter table public.ledger_entries drop constraint ledger_entries_entry_type_check;
alter table public.ledger_entries add constraint ledger_entries_entry_type_check
  check (entry_type = any (array['charge'::text,'payment'::text,'credit'::text,'assistance'::text]));

create index if not exists ledger_entries_related_charge_idx
  on public.ledger_entries (related_charge_id)
  where related_charge_id is not null;
create index if not exists ledger_entries_pack_balance_idx
  on public.ledger_entries (created_at)
  where affects_pack_balance and voided_at is null;
create index if not exists expenses_pack_balance_idx
  on public.expenses (created_at)
  where affects_pack_balance and voided_at is null;

create or replace view public.treasurer_summary
with (security_invoker = true)
as
with latest_snapshot as (
  select balance_cents, as_of_date, created_at
  from public.bank_balance_snapshots
  order by as_of_date desc, created_at desc
  limit 1
),
pack_income as (
  select coalesce(sum(e.amount_cents), 0)::bigint as amount_cents
  from public.ledger_entries e
  cross join latest_snapshot s
  where e.voided_at is null
    and e.affects_pack_balance
    and e.entry_type in ('payment','credit')
    and e.created_at > s.created_at
),
pack_spending as (
  select coalesce(sum(x.amount_cents), 0)::bigint as amount_cents
  from public.expenses x
  cross join latest_snapshot s
  where x.voided_at is null
    and x.affects_pack_balance
    and x.created_at > s.created_at
)
select
  coalesce((select sum(amount_due_cents) from public.account_balances where active), 0)::bigint as total_due_cents,
  coalesce((select sum(credit_cents) from public.account_balances where active), 0)::bigint as total_credit_cents,
  coalesce((select sum(amount_cents) from public.expenses where voided_at is null), 0)::bigint as total_expenses_cents,
  coalesce((select sum(amount_cents) from public.expenses where voided_at is null and expense_type='reimbursement' and status <> 'paid'), 0)::bigint as reimbursements_due_cents,
  (select balance_cents from latest_snapshot) as latest_bank_balance_cents,
  (select as_of_date from latest_snapshot) as latest_bank_balance_date,
  (select created_at from latest_snapshot) as latest_bank_balance_created_at,
  case when exists(select 1 from latest_snapshot)
    then (select balance_cents from latest_snapshot) + (select amount_cents from pack_income) - (select amount_cents from pack_spending)
    else null end as projected_bank_balance_cents,
  coalesce((select amount_cents from pack_income), 0)::bigint as pack_income_since_snapshot_cents,
  coalesce((select amount_cents from pack_spending), 0)::bigint as pack_spending_since_snapshot_cents;

create or replace function public.record_account_settlement(
  p_entry_id uuid,
  p_account_id uuid,
  p_entry_type text,
  p_amount_cents integer,
  p_occurred_on date,
  p_charge_id uuid default null,
  p_payment_method text default null,
  p_reference text default null,
  p_notes text default null,
  p_affects_pack_balance boolean default false
)
returns public.ledger_entries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_row public.account_balances;
  charge_row public.ledger_entries;
  charge_remaining bigint;
  result public.ledger_entries;
begin
  if not private.can_write() then raise exception 'Not authorized to record account activity'; end if;
  if p_entry_type not in ('payment','assistance') then raise exception 'Entry type must be payment or assistance'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Amount must be positive'; end if;

  select * into account_row from public.account_balances where id=p_account_id and active;
  if account_row.id is null then raise exception 'Choose an active account'; end if;

  if p_charge_id is not null then
    select * into charge_row from public.ledger_entries
      where id=p_charge_id and account_id=p_account_id and entry_type='charge' and voided_at is null;
    if charge_row.id is null then raise exception 'The selected charge is not available'; end if;
    select greatest(charge_row.amount_cents - coalesce(sum(amount_cents) filter (where voided_at is null),0),0)
      into charge_remaining
      from public.ledger_entries where related_charge_id=p_charge_id;
  end if;

  if p_entry_type='assistance' then
    if p_charge_id is null then raise exception 'Financial assistance must be applied to a specific charge'; end if;
    if nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Add a note explaining the Pack-covered assistance'; end if;
    if p_amount_cents > least(account_row.amount_due_cents, charge_remaining) then raise exception 'Assistance cannot exceed the remaining balance'; end if;
  elsif p_payment_method not in ('cash','zelle','venmo','check','card','bank_transfer','other') then
    raise exception 'Choose a payment method';
  end if;

  insert into public.ledger_entries (
    id, account_id, entry_type, amount_cents, occurred_on, description, category,
    payment_method, reference, notes, source, related_charge_id, affects_pack_balance
  ) values (
    p_entry_id, p_account_id, p_entry_type, p_amount_cents, p_occurred_on,
    case when p_entry_type='assistance' then 'Pack-covered assistance — ' || charge_row.description
      when p_charge_id is not null then 'Payment — ' || charge_row.description
      else 'Account payment' end,
    charge_row.category,
    case when p_entry_type='payment' then p_payment_method else null end,
    nullif(trim(coalesce(p_reference,'')),''),
    nullif(trim(coalesce(p_notes,'')),''),
    'manual', p_charge_id,
    case when p_entry_type='payment' then p_affects_pack_balance else false end
  )
  returning * into result;
  return result;
end;
$$;

revoke all on function public.record_account_settlement(uuid,uuid,text,integer,date,uuid,text,text,text,boolean) from public, anon;
grant execute on function public.record_account_settlement(uuid,uuid,text,integer,date,uuid,text,text,text,boolean) to authenticated;
comment on function public.record_account_settlement(uuid,uuid,text,integer,date,uuid,text,text,text,boolean)
is 'Records a family payment or Pack-covered assistance with validation and optional Pack balance impact.';