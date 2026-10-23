-- Permit company-wide staff roles without requiring a department.
-- Payment requesters still need a department because each request belongs to one.
alter table public.staff_role_assignments
  alter column department_id drop not null;

alter table public.staff_role_assignments
  drop constraint if exists staff_role_assignments_user_id_department_id_role_key;

create unique index if not exists staff_role_assignments_user_department_role_unique
  on public.staff_role_assignments(user_id, department_id, role)
  where department_id is not null;

create unique index if not exists staff_role_assignments_user_company_role_unique
  on public.staff_role_assignments(user_id, role)
  where department_id is null;

create or replace function public.has_staff_role(p_role text, p_department_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_role_assignments s
    where s.user_id = auth.uid()
      and s.active
      and s.role = p_role
      and (
        p_department_id is null
        or s.department_id is null
        or s.department_id = p_department_id
      )
  );
$$;

create or replace function public.assign_igo_staff_role(
  p_user_id uuid,
  p_department_id uuid,
  p_role text,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_owner boolean;
  v_people_manager boolean;
begin
  v_owner := public.is_igo_full_admin() and public.is_igo_superadmin();
  v_people_manager := public.has_staff_role('people_manager');

  if not v_owner and not v_people_manager then
    raise exception 'Only the owner or a People Manager may assign staff';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'You cannot assign staff access to your own account';
  end if;
  if p_role not in (
    'department_requester','finance_approver','payment_officer',
    'operations_manager','operations_staff','customer_support','people_manager'
  ) then
    raise exception 'Choose a supported staff role';
  end if;
  if v_people_manager and not v_owner and p_role in ('finance_approver','payment_officer','people_manager') then
    raise exception 'Only the owner may assign finance or People Manager privileges';
  end if;
  if p_role = 'department_requester' and p_department_id is null then
    raise exception 'Payment requester roles need a department';
  end if;
  if p_department_id is not null and not exists (
    select 1 from public.departments d where d.id = p_department_id and d.active
  ) then
    raise exception 'Choose an active department or leave it blank for a company-wide role';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and p.role in ('admin'::public.app_role,'staff'::public.app_role)
  ) then
    raise exception 'Invite this person as an admin account before assigning staff access';
  end if;

  if p_department_id is null then
    insert into public.staff_role_assignments(user_id, department_id, role, active, granted_by)
    values (p_user_id, null, p_role, p_active, auth.uid())
    on conflict (user_id, role) where department_id is null
    do update set active = excluded.active, granted_by = auth.uid()
    returning id into v_assignment_id;
  else
    insert into public.staff_role_assignments(user_id, department_id, role, active, granted_by)
    values (p_user_id, p_department_id, p_role, p_active, auth.uid())
    on conflict (user_id, department_id, role) where department_id is not null
    do update set active = excluded.active, granted_by = auth.uid()
    returning id into v_assignment_id;
  end if;

  update public.profiles
    set role = 'staff'::public.app_role
  where id = p_user_id;

  return v_assignment_id;
end;
$$;

create or replace function public.notify_payment_staff_of_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    insert into public.notifications(user_id, title, message)
    select distinct s.user_id,
      'Driver withdrawal ready to pay',
      'Withdrawal · MVR ' || new.amount::text || ' · ' ||
        coalesce((select d.name from public.drivers d where d.id = new.driver_id), 'Driver')
    from public.staff_role_assignments s
    left join public.departments dep on dep.id = s.department_id
    where s.active
      and s.role = 'payment_officer'
      and (s.department_id is null or dep.name = 'Finance');
  end if;
  return new;
end;
$function$;
