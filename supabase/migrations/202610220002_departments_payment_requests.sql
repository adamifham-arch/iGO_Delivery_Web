-- Internal departments, least-privilege staff assignments, and payment requests.
-- Apply after 202610220001_add_staff_role.sql.

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.departments(name, description) values
  ('Finance', 'Payment approvals, bookkeeping, and disbursements'),
  ('Operations', 'Package handling, driver coordination, and delivery operations'),
  ('Customer Support', 'Customer and partner delivery support'),
  ('People Management', 'Staff invitations, role assignments, and account access')
on conflict (name) do nothing;

create table if not exists public.staff_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  role text not null check (role in (
    'department_requester','finance_approver','payment_officer',
    'operations_manager','operations_staff','customer_support','people_manager'
  )),
  active boolean not null default true,
  granted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(user_id, department_id, role)
);
alter table public.departments enable row level security;
alter table public.staff_role_assignments enable row level security;

create or replace function public.has_staff_role(p_role text, p_department_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_role_assignments s
    where s.user_id = auth.uid() and s.active and s.role = p_role
      and (p_department_id is null or s.department_id = p_department_id)
  );
$$;

create or replace function public.is_igo_full_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_user_role() = 'admin'::public.app_role;
$$;

drop policy if exists "Staff read assigned departments" on public.departments;
create policy "Staff read assigned departments" on public.departments for select to authenticated
  using (public.is_igo_full_admin() or exists (
    select 1 from public.staff_role_assignments s
    where s.department_id = departments.id and s.user_id = auth.uid() and s.active
  ));
drop policy if exists "Owner manages departments" on public.departments;
create policy "Owner manages departments" on public.departments for all to authenticated
  using (public.is_igo_full_admin() and public.is_igo_superadmin())
  with check (public.is_igo_full_admin() and public.is_igo_superadmin());
drop policy if exists "Users read their staff assignments" on public.staff_role_assignments;
create policy "Users read their staff assignments" on public.staff_role_assignments for select to authenticated
  using (user_id = auth.uid() or (public.is_igo_full_admin() and public.is_igo_superadmin()));

