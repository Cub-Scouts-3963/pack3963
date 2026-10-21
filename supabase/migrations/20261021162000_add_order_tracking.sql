alter table public.ledger_entries add column if not exists due_on date;

create table if not exists public.order_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  description text,
  default_unit_price_cents integer not null default 0 check (default_unit_price_cents >= 0),
  due_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.order_campaigns(id),
  account_id uuid not null references public.financial_accounts(id),
  ordered_for text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  item_variant text,
  notes text,
  source text not null default 'manual',
  source_record_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

alter table public.ledger_entries add column if not exists order_item_id uuid references public.order_items(id);
create index if not exists order_items_campaign_idx on public.order_items(campaign_id);
create index if not exists order_items_account_idx on public.order_items(account_id);
create unique index if not exists order_items_source_record_unique on public.order_items(campaign_id, source_record_id) where source_record_id is not null;
create index if not exists ledger_entries_order_item_idx on public.ledger_entries(order_item_id);

alter table public.order_campaigns enable row level security;
alter table public.order_items enable row level security;
drop policy if exists order_campaigns_read on public.order_campaigns;
create policy order_campaigns_read on public.order_campaigns for select using (private.is_authorized());
drop policy if exists order_campaigns_write on public.order_campaigns;
create policy order_campaigns_write on public.order_campaigns for all using (private.can_write()) with check (private.can_write());
drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select using (private.is_authorized());
drop policy if exists order_items_write on public.order_items;
create policy order_items_write on public.order_items for all using (private.can_write()) with check (private.can_write());

create or replace view public.order_item_balances with (security_invoker=true) as
select oi.id, oi.campaign_id, oc.name as campaign_name, oc.category, oc.due_on,
       oi.account_id, fa.display_name as account_name, fa.account_type, fa.parent_account_id,
       oi.ordered_for, oi.quantity, oi.unit_price_cents,
       oi.quantity * oi.unit_price_cents as total_cents,
       oi.item_variant, oi.notes, oi.active,
       coalesce(sum(case when le.voided_at is null and le.entry_type in ('payment','credit') then le.amount_cents else 0 end),0)::integer as paid_cents,
       greatest(oi.quantity * oi.unit_price_cents - coalesce(sum(case when le.voided_at is null and le.entry_type in ('payment','credit') then le.amount_cents else 0 end),0),0)::integer as amount_due_cents,
       case
         when coalesce(sum(case when le.voided_at is null and le.entry_type in ('payment','credit') then le.amount_cents else 0 end),0) >= oi.quantity * oi.unit_price_cents then 'paid'
         when coalesce(sum(case when le.voided_at is null and le.entry_type in ('payment','credit') then le.amount_cents else 0 end),0) > 0 then 'partial'
         else 'unpaid'
       end as payment_status
from public.order_items oi
join public.order_campaigns oc on oc.id=oi.campaign_id
join public.financial_accounts fa on fa.id=oi.account_id
left join public.ledger_entries le on le.order_item_id=oi.id
group by oi.id,oc.id,fa.id;
grant select on public.order_campaigns, public.order_items, public.order_item_balances to authenticated;
grant insert,update,delete on public.order_campaigns, public.order_items to authenticated;
