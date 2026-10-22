-- Preset, editable financial categories used throughout the treasurer portal.
create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  use_for_transactions boolean not null default false,
  use_for_expenses boolean not null default false,
  use_for_orders boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create unique index if not exists financial_categories_name_lower_idx
  on public.financial_categories ((lower(trim(name))));

alter table public.financial_categories enable row level security;

create policy "Authorized users can read financial categories"
  on public.financial_categories for select to authenticated
  using (private.is_authorized());
create policy "Writers can add financial categories"
  on public.financial_categories for insert to authenticated
  with check (private.can_write());
create policy "Writers can update financial categories"
  on public.financial_categories for update to authenticated
  using (private.can_write()) with check (private.can_write());

revoke all on public.financial_categories from anon;
grant select, insert, update on public.financial_categories to authenticated;

insert into public.financial_categories
  (name, use_for_transactions, use_for_expenses, use_for_orders, sort_order)
values
  ('Pack fees', true, false, false, 10),
  ('Camping', true, true, true, 20),
  ('T-shirt', true, true, true, 30),
  ('Activities & outings', true, true, true, 40),
  ('Fundraising', true, true, true, 50),
  ('Awards & advancement', false, true, false, 60),
  ('Scout Store', false, true, false, 70),
  ('Supplies', false, true, false, 80),
  ('Equipment', false, true, false, 90),
  ('Food', false, true, true, 100),
  ('Reimbursement', false, true, false, 110),
  ('Other', true, true, true, 999)
on conflict ((lower(trim(name)))) do update set
  use_for_transactions = excluded.use_for_transactions,
  use_for_expenses = excluded.use_for_expenses,
  use_for_orders = excluded.use_for_orders,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Normalize the two fee labels created during initial setup.
update public.ledger_entries
set category = 'Pack fees', updated_at = now()
where lower(trim(coalesce(category, ''))) in ('dues', '2026-27 pack fees');

create or replace function public.rename_financial_category(p_category_id uuid, p_new_name text)
returns public.financial_categories
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_name text;
  cleaned_name text := trim(p_new_name);
  result public.financial_categories;
begin
  if not private.can_write() then raise exception 'Not authorized to manage financial categories'; end if;
  if char_length(cleaned_name) < 1 or char_length(cleaned_name) > 80 then
    raise exception 'Category names must be between 1 and 80 characters';
  end if;

  select name into old_name
  from public.financial_categories
  where id = p_category_id
  for update;
  if old_name is null then raise exception 'Category not found'; end if;

  update public.ledger_entries set category = cleaned_name, updated_at = now()
    where lower(trim(coalesce(category, ''))) = lower(trim(old_name));
  update public.expenses set category = cleaned_name, updated_at = now()
    where lower(trim(coalesce(category, ''))) = lower(trim(old_name));
  update public.order_campaigns set category = cleaned_name, updated_at = now()
    where lower(trim(coalesce(category, ''))) = lower(trim(old_name));

  update public.financial_categories
  set name = cleaned_name, updated_at = now()
  where id = p_category_id
  returning * into result;
  return result;
end;
$$;

revoke all on function public.rename_financial_category(uuid, text) from public, anon;
grant execute on function public.rename_financial_category(uuid, text) to authenticated;

comment on table public.financial_categories is
  'Editable preset categories for treasurer charges, expenses, and orders.';
comment on function public.rename_financial_category(uuid, text) is
  'Renames a category and updates matching historical records in one transaction.';