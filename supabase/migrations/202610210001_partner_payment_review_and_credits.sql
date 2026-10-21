-- Batch partner payments, partial approvals, overpayment credit, and itemized receipts.
alter table public.payments
  add column if not exists invoice_ids uuid[] not null default '{}',
  add column if not exists verified_amount numeric(12,2);

update public.payments
set invoice_ids = array[target_invoice_id]
where cardinality(invoice_ids) = 0 and target_invoice_id is not null;

update public.payments
set verified_amount = amount
where status = 'confirmed'::public.payment_status and verified_amount is null;

create table if not exists public.partner_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  entry_type text not null check (entry_type in ('payment_overage','invoice_application')),
  amount numeric(12,2) not null check (amount <> 0),
  created_at timestamptz not null default now()
);
create unique index if not exists partner_credit_payment_overage_once
  on public.partner_credit_ledger(payment_id) where entry_type = 'payment_overage';
create unique index if not exists partner_credit_invoice_application_once
  on public.partner_credit_ledger(invoice_id) where entry_type = 'invoice_application';
alter table public.partner_credit_ledger enable row level security;
drop policy if exists "Partners and admins view partner credit" on public.partner_credit_ledger;
create policy "Partners and admins view partner credit" on public.partner_credit_ledger
  for select to authenticated using (
    partner_id = public.current_partner_id()
    or public.current_user_role() = 'admin'::public.app_role
  );
revoke insert, update, delete on public.partner_credit_ledger from anon, authenticated;
grant select on public.partner_credit_ledger to authenticated;

create or replace function public.guard_igo_payment_review()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_role public.app_role;
  v_partner_id uuid;
  v_valid_count integer;
begin
  v_role := public.current_user_role();
  if tg_op = 'INSERT' and v_role = 'partner'::public.app_role then
    v_partner_id := public.current_partner_id();
    if v_partner_id is null
      or new.partner_id is distinct from v_partner_id
      or new.status is distinct from 'pending_verification'::public.payment_status
      or new.verified_by is not null
      or new.verified_at is not null
      or new.rejection_reason is not null
      or new.verified_amount is not null then
      raise exception 'Partners may submit only their own payment for admin review';
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
      and i.status in ('unpaid'::public.invoice_status,'partially_paid'::public.invoice_status)
      and i.subtotal > i.paid_amount;
    if v_valid_count <> cardinality(new.invoice_ids) then
      raise exception 'Every selected invoice must belong to you and have a balance due';
    end if;
    return new;
  elsif tg_op = 'UPDATE' and v_role = 'admin'::public.app_role then
    if old.status is distinct from 'pending_verification'::public.payment_status
      or new.status not in ('confirmed'::public.payment_status,'rejected'::public.payment_status)
      or (to_jsonb(new) - array['status','verified_by','verified_at','verified_amount','rejection_reason','clarification_note'])
        is distinct from
         (to_jsonb(old) - array['status','verified_by','verified_at','verified_amount','rejection_reason','clarification_note']) then
      raise exception 'Admins may only review a pending payment';
    end if;
    if new.status = 'rejected'::public.payment_status
      and coalesce(pg_catalog.btrim(new.rejection_reason),'') = '' then
      raise exception 'Enter a reason for rejecting this payment';
    end if;
    if new.status = 'confirmed'::public.payment_status
      and (new.verified_amount is null or new.verified_amount <= 0 or new.verified_amount > old.amount) then
      raise exception 'Enter the amount received, up to the amount reported by the partner';
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
  raise exception 'Only an approved partner may submit payments and only admins may review them';
end;
$function$;

create or replace function public.allocate_confirmed_payment()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_remaining numeric(12,2);
  v_due numeric(12,2);
  v_apply numeric(12,2);
  v_invoice record;
