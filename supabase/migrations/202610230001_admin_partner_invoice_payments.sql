-- Allow admins to pay invoices for their own approved partner workspace.
-- Keep payment review admin-only and constrain every insert to the caller's
-- linked partner profile; the existing payment trigger validates invoice IDs.

drop policy if exists "Admins submit payments for own partner workspace" on public.payments;
create policy "Admins submit payments for own partner workspace" on public.payments
  for insert to authenticated
  with check (
    public.current_user_role() = 'admin'::public.app_role
    and partner_id = public.current_partner_id()
    and status = 'pending_verification'::public.payment_status
    and verified_by is null
    and verified_at is null
    and verified_amount is null
    and rejection_reason is null
  );

create or replace function public.guard_igo_payment_review()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_role public.app_role;
  v_partner_id uuid;
  v_valid_count integer;
begin
  v_role := public.current_user_role();

  if tg_op = 'INSERT'
     and v_role in ('partner'::public.app_role, 'admin'::public.app_role) then
    -- current_partner_id() returns only the caller's own approved partner
    -- profile for both partner and admin accounts.
    v_partner_id := public.current_partner_id();
    if v_partner_id is null
      or new.partner_id is distinct from v_partner_id
      or new.status is distinct from 'pending_verification'::public.payment_status
      or new.verified_by is not null
      or new.verified_at is not null
      or new.rejection_reason is not null
      or new.verified_amount is not null then
      raise exception 'Payments can be submitted only for your own approved partner workspace';
    end if;

    if cardinality(new.invoice_ids) = 0 and new.target_invoice_id is not null then
      new.invoice_ids := array[new.target_invoice_id];
    end if;
    if cardinality(new.invoice_ids) = 0 or new.amount <= 0 then
      raise exception 'Choose at least one invoice and enter the amount paid';
    end if;

    select count(*) into v_valid_count
    from public.invoices i
    where i.id = any(new.invoice_ids)
      and i.partner_id = v_partner_id
      and i.status in ('unpaid'::public.invoice_status, 'partially_paid'::public.invoice_status)
      and i.subtotal > i.paid_amount;
    if v_valid_count <> cardinality(new.invoice_ids) then
      raise exception 'Every selected invoice must belong to your partner workspace and have a balance due';
    end if;
    return new;
  elsif tg_op = 'UPDATE' and v_role = 'admin'::public.app_role then
    if old.status is distinct from 'pending_verification'::public.payment_status
      or new.status not in ('confirmed'::public.payment_status, 'rejected'::public.payment_status)
      or (to_jsonb(new) - array['status','verified_by','verified_at','verified_amount','rejection_reason','clarification_note'])
        is distinct from
         (to_jsonb(old) - array['status','verified_by','verified_at','verified_amount','rejection_reason','clarification_note']) then
      raise exception 'Admins may only review a pending payment';
    end if;
    if new.status = 'rejected'::public.payment_status
      and coalesce(pg_catalog.btrim(new.rejection_reason), '') = '' then
      raise exception 'Enter a reason for rejecting this payment';
    end if;
    if new.status = 'confirmed'::public.payment_status
      and (new.verified_amount is null or new.verified_amount <= 0 or new.verified_amount > old.amount) then
      raise exception 'Enter the amount received, up to the amount submitted';
    end if;
    if new.status = 'rejected'::public.payment_status then
      new.verified_amount := null;
    else
      new.rejection_reason := null;
    end if;
    new.verified_by := auth.uid();
    new.verified_at := pg_catalog.now();
    return new;
  end if;

  raise exception 'Only approved partners or admins paying from their own approved partner workspace may submit; only admins may review payments';
end;
$function$;

drop trigger if exists payments_guard_review on public.payments;
create trigger payments_guard_review before insert or update on public.payments
  for each row execute function public.guard_igo_payment_review();
