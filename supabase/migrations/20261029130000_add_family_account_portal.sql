-- Provide verified parents and guardians with a narrowly scoped, read-only family account portal.
-- Access is matched from the signed Supabase session email to an active household contact.

create index if not exists household_contacts_portal_email_idx
  on public.household_contacts (lower(email))
  where active and email is not null;

create or replace function public.get_family_account_portal()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  portal_email text;
  household_payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  portal_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  if portal_email = '' then
    raise exception 'The signed-in account does not include an email address.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(family_record.payload order by family_record.family_name), '[]'::jsonb)
  into household_payload
  from (
    select
      household.display_name as family_name,
      jsonb_build_object(
        'id', household.id,
        'name', household.display_name,
        'matched_contact', (
          select jsonb_build_object(
            'name', contact.full_name,
            'email', contact.email,
            'relationship', contact.relationship
          )
          from public.household_contacts contact
          where contact.household_account_id = household.id
            and contact.active
            and lower(trim(contact.email)) = portal_email
          order by contact.is_primary desc, contact.full_name
          limit 1
        ),
        'scouts', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'id', scout.id,
              'name', scout.display_name,
              'den', scout.den,
              'member_id_last4', case
                when nullif(trim(scout.bsa_member_id), '') is null then null
                else right(trim(scout.bsa_member_id), 4)
              end
            ) order by scout.display_name
          ), '[]'::jsonb)
          from public.financial_accounts scout
          where scout.parent_account_id = household.id
            and scout.account_type = 'scout'
            and scout.active
        ),
        'ledger', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'id', entry.id,
              'account_id', account.id,
              'account_name', case
                when account.account_type = 'household' then 'Family-level'
                else account.display_name
              end,
              'entry_type', entry.entry_type,
              'amount_cents', entry.amount_cents,
              'occurred_on', entry.occurred_on,
              'due_on', entry.due_on,
              'description', entry.description,
              'category', entry.category
            ) order by entry.occurred_on, entry.created_at, entry.id
          ), '[]'::jsonb)
          from public.ledger_entries entry
          join public.financial_accounts account on account.id = entry.account_id
          where entry.voided_at is null
            and account.active
            and (
              account.id = household.id
              or account.parent_account_id = household.id
            )
        ),
        'invoices', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'invoice_number', invoice.invoice_number,
              'invoice_date', invoice.invoice_date,
              'due_date', invoice.due_date,
              'subject', invoice.subject,
              'balance_cents', invoice.balance_cents,
              'public_token', invoice.public_token
            ) order by invoice.invoice_date desc, invoice.created_at desc
          ), '[]'::jsonb)
          from public.invoice_documents invoice
          where invoice.household_account_id = household.id
        )
      ) as payload
    from public.financial_accounts household
    where household.account_type = 'household'
      and household.active
      and exists (
        select 1
        from public.household_contacts contact
        where contact.household_account_id = household.id
          and contact.active
          and lower(trim(contact.email)) = portal_email
      )
  ) family_record;

  return jsonb_build_object(
    'email', portal_email,
    'households', household_payload
  );
end;
$$;

revoke all on function public.get_family_account_portal() from public, anon, authenticated, service_role;
grant execute on function public.get_family_account_portal() to authenticated;

comment on function public.get_family_account_portal() is
  'Returns only the active family accounts matched to the verified email in the current Supabase session.';