begin
  if new.status = 'confirmed'::public.payment_status
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    v_remaining := new.verified_amount;
    for v_invoice in
      select i.id, i.subtotal, i.paid_amount
      from public.invoices i
      where i.partner_id = new.partner_id
        and i.id = any(new.invoice_ids)
        and i.status in ('unpaid'::public.invoice_status,'partially_paid'::public.invoice_status)
      order by pg_catalog.array_position(new.invoice_ids, i.id), i.created_at, i.id
      for update
    loop
      exit when v_remaining <= 0;
      v_due := greatest(0, v_invoice.subtotal - v_invoice.paid_amount);
      v_apply := least(v_remaining, v_due);
      if v_apply > 0 then
        insert into public.payment_allocations(payment_id, invoice_id, amount)
        values (new.id, v_invoice.id, v_apply);
        update public.invoices
        set paid_amount = paid_amount + v_apply,
            status = case
              when paid_amount + v_apply >= subtotal then 'paid'::public.invoice_status
              else 'partially_paid'::public.invoice_status
            end
        where id = v_invoice.id;
        v_remaining := v_remaining - v_apply;
      end if;
    end loop;
    if v_remaining > 0 then
      insert into public.partner_credit_ledger(partner_id,payment_id,entry_type,amount)
      values (new.partner_id,new.id,'payment_overage',v_remaining);
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.review_partner_payment(
  p_payment_id uuid,
  p_status text,
  p_verified_amount numeric default null,
  p_rejection_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_payment public.payments%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only admins may review partner payments';
  end if;
  if p_status not in ('confirmed','rejected') then
    raise exception 'Choose approve or reject';
  end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status is distinct from 'pending_verification'::public.payment_status then
    raise exception 'This payment is no longer awaiting review';
  end if;
  if p_status = 'rejected' then
    if coalesce(pg_catalog.btrim(p_rejection_reason),'') = '' then
      raise exception 'Enter a reason for rejecting this payment';
    end if;
    update public.payments
    set status = 'rejected'::public.payment_status,
        rejection_reason = pg_catalog.btrim(p_rejection_reason),
        verified_amount = null,
        verified_by = auth.uid(),
        verified_at = pg_catalog.now()
    where id = p_payment_id;
  else
    if p_verified_amount is null or p_verified_amount <= 0 or p_verified_amount > v_payment.amount then
      raise exception 'Verified amount must be above zero and no greater than the amount submitted';
    end if;
    update public.payments
    set status = 'confirmed'::public.payment_status,
        rejection_reason = null,
        verified_amount = p_verified_amount,
        verified_by = auth.uid(),
        verified_at = pg_catalog.now()
    where id = p_payment_id;
  end if;
  return jsonb_build_object('payment_id',p_payment_id,'status',p_status);
end;
$function$;
revoke all on function public.review_partner_payment(uuid,text,numeric,text) from public, anon;
grant execute on function public.review_partner_payment(uuid,text,numeric,text) to authenticated;

create or replace function public.apply_partner_credit_to_new_invoice()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_balance numeric(12,2);
  v_apply numeric(12,2);
begin
  perform 1 from public.partners where id = new.partner_id for update;
  select coalesce(sum(amount),0) into v_balance
  from public.partner_credit_ledger where partner_id = new.partner_id;
  v_apply := least(greatest(0,new.subtotal - new.paid_amount),greatest(0,v_balance));
  if v_apply > 0 then
    update public.invoices
    set paid_amount = paid_amount + v_apply,
        status = case
          when paid_amount + v_apply >= subtotal then 'paid'::public.invoice_status
          else 'partially_paid'::public.invoice_status
        end
    where id = new.id;
    insert into public.partner_credit_ledger(partner_id,invoice_id,entry_type,amount)
    values (new.partner_id,new.id,'invoice_application',-v_apply);
  end if;
  return new;
end;
$function$;
drop trigger if exists invoices_apply_partner_credit on public.invoices;
create trigger invoices_apply_partner_credit after insert on public.invoices
  for each row execute function public.apply_partner_credit_to_new_invoice();

create or replace function public.notify_payment_status_change()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_invoice_numbers text;
  v_credit numeric(12,2);
  v_due numeric(12,2);
begin
  if new.status is distinct from old.status then
    select p.owner_id into v_owner from public.partners p where p.id = new.partner_id;
    if v_owner is null then return new; end if;
    select pg_catalog.string_agg(i.invoice_number, ', ' order by i.created_at, i.id)
      into v_invoice_numbers
    from public.invoices i where i.id = any(new.invoice_ids);
    if new.status = 'confirmed'::public.payment_status then
      select coalesce(sum(amount),0) into v_credit
      from public.partner_credit_ledger where partner_id = new.partner_id;
      select coalesce(sum(greatest(0,subtotal-paid_amount)),0) into v_due
      from public.invoices where id = any(new.invoice_ids);
      insert into public.notifications(user_id,title,message)
      values (v_owner,'Payment approved',
        'Payment receipt for ' || coalesce(v_invoice_numbers,'your invoices') ||
        ' · MVR ' || new.verified_amount::text || ' received · MVR ' ||
        v_due::text || ' still due · MVR ' || v_credit::text || ' available credit.');
    else
      insert into public.notifications(user_id,title,message)
      values (v_owner,'Payment needs attention',
        'Payment for ' || coalesce(v_invoice_numbers,'your invoices') ||
        ' was rejected. ' || coalesce(nullif(pg_catalog.btrim(new.rejection_reason),''),'Contact iGO support for details.'));
    end if;
  end if;
  return new;
end;
$function$;
