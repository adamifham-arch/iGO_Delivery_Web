-- Allow the optional People Manager to assign non-finance staff within their department.
create or replace function public.assign_igo_staff_role(
  p_user_id uuid, p_department_id uuid, p_role text, p_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_assignment_id uuid; v_owner boolean; v_people_manager boolean;
begin
  v_owner := public.is_igo_full_admin() and public.is_igo_superadmin();
  v_people_manager := public.has_staff_role('people_manager',p_department_id);
  if not v_owner and not v_people_manager then
    raise exception 'Only the owner or this department''s People Manager may assign staff';
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

drop policy if exists "People managers view department staff" on public.staff_role_assignments;
create policy "People managers view department staff" on public.staff_role_assignments for select to authenticated
using (public.has_staff_role('people_manager',department_id));
drop policy if exists "People managers view staff profiles" on public.profiles;
create policy "People managers view staff profiles" on public.profiles for select to authenticated
using (
  public.has_staff_role('people_manager')
  and role in ('admin'::public.app_role,'staff'::public.app_role)
);