create or replace function public.assign_igo_staff_role(
  p_user_id uuid, p_department_id uuid, p_role text, p_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_assignment_id uuid;
begin
  if not public.is_igo_full_admin() or not public.is_igo_superadmin() then
    raise exception 'Only the owner may manage staff roles';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'The owner account keeps full access and cannot be assigned a staff role';
  end if;
  if p_role not in ('department_requester','finance_approver','payment_officer',
    'operations_manager','operations_staff','customer_support','people_manager') then
    raise exception 'Choose a supported staff role';
  end if;
  if not exists(select 1 from public.departments d where d.id = p_department_id and d.active) then
    raise exception 'Choose an active department';
  end if;
  if not exists(select 1 from public.profiles p where p.id = p_user_id and p.role in ('admin'::public.app_role,'staff'::public.app_role)) then
    raise exception 'Invite this person as an admin account before assigning staff access';
  end if;
  insert into public.staff_role_assignments(user_id, department_id, role, active, granted_by)
  values(p_user_id,p_department_id,p_role,p_active,auth.uid())
  on conflict(user_id,department_id,role) do update set active=excluded.active, granted_by=auth.uid()
  returning id into v_assignment_id;
  update public.profiles set role = 'staff'::public.app_role where id = p_user_id;
  return v_assignment_id;
end;
$$;

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  requester_id uuid not null references auth.users(id),
  category text not null,
  description text not null,
  payee_name text not null,
  amount numeric(12,2) not null check (amount > 0),
  due_date date,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','paid')),
  rejection_reason text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  paid_by uuid references auth.users(id),
  paid_at timestamptz,
  payment_reference text,
  payment_slip_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_requests_department_status_idx on public.payment_requests(department_id,status,created_at desc);
create index if not exists payment_requests_requester_idx on public.payment_requests(requester_id,created_at desc);
alter table public.payment_requests enable row level security;

drop policy if exists "Staff view relevant payment requests" on public.payment_requests;
create policy "Staff view relevant payment requests" on public.payment_requests for select to authenticated
using (
  public.is_igo_full_admin()
  or requester_id = auth.uid()
  or (status in ('pending_review','approved','rejected','paid') and public.has_staff_role('finance_approver',department_id))
  or (status in ('approved','paid') and public.has_staff_role('payment_officer',department_id))
  or public.has_staff_role('people_manager')
);
drop policy if exists "Staff submit payment requests" on public.payment_requests;
create policy "Staff submit payment requests" on public.payment_requests for insert to authenticated
with check (
  requester_id = auth.uid()
  and status = 'pending_review'
  and (public.is_igo_full_admin() or public.has_staff_role('department_requester',department_id)
    or public.has_staff_role('operations_manager',department_id))
);
drop policy if exists "Finance reviews payment requests" on public.payment_requests;
create policy "Finance reviews payment requests" on public.payment_requests for update to authenticated
using (public.is_igo_full_admin() or (status = 'pending_review' and public.has_staff_role('finance_approver',department_id)))
with check (public.is_igo_full_admin() or (
  status in ('approved','rejected') and approved_by = auth.uid()
  and public.has_staff_role('finance_approver',department_id)
));
drop policy if exists "Payment officers record disbursements" on public.payment_requests;
create policy "Payment officers record disbursements" on public.payment_requests for update to authenticated
using (status = 'approved' and public.has_staff_role('payment_officer',department_id))
with check (status = 'paid' and paid_by = auth.uid() and payment_slip_path is not null
  and payment_reference is not null and public.has_staff_role('payment_officer',department_id));

create or replace function public.guard_payment_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.requester_id is distinct from auth.uid() or new.status <> 'pending_review' then
      raise exception 'Payment requests must be submitted by the signed-in requester';
    end if;
    return new;
  end if;
  if public.is_igo_full_admin() then
    new.updated_at := now();
    return new;
  end if;
  if old.status = 'pending_review' and new.status in ('approved','rejected')
    and public.has_staff_role('finance_approver',old.department_id)
    and (to_jsonb(new) - array['status','rejection_reason','approved_by','approved_at','updated_at'])
      is not distinct from (to_jsonb(old) - array['status','rejection_reason','approved_by','approved_at','updated_at']) then
    if new.status = 'rejected' and length(trim(coalesce(new.rejection_reason,''))) < 3 then
      raise exception 'Enter a reason for rejecting this request';
    end if;
    new.approved_by := auth.uid(); new.approved_at := now(); new.updated_at := now();
    return new;
  end if;
  if old.status = 'approved' and new.status = 'paid'
    and public.has_staff_role('payment_officer',old.department_id)
    and (to_jsonb(new) - array['status','paid_by','paid_at','payment_reference','payment_slip_path','updated_at'])
      is not distinct from (to_jsonb(old) - array['status','paid_by','paid_at','payment_reference','payment_slip_path','updated_at']) then
    if nullif(trim(coalesce(new.payment_reference,'')),'') is null or nullif(trim(coalesce(new.payment_slip_path,'')),'') is null then
      raise exception 'Attach the payment slip and enter the payment reference before marking paid';
    end if;
    new.paid_by := auth.uid(); new.paid_at := now(); new.updated_at := now();
    return new;
  end if;
  raise exception 'This staff role cannot make that payment request change';
end;
$$;
drop trigger if exists payment_requests_guard on public.payment_requests;
create trigger payment_requests_guard before insert or update on public.payment_requests
for each row execute function public.guard_payment_request();

create table if not exists public.payment_request_events (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event text not null,
  details text not null default '',
  created_at timestamptz not null default now()
);
alter table public.payment_request_events enable row level security;
drop policy if exists "Staff read payment request history" on public.payment_request_events;
create policy "Staff read payment request history" on public.payment_request_events for select to authenticated
using (exists(select 1 from public.payment_requests r where r.id=payment_request_id));
create or replace function public.log_payment_request_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.payment_request_events(payment_request_id,actor_id,event,details)
    values(new.id,new.requester_id,'submitted',new.category || ' · MVR ' || new.amount::text);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.payment_request_events(payment_request_id,actor_id,event,details)
    values(new.id,auth.uid(),new.status,case when new.status='rejected' then new.rejection_reason when new.status='paid' then new.payment_reference else '' end);
    if new.status in ('approved','rejected','paid') then
      insert into public.notifications(user_id,title,message)
      values(new.requester_id,'Payment request ' || new.status,'Your ' || new.category || ' request for MVR ' || new.amount::text || ' is ' || new.status || '.');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists payment_requests_events on public.payment_requests;
create trigger payment_requests_events after insert or update on public.payment_requests
for each row execute function public.log_payment_request_event();

-- Private payment proof is visible only to assigned payment staff and the owner.
insert into storage.buckets(id,name,public) values('payment-proofs','payment-proofs',false)
on conflict(id) do update set public=false;
drop policy if exists "Payment staff upload payment proofs" on storage.objects;
create policy "Payment staff upload payment proofs" on storage.objects for insert to authenticated
with check(bucket_id='payment-proofs' and (public.is_igo_full_admin() or public.has_staff_role('payment_officer')));
drop policy if exists "Payment staff read payment proofs" on storage.objects;
create policy "Payment staff read payment proofs" on storage.objects for select to authenticated
using(bucket_id='payment-proofs' and (public.is_igo_full_admin() or public.has_staff_role('payment_officer') or public.has_staff_role('finance_approver')));
