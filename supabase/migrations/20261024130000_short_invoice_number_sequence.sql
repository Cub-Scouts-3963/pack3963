-- Allocate short, year-scoped invoice numbers atomically.
-- Existing invoice numbers and stored PDFs remain unchanged.

create schema if not exists private;

create table if not exists private.invoice_number_counters (
  invoice_year integer primary key,
  last_number integer not null check (last_number > 0)
);

revoke all on table private.invoice_number_counters from public, anon, authenticated;

create or replace function public.next_pack_invoice_number()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_email text;
  v_year integer;
  v_next integer;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if auth.uid() is null or not exists (
    select 1 from public.authorized_users
    where email = v_email and active = true and role in ('admin', 'treasurer')
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_year := extract(year from (now() at time zone 'America/Chicago'))::integer;
  insert into private.invoice_number_counters (invoice_year, last_number)
  values (v_year, 1)
  on conflict (invoice_year)
  do update set last_number = private.invoice_number_counters.last_number + 1
  returning last_number into v_next;

  return 'P3963-' || v_year::text || '-' || lpad(v_next::text, 3, '0');
end;
$$;

revoke all on function public.next_pack_invoice_number() from public, anon, authenticated;
grant execute on function public.next_pack_invoice_number() to authenticated;
