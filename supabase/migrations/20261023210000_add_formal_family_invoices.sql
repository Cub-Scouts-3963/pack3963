-- Give each generated family invoice a durable, recipient-safe snapshot and public token.

alter table public.invoice_documents
  alter column message_id drop not null,
  add column if not exists due_date date,
  add column if not exists public_token uuid not null default gen_random_uuid(),
  add column if not exists bill_to text,
  add column if not exists scout_names jsonb not null default '[]'::jsonb,
  add column if not exists payment_instructions text;

update public.invoice_documents
set due_date = invoice_date + 14
where due_date is null;

alter table public.invoice_documents
  alter column due_date set not null;

create unique index if not exists invoice_documents_public_token_key
  on public.invoice_documents (public_token);

-- This narrowly scoped function is intentionally available to an invoice recipient.
-- The unguessable UUID is the sole lookup key, and only immutable invoice fields are returned.
create or replace function public.get_invoice_by_token(p_token uuid)
returns table (
  invoice_number text,
  invoice_date date,
  due_date date,
  family_name text,
  bill_to text,
  scout_names jsonb,
  subject text,
  body_text text,
  balance_cents bigint,
  line_items jsonb,
  support_email text,
  payment_instructions text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    i.invoice_number,
    i.invoice_date,
    i.due_date,
    i.family_name,
    i.bill_to,
    i.scout_names,
    i.subject,
    i.body_text,
    i.balance_cents,
    i.line_items,
    i.support_email,
    i.payment_instructions
  from public.invoice_documents i
  where i.public_token = p_token
  limit 1;
$$;

revoke all on function public.get_invoice_by_token(uuid) from public, authenticated, service_role;
grant execute on function public.get_invoice_by_token(uuid) to anon;

