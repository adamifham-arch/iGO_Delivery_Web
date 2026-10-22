-- Notify finance staff about new driver withdrawals and keep payment proof private.
create or replace function public.notify_finance_staff_of_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.notifications(user_id,title,message)
  select distinct s.user_id,'Driver withdrawal request',
    'A driver requested MVR ' || new.amount::text || ' for review.'
  from public.staff_role_assignments s
  join public.departments d on d.id=s.department_id and d.name='Finance'
  where s.active and s.role='finance_approver';
  return new;
end;
$function$;
drop trigger if exists withdrawal_notify_finance_staff on public.driver_withdrawal_requests;
create trigger withdrawal_notify_finance_staff after insert on public.driver_withdrawal_requests
for each row execute function public.notify_finance_staff_of_withdrawal();

drop policy if exists "Payment staff read payment proofs" on storage.objects;
create policy "Payment staff read payment proofs" on storage.objects for select to authenticated
using (
  bucket_id='payment-proofs'
  and (
    public.is_igo_full_admin()
    or exists (
      select 1 from public.payment_requests r
      where r.id::text=split_part(name,'/',2)
        and (r.requester_id=auth.uid()
          or public.has_staff_role('finance_approver',r.department_id)
          or (r.status in ('approved','paid') and public.has_staff_role('payment_officer',r.department_id)))
    )
    or exists (
      select 1 from public.driver_withdrawal_requests w
      where w.id::text=split_part(name,'/',2)
        and (w.requested_by=auth.uid()
          or public.has_staff_role('finance_approver',(select id from public.departments where name='Finance'))
          or public.has_staff_role('payment_officer',(select id from public.departments where name='Finance')))
    )
  )
);
drop policy if exists "Payment staff upload payment proofs" on storage.objects;
create policy "Payment staff upload payment proofs" on storage.objects for insert to authenticated
with check (
  bucket_id='payment-proofs'
  and split_part(name,'/',1)=auth.uid()::text
  and (
    public.is_igo_full_admin()
    or public.has_staff_role('payment_officer')
  )
);
