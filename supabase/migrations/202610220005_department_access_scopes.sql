-- Align people management and finance notifications with the department model.
create or replace function public.assign_igo_staff_role(
  p_user_id uuid, p_department_id uuid, p_role text, p_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_assignment_id uuid; v_owner boolean; v_people_manager boolean;
begin
  v_owner := public.is_igo_full_admin() and public.is_igo_superadmin();
  v_people_manager := public.has_staff_role('people_manager');
  if not v_owner and not v_people_manager then
    raise exception 'Only the owner or a People Manager may assign staff';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'You cannot assign staff access to your own account';
  end if;
  if p_role not in ('department_requester','finance_approver','payment_officer',
    'operations_manager','operations_staff','customer_support','people_manager') then
    raise exception 'Choose a supported staff role';
  end if;
  if v_people_manager and not v_owner and p_role in ('finance_approver','payment_officer','people_manager') then
    raise exception 'Only the owner may assign finance or People Manager privileges';
  end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.active) then
    raise exception 'Choose an active department';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_user_id and p.role in ('admin'::public.app_role,'staff'::public.app_role)) then
    raise exception 'Invite this person as an admin account before assigning staff access';
  end if;
  insert into public.staff_role_assignments(user_id,department_id,role,active,granted_by)
  values(p_user_id,p_department_id,p_role,p_active,auth.uid())
  on conflict(user_id,department_id,role) do update set active=excluded.active,granted_by=auth.uid()
  returning id into v_assignment_id;
  update public.profiles set role='staff'::public.app_role where id=p_user_id;
  return v_assignment_id;
end;
$$;

drop policy if exists "Staff read assigned departments" on public.departments;
create policy "Staff read assigned departments" on public.departments for select to authenticated
using (public.is_igo_full_admin() or public.has_staff_role('people_manager') or exists (
  select 1 from public.staff_role_assignments s
  where s.department_id=departments.id and s.user_id=auth.uid() and s.active
));

drop policy if exists "Staff view relevant payment requests" on public.payment_requests;
create policy "Staff view relevant payment requests" on public.payment_requests for select to authenticated
using (
  public.is_igo_full_admin() or requester_id=auth.uid()
  or public.has_staff_role('finance_approver',department_id)
  or (status in ('approved','paid') and public.has_staff_role('payment_officer',department_id))
);

drop policy if exists "Staff review driver withdrawals" on public.driver_withdrawal_requests;
create policy "Staff review driver withdrawals" on public.driver_withdrawal_requests for select to authenticated
using (
  public.is_igo_full_admin() or requested_by=auth.uid()
  or public.has_staff_role('finance_approver',(select id from public.departments where name='Finance'))
  or public.has_staff_role('payment_officer',(select id from public.departments where name='Finance'))
);

drop policy if exists "Finance staff review driver withdrawals" on public.driver_withdrawal_requests;
create policy "Finance staff review driver withdrawals" on public.driver_withdrawal_requests for update to authenticated
using (status='pending' and public.has_staff_role('finance_approver',(select id from public.departments where name='Finance')))
with check (status in ('approved','rejected') and public.has_staff_role('finance_approver',(select id from public.departments where name='Finance')));
drop policy if exists "Payment staff complete driver withdrawals" on public.driver_withdrawal_requests;
create policy "Payment staff complete driver withdrawals" on public.driver_withdrawal_requests for update to authenticated
using (status='approved' and public.has_staff_role('payment_officer',(select id from public.departments where name='Finance')))
with check (status='paid' and paid_by=auth.uid() and payment_slip_path is not null
  and nullif(trim(coalesce(paid_reference,'')),'') is not null
  and public.has_staff_role('payment_officer',(select id from public.departments where name='Finance')));

drop policy if exists "Department staff read operations packages" on public.packages;
create policy "Department staff read operations packages" on public.packages for select to authenticated
using (
  public.is_igo_full_admin()
  or public.has_staff_role('operations_manager')
  or public.has_staff_role('operations_staff')
  or public.has_staff_role('customer_support')
);

drop policy if exists "Department staff read package status history" on public.package_status_events;
create policy "Department staff read package status history" on public.package_status_events for select to authenticated
using (
  public.is_igo_full_admin()
  or public.has_staff_role('operations_manager')
  or public.has_staff_role('operations_staff')
  or public.has_staff_role('customer_support')
);

create or replace function public.notify_payment_staff_of_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.status='approved' and old.status is distinct from new.status then
    insert into public.notifications(user_id,title,message)
    select distinct s.user_id,'Driver withdrawal ready to pay',
      'Withdrawal · MVR ' || new.amount::text || ' · ' || coalesce((select d.name from public.drivers d where d.id=new.driver_id),'Driver')
    from public.staff_role_assignments s
    join public.departments dep on dep.id=s.department_id and dep.name='Finance'
    where s.active and s.role='payment_officer';
  end if;
  return new;
end;
$function$;
