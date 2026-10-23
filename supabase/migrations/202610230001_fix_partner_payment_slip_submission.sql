-- Allow the current payment form to submit receipts for one or more of the
-- signed-in user's own outstanding invoices. Admins may do this only in their
-- own partner workspace.
create or replace function public.guard_igo_payment_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role;
  v_partner_id uuid;
  v_invoice_ids uuid[];
  v_unique_invoice_count integer;
  v_valid_invoice_count integer;
  v_due_total numeric(12,2);
begin
  v_role := public.current_user_role();

  if tg_op = 'INSERT'
    and v_role in ('partner'::public.app_role, 'admin'::public.app_role) then
    v_partner_id := public.current_partner_id();

    if v_partner_id is null or new.partner_id is distinct from v_partner_id
      or new.status is distinct from 'pending_verification'::public.payment_status
      or new.verified_by is not null or new.verified_at is not null
      or new.rejection_reason is not null then
      raise exception 'Payments can be submitted only for the signed-in user''s partner workspace';
    end if;

    if new.target_invoice_id is not null then
      v_invoice_ids := array[new.target_invoice_id];
    else
      v_invoice_ids := coalesce(new.invoice_ids, '{}'::uuid[]);
    end if;

    if cardinality(v_invoice_ids) = 0 then
      raise exception 'Choose at least one outstanding invoice';
    end if;

    select count(distinct selected.invoice_id)
      into v_unique_invoice_count
      from unnest(v_invoice_ids) as selected(invoice_id);

    if v_unique_invoice_count <> cardinality(v_invoice_ids) then
      raise exception 'An invoice can be included only once';
    end if;

    select count(*), coalesce(sum(greatest(0, i.subtotal - i.paid_amount)), 0)
      into v_valid_invoice_count, v_due_total
      from public.invoices i
      where i.id = any(v_invoice_ids)
        and i.partner_id = v_partner_id
        and i.status in ('unpaid'::public.invoice_status, 'partially_paid'::public.invoice_status);

    if v_valid_invoice_count <> cardinality(v_invoice_ids) then
      raise exception 'Choose only outstanding invoices from your partner workspace';
    end if;

    if new.amount is null or new.amount <= 0 or new.amount > v_due_total then
      raise exception 'Payment must not exceed the selected invoices'' outstanding balance';
    end if;

    if new.target_invoice_id is null then
      new.invoice_ids := v_invoice_ids;
    end if;
    return new;
  elsif tg_op = 'UPDATE' and v_role = 'admin'::public.app_role then
    if old.status is distinct from 'pending_verification'::public.payment_status
      or new.status not in ('confirmed'::public.payment_status,'rejected'::public.payment_status)
      or (to_jsonb(new) - array['status','verified_by','verified_at','rejection_reason','clarification_note'])
        is distinct from
         (to_jsonb(old) - array['status','verified_by','verified_at','rejection_reason','clarification_note']) then
      raise exception 'Admins may only approve or reject a pending payment';
    end if;
    new.verified_by := auth.uid();
    new.verified_at := pg_catalog.now();
    return new;
  end if;

  raise exception 'Only an approved partner or an admin in their partner workspace may submit a payment';
end;
$function$;

-- Keep the existing partner insert policy. This additional policy allows an
-- admin to submit only into the admin's own active partner workspace.
drop policy if exists "Workspace admins submit own pending payments" on public.payments;
create policy "Workspace admins submit own pending payments" on public.payments
  for insert to authenticated
  with check (
    public.current_user_role() = 'admin'::public.app_role
    and public.current_partner_id() is not null
    and partner_id = public.current_partner_id()
  );
