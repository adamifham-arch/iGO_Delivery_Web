-- Driver withdrawals use the same finance-review / payment-officer handoff.
alter table public.driver_withdrawal_requests
  add column if not exists rejection_reason text,
  add column if not exists paid_by uuid references auth.users(id),
  add column if not exists payment_slip_path text;

drop policy if exists "Staff review driver withdrawals" on public.driver_withdrawal_requests;
create policy "Staff review driver withdrawals" on public.driver_withdrawal_requests for select to authenticated
using (public.is_igo_full_admin() or requested_by=auth.uid()
  or public.has_staff_role('finance_approver') or public.has_staff_role('payment_officer'));
drop policy if exists "Finance staff review driver withdrawals" on public.driver_withdrawal_requests;
create policy "Finance staff review driver withdrawals" on public.driver_withdrawal_requests for update to authenticated
using (status='pending' and public.has_staff_role('finance_approver'))
with check (status in ('approved','rejected') and public.has_staff_role('finance_approver'));
drop policy if exists "Payment staff complete driver withdrawals" on public.driver_withdrawal_requests;
create policy "Payment staff complete driver withdrawals" on public.driver_withdrawal_requests for update to authenticated
using (status='approved' and public.has_staff_role('payment_officer'))
with check (status='paid' and paid_by=auth.uid() and payment_slip_path is not null
  and nullif(trim(coalesce(paid_reference,'')),'') is not null and public.has_staff_role('payment_officer'));

create or replace function public.guard_driver_withdrawal_review()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if public.is_igo_full_admin() then
    if old.status not in ('pending','approved')
      or (old.status='pending' and new.status not in ('approved','rejected'))
      or (old.status='approved' and new.status<>'paid') then
      raise exception 'Invalid withdrawal status transition';
    end if;
  elsif old.status='pending' and new.status in ('approved','rejected')
    and public.has_staff_role('finance_approver') then
    if (to_jsonb(new) - array['status','reviewed_by','reviewed_at','rejection_reason'])
      is distinct from (to_jsonb(old) - array['status','reviewed_by','reviewed_at','rejection_reason']) then
      raise exception 'Finance reviewers may only decide the withdrawal';
    end if;
    if new.status='rejected' and length(trim(coalesce(new.rejection_reason,'')))<3 then
      raise exception 'Enter a reason for rejecting this withdrawal';
    end if;
    new.reviewed_by:=auth.uid(); new.reviewed_at:=now();
    return new;
  elsif old.status='approved' and new.status='paid'
    and public.has_staff_role('payment_officer') then
    if (to_jsonb(new) - array['status','paid_by','paid_at','paid_reference','payment_slip_path'])
      is distinct from (to_jsonb(old) - array['status','paid_by','paid_at','paid_reference','payment_slip_path']) then
      raise exception 'Payment officers may only record the disbursement';
    end if;
    if nullif(trim(coalesce(new.paid_reference,'')),'') is null or nullif(trim(coalesce(new.payment_slip_path,'')),'') is null then
      raise exception 'Attach the payment slip and enter the payment reference before marking paid';
    end if;
    new.paid_by:=auth.uid(); new.paid_at:=now(); new.reviewed_by:=auth.uid(); new.reviewed_at:=now();
    return new;
  else
    raise exception 'This staff role cannot make that withdrawal change';
  end if;
  if (to_jsonb(new) - array['status','reviewed_by','reviewed_at','paid_at','paid_reference','paid_by','payment_slip_path','rejection_reason'])
    is distinct from (to_jsonb(old) - array['status','reviewed_by','reviewed_at','paid_at','paid_reference','paid_by','payment_slip_path','rejection_reason']) then
    raise exception 'Withdrawal details cannot be changed during review';
  end if;
  new.reviewed_by:=auth.uid(); new.reviewed_at:=now();
  if new.status='paid' then new.paid_by:=auth.uid(); new.paid_at:=now();
  else new.paid_at:=null; new.paid_by:=null; end if;
  return new;
end;
$function$;

create or replace function public.notify_payment_officers_of_work()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op='INSERT' then
    insert into public.notifications(user_id,title,message)
    select distinct s.user_id,'Payment request needs review',
      new.category || ' · MVR ' || new.amount::text || ' · ' || new.description
    from public.staff_role_assignments s
    where s.active and s.role='finance_approver' and s.department_id=new.department_id;
    return new;
  end if;
  if new.status='approved' and old.status is distinct from new.status then
    insert into public.notifications(user_id,title,message)
    select distinct s.user_id,'Payment ready to make',
      new.category || ' · MVR ' || new.amount::text || ' · ' || new.payee_name
    from public.staff_role_assignments s
    where s.active and s.role='payment_officer' and s.department_id=new.department_id;
  end if;
  return new;
end;
$function$;
drop trigger if exists payment_requests_notify_staff on public.payment_requests;
create trigger payment_requests_notify_staff after insert or update of status on public.payment_requests
for each row execute function public.notify_payment_officers_of_work();

create or replace function public.notify_payment_staff_of_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.status='approved' and old.status is distinct from new.status then
    insert into public.notifications(user_id,title,message)
    select distinct s.user_id,'Driver withdrawal ready to pay',
      'Withdrawal · MVR ' || new.amount::text || ' · ' || coalesce((select d.name from public.drivers d where d.id=new.driver_id),'Driver')
    from public.staff_role_assignments s where s.active and s.role='payment_officer';
  end if;
  return new;
end;
$function$;
drop trigger if exists withdrawal_notify_payment_staff on public.driver_withdrawal_requests;
create trigger withdrawal_notify_payment_staff after update of status on public.driver_withdrawal_requests
for each row execute function public.notify_payment_staff_of_withdrawal();
