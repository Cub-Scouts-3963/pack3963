-- Make Pack spending reconciliation dependable and expose a complete, admin-only audit trail.

update public.expenses
set affects_pack_balance = true,
    updated_at = now()
where expense_type = 'pack_card'
  and voided_at is null
  and not affects_pack_balance;

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
    and (e.occurred_on > s.as_of_date or (e.occurred_on = s.as_of_date and e.created_at > s.created_at))
),
pack_spending as (
  select coalesce(sum(x.amount_cents), 0)::bigint as amount_cents
  from public.expenses x
  cross join latest_snapshot s
  where x.voided_at is null
    and x.affects_pack_balance
    and (x.purchased_on > s.as_of_date or (x.purchased_on = s.as_of_date and x.created_at > s.created_at))
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

create or replace function private.capture_audit()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  row_data jsonb;
  rid text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  rid := coalesce(row_data ->> 'id', row_data ->> 'email', row_data ->> 'storage_path', '');
  insert into public.audit_log (
    table_name, record_id, action, changed_by, changed_by_email, old_data, new_data
  ) values (
    tg_table_name,
    nullif(rid, ''),
    tg_op,
    auth.uid(),
    nullif(private.current_user_email(), ''),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated using (private.is_admin());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'authorized_users',
    'financial_accounts',
    'household_contacts',
    'ledger_entries',
    'expenses',
    'expense_receipts',
    'bank_balance_snapshots',
    'roster_imports',
    'order_campaigns',
    'order_items',
    'email_messages',
    'email_recipients',
    'financial_categories'
  ] loop
    execute format('drop trigger if exists %I_audit on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function private.capture_audit()',
      table_name,
      table_name
    );
  end loop;
end
$$;

grant select on public.audit_log to authenticated;
