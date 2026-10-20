-- Additive persistence for iGO operational and finance workflows.
-- Existing business data and current approval policies are preserved.

alter table public.packages
  add column if not exists proof_of_delivery_path text,
  add column if not exists failed_attempt_reason text,
  add column if not exists failed_attempt_at timestamptz,
  add column if not exists warehouse_received_at timestamptz,
  add column if not exists boat_name text,
  add column if not exists boat_location text,
  add column if not exists departure_time time,
  add column if not exists landmark text;

alter table public.payments
  add column if not exists target_invoice_id uuid references public.invoices(id);

-- A partner may submit a receipt for their own outstanding invoice, but may
-- never insert a confirmed payment or alter a payment after submission.
-- Only an admin may review a pending submission, and the money fields remain
-- immutable during review.
create or replace function public.guard_igo_payment_review()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_role public.app_role; v_partner_id uuid; v_due numeric(12,2);
begin
  v_role := public.current_user_role();
  if tg_op = 'INSERT' and v_role = 'partner'::public.app_role then
    v_partner_id := public.current_partner_id();
    if v_partner_id is null or new.partner_id is distinct from v_partner_id
      or new.status is distinct from 'pending_verification'::public.payment_status
      or new.verified_by is not null or new.verified_at is not null
      or new.rejection_reason is not null then
      raise exception 'Partners may submit only their own payment for admin review';
    end if;
    if new.target_invoice_id is null then
      raise exception 'Choose the invoice this payment is for';
    end if;
    select greatest(0, i.subtotal - i.paid_amount) into v_due
    from public.invoices i
    where i.id = new.target_invoice_id and i.partner_id = v_partner_id
      and i.status in ('unpaid'::public.invoice_status,'partially_paid'::public.invoice_status);
    if v_due is null or new.amount <= 0 or new.amount > v_due then
      raise exception 'Payment must match an outstanding invoice balance';
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
  raise exception 'Only an approved partner may submit payments and only admins may review them';
end;
$function$;
drop trigger if exists payments_guard_review on public.payments;
create trigger payments_guard_review before insert or update on public.payments
  for each row execute function public.guard_igo_payment_review();

create table if not exists public.driver_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bank_name text,
  account_holder text,
  account_number text,
  branch text,
  online boolean not null default false,
  online_updated_at timestamptz,
  share_percent numeric(5,2) not null default 0 check (share_percent between 0 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id),
  requested_by uuid not null references auth.users(id),
  amount numeric(12,2) not null check (amount > 0),
  request_date date not null default ((now() at time zone 'Indian/Maldives')::date),
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  bank_details_snapshot jsonb not null,
  note text,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  paid_at timestamptz,
  paid_reference text,
  unique (driver_id, request_date)
);
alter table public.driver_withdrawal_requests
  add column if not exists paid_at timestamptz,
  add column if not exists paid_reference text;

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null,
  description text not null,
  paid_to text not null,
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  receipt_path text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.package_status_events (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  actor_id uuid references auth.users(id),
  previous_status public.package_status,
  new_status public.package_status not null,
  note text,
  proof_of_delivery_path text,
  created_at timestamptz not null default now()
);

alter table public.driver_settings enable row level security;
alter table public.driver_withdrawal_requests enable row level security;
alter table public.business_expenses enable row level security;
alter table public.package_status_events enable row level security;

drop policy if exists "Drivers and admins read driver settings" on public.driver_settings;
create policy "Drivers and admins read driver settings" on public.driver_settings
  for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() = 'admin'::public.app_role);
drop policy if exists "Drivers and admins create driver settings" on public.driver_settings;
create policy "Drivers and admins create driver settings" on public.driver_settings
  for insert to authenticated
  with check (user_id = auth.uid() and public.current_user_role() = 'driver'::public.app_role or public.current_user_role() = 'admin'::public.app_role);
drop policy if exists "Drivers and admins update driver settings" on public.driver_settings;
create policy "Drivers and admins update driver settings" on public.driver_settings
  for update to authenticated
  using (user_id = auth.uid() and public.current_user_role() = 'driver'::public.app_role or public.current_user_role() = 'admin'::public.app_role)
  with check (user_id = auth.uid() and public.current_user_role() = 'driver'::public.app_role or public.current_user_role() = 'admin'::public.app_role);

create or replace function public.guard_driver_settings()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if public.current_user_role() is distinct from 'admin'::public.app_role then
    if new.online and public.current_driver_id() is null then
      raise exception 'Only approved drivers can appear online';
    end if;
    if tg_op = 'INSERT' and new.share_percent <> 0 then
      raise exception 'Only admins may set the driver share percentage';
    elsif tg_op = 'UPDATE' and new.share_percent is distinct from old.share_percent then
      raise exception 'Only admins may change the driver share percentage';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Driver settings ownership cannot be changed';
  end if;
  return new;
end;
$function$;
drop trigger if exists driver_settings_guard on public.driver_settings;
create trigger driver_settings_guard before insert or update on public.driver_settings
  for each row execute function public.guard_driver_settings();

drop policy if exists "Admins manage payment bank accounts" on public.bank_accounts;
create policy "Admins manage payment bank accounts" on public.bank_accounts
  for all to authenticated
  using (public.current_user_role() = 'admin'::public.app_role)
  with check (public.current_user_role() = 'admin'::public.app_role);

drop policy if exists "Drivers and admins read withdrawals" on public.driver_withdrawal_requests;
create policy "Drivers and admins read withdrawals" on public.driver_withdrawal_requests
  for select to authenticated
  using (requested_by = auth.uid() or public.current_user_role() = 'admin'::public.app_role);
drop policy if exists "Approved drivers request withdrawals" on public.driver_withdrawal_requests;
create policy "Approved drivers request withdrawals" on public.driver_withdrawal_requests
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and driver_id = public.current_driver_id()
    and request_date = (now() at time zone 'Indian/Maldives')::date
    and status = 'pending'
    and public.current_driver_id() is not null
  );

create or replace function public.guard_driver_withdrawal_request()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_driver_id uuid;
  v_share numeric(5,2);
  v_bank jsonb;
  v_earned numeric(12,2);
  v_reserved numeric(12,2);
begin
  v_driver_id := public.current_driver_id();
  if auth.uid() is null or v_driver_id is null or new.requested_by is distinct from auth.uid() or new.driver_id is distinct from v_driver_id then
    raise exception 'Only an approved driver may request their own withdrawal';
  end if;
  select s.share_percent,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'bankName',s.bank_name,'accountHolder',s.account_holder,'accountNumber',s.account_number,'branch',s.branch
    ))
    into v_share, v_bank
  from public.driver_settings s where s.user_id = auth.uid() for update;
  if v_share is null or v_share <= 0 or v_bank is null or not (v_bank ? 'bankName' and v_bank ? 'accountHolder' and v_bank ? 'accountNumber') then
    raise exception 'Save complete bank details before requesting a withdrawal';
  end if;
  if new.bank_details_snapshot is distinct from v_bank then
    raise exception 'Withdrawal bank details must match the saved driver account';
  end if;
  select coalesce(sum(p.delivery_fee * v_share / 100),0) into v_earned
  from public.packages p where p.assigned_driver_id = v_driver_id and p.status = 'delivered'::public.package_status;
  select coalesce(sum(w.amount),0) into v_reserved
  from public.driver_withdrawal_requests w where w.driver_id = v_driver_id and w.status in ('pending','approved','paid');
  if new.amount <= 0 or new.amount > greatest(0,v_earned-v_reserved) then
    raise exception 'Withdrawal amount exceeds available driver earnings';
  end if;
  new.request_date := (pg_catalog.now() at time zone 'Indian/Maldives')::date;
  new.status := 'pending';
  new.requested_at := pg_catalog.now();
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$function$;
drop trigger if exists driver_withdrawal_request_guard on public.driver_withdrawal_requests;
create trigger driver_withdrawal_request_guard before insert on public.driver_withdrawal_requests
  for each row execute function public.guard_driver_withdrawal_request();
drop policy if exists "Admins review withdrawals" on public.driver_withdrawal_requests;
create policy "Admins review withdrawals" on public.driver_withdrawal_requests
  for update to authenticated
  using (public.current_user_role() = 'admin'::public.app_role)
  with check (public.current_user_role() = 'admin'::public.app_role);

create or replace function public.guard_driver_withdrawal_review()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if public.current_user_role() is distinct from 'admin'::public.app_role
    or old.status not in ('pending','approved')
    or (old.status = 'pending' and new.status not in ('approved','rejected'))
    or (old.status = 'approved' and new.status <> 'paid')
    or (to_jsonb(new) - array['status','reviewed_by','reviewed_at','paid_at','paid_reference'])
      is distinct from
      (to_jsonb(old) - array['status','reviewed_by','reviewed_at','paid_at','paid_reference']) then
    raise exception 'Admins may approve or reject a request, then record it as paid';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := pg_catalog.now();
  if new.status = 'paid' then
    new.paid_at := pg_catalog.now();
  else
    new.paid_at := null;
    new.paid_reference := null;
  end if;
  return new;
end;
$function$;
drop trigger if exists withdrawals_guard_review on public.driver_withdrawal_requests;
create trigger withdrawals_guard_review before update on public.driver_withdrawal_requests
  for each row execute function public.guard_driver_withdrawal_review();

drop policy if exists "Admins manage business expenses" on public.business_expenses;
create policy "Admins manage business expenses" on public.business_expenses
  for all to authenticated
  using (public.current_user_role() = 'admin'::public.app_role)
  with check (public.current_user_role() = 'admin'::public.app_role and recorded_by = auth.uid());

drop policy if exists "Users read related package status history" on public.package_status_events;
create policy "Users read related package status history" on public.package_status_events
  for select to authenticated
  using (
    public.current_user_role() = 'admin'::public.app_role
    or exists (
      select 1 from public.packages p
      where p.id = package_status_events.package_id
        and (p.partner_id = public.current_partner_id()
          or p.assigned_driver_id = public.current_driver_id()
          or (p.assigned_driver_id is null and public.current_driver_id() is not null))
    )
  );

create index if not exists packages_partner_created_idx on public.packages(partner_id, created_at desc);
create index if not exists packages_driver_status_idx on public.packages(assigned_driver_id, status, created_at desc);
create index if not exists payments_partner_status_idx on public.payments(partner_id, status, submitted_at desc);
create index if not exists payments_target_invoice_idx on public.payments(target_invoice_id) where target_invoice_id is not null;
create index if not exists withdrawals_status_date_idx on public.driver_withdrawal_requests(status, request_date desc);
create index if not exists expenses_date_idx on public.business_expenses(expense_date desc);
create index if not exists package_events_package_created_idx on public.package_status_events(package_id, created_at);

-- Every status change is retained for partner/driver tracking and admin audit.
create or replace function public.record_package_status_event()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.package_status_events(package_id, actor_id, previous_status, new_status, note, proof_of_delivery_path)
    values (new.id, auth.uid(), null, new.status, null, new.proof_of_delivery_path);
  elsif new.status is distinct from old.status or new.proof_of_delivery_path is distinct from old.proof_of_delivery_path then
    insert into public.package_status_events(package_id, actor_id, previous_status, new_status, note, proof_of_delivery_path)
    values (new.id, auth.uid(), old.status, new.status, new.failed_attempt_reason, new.proof_of_delivery_path);
  end if;
  return new;
end;
$function$;
drop trigger if exists packages_record_status_event on public.packages;
create trigger packages_record_status_event after insert or update of status, proof_of_delivery_path on public.packages
  for each row execute function public.record_package_status_event();

-- Driver status transitions keep the existing guard's ownership/approval checks
-- and add POD validation for delivery. A failed attempt must include a reason.
create or replace function public.guard_igo_updates()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_role public.app_role; v_driver_id uuid;
begin
  if auth.uid() is null then return new; end if;
  v_role := public.current_user_role();
  if tg_table_name = 'packages' and new.status = 'delivered'::public.package_status and new.area = 'Boat'
    and (new.proof_of_delivery_path is null or not exists (
      select 1 from storage.objects o where o.bucket_id='igo-delivery-files' and o.name=new.proof_of_delivery_path
        and coalesce(o.metadata->>'mimetype','') like 'image/%'
    )) then
    raise exception 'Upload proof of delivery before marking this boat package delivered';
  end if;
  if v_role = 'admin'::public.app_role then return new; end if;
  if tg_table_name = 'partners' then
    if v_role is distinct from 'partner'::public.app_role or
      (to_jsonb(new) - array['name','contact_name','phone','email','page_url','address']) is distinct from
      (to_jsonb(old) - array['name','contact_name','phone','email','page_url','address']) then
      raise exception 'Only admins may change partner ownership, approval, or billing settings';
    end if;
    return new;
  elsif tg_table_name = 'drivers' then
    if v_role is distinct from 'driver'::public.app_role or
      (to_jsonb(new) - array['name','phone']) is distinct from
      (to_jsonb(old) - array['name','phone']) then
      raise exception 'Only admins may change driver ownership, approval, or active status';
    end if;
    return new;
  elsif tg_table_name = 'packages' then
    if v_role = 'partner'::public.app_role then
      if public.current_partner_id() is null or old.partner_id is distinct from public.current_partner_id()
        or old.status <> 'awaiting_collection'::public.package_status
        or (to_jsonb(new) - array['customer_name','customer_phone','address','area','item_description','delivery_fee','notes','boat_name','boat_location','departure_time','landmark','updated_at']) is distinct from
           (to_jsonb(old) - array['customer_name','customer_phone','address','area','item_description','delivery_fee','notes','boat_name','boat_location','departure_time','landmark','updated_at']) then
        raise exception 'Partners may edit only their own uncollected package details';
      end if;
      return new;
    elsif v_role = 'driver'::public.app_role then
      v_driver_id := public.current_driver_id();
      if v_driver_id is null or
        (to_jsonb(new) - array['assigned_driver_id','status','picked_up_at','delivered_at','updated_at','proof_of_delivery_path','failed_attempt_reason','failed_attempt_at','warehouse_received_at']) is distinct from
        (to_jsonb(old) - array['assigned_driver_id','status','picked_up_at','delivered_at','updated_at','proof_of_delivery_path','failed_attempt_reason','failed_attempt_at','warehouse_received_at']) then
        raise exception 'Drivers may change only assignment and delivery status fields';
      end if;
      if old.assigned_driver_id is null then
        if old.status <> 'awaiting_collection'::public.package_status or new.assigned_driver_id is distinct from v_driver_id
          or new.status <> 'awaiting_collection'::public.package_status or new.picked_up_at is not null or new.delivered_at is not null
          or new.proof_of_delivery_path is distinct from old.proof_of_delivery_path then
          raise exception 'A driver may claim only an unassigned package awaiting collection';
        end if;
      elsif old.assigned_driver_id = v_driver_id then
        if old.status = 'awaiting_collection'::public.package_status then
          if new.assigned_driver_id is distinct from v_driver_id or new.status not in ('awaiting_collection'::public.package_status,'picked_up'::public.package_status)
            or new.proof_of_delivery_path is distinct from old.proof_of_delivery_path then raise exception 'Invalid package status transition'; end if;
          if new.status = 'picked_up'::public.package_status then new.picked_up_at := pg_catalog.now(); new.delivered_at := null;
          else new.picked_up_at := old.picked_up_at; new.delivered_at := old.delivered_at; end if;
        elsif old.status = 'picked_up'::public.package_status then
          if new.assigned_driver_id is distinct from v_driver_id then raise exception 'Drivers cannot reassign packages'; end if;
          if new.status = 'delivered'::public.package_status then
            if new.area = 'Boat' and (new.proof_of_delivery_path is null or not exists (
              select 1 from storage.objects o where o.bucket_id = 'igo-delivery-files' and o.name = new.proof_of_delivery_path
                and coalesce(o.metadata->>'mimetype','') like 'image/%'
            )) then raise exception 'Upload proof of delivery before marking this boat package delivered'; end if;
            if new.failed_attempt_reason is distinct from old.failed_attempt_reason or new.warehouse_received_at is distinct from old.warehouse_received_at then raise exception 'Invalid delivery update'; end if;
            new.picked_up_at := old.picked_up_at; new.delivered_at := pg_catalog.now();
          elsif new.status = 'failed_attempt'::public.package_status then
            if coalesce(pg_catalog.btrim(new.failed_attempt_reason),'') = '' then raise exception 'Record why delivery failed'; end if;
            new.picked_up_at := old.picked_up_at; new.delivered_at := null; new.failed_attempt_at := pg_catalog.now();
          else raise exception 'Invalid package status transition'; end if;
        elsif old.status = 'failed_attempt'::public.package_status then
          if new.status <> 'at_godown'::public.package_status or new.assigned_driver_id is distinct from v_driver_id
            or coalesce(pg_catalog.btrim(old.failed_attempt_reason),'') = ''
            or new.failed_attempt_reason is distinct from old.failed_attempt_reason
            or new.proof_of_delivery_path is distinct from old.proof_of_delivery_path then raise exception 'Return the failed package to the warehouse'; end if;
          new.picked_up_at := old.picked_up_at; new.delivered_at := null; new.failed_attempt_at := old.failed_attempt_at; new.warehouse_received_at := pg_catalog.now();
        else raise exception 'Delivered or returned packages cannot be changed by drivers'; end if;
      else raise exception 'Drivers may claim unassigned packages or update their own assigned packages'; end if;
      return new;
    end if;
    raise exception 'This account cannot update packages';
  end if;
  return new;
end;
$function$;

-- Permit only approved, assigned drivers to perform the above controlled transitions.
drop policy if exists "Approved drivers update claimable packages" on public.packages;
create policy "Approved drivers update claimable packages" on public.packages
  for update to authenticated
  using (
    public.current_driver_id() is not null and (
      (status = 'awaiting_collection'::public.package_status and assigned_driver_id is null)
      or (assigned_driver_id = public.current_driver_id() and status in ('awaiting_collection'::public.package_status,'picked_up'::public.package_status,'failed_attempt'::public.package_status))
    )
  )
  with check (
    public.current_driver_id() is not null
    and assigned_driver_id = public.current_driver_id()
    and status in ('awaiting_collection'::public.package_status,'picked_up'::public.package_status,'delivered'::public.package_status,'failed_attempt'::public.package_status,'at_godown'::public.package_status)
  );

-- Private upload bucket for payment receipts and delivery evidence.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('igo-delivery-files','igo-delivery-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own iGO files" on storage.objects;
create policy "Users upload own iGO files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'igo-delivery-files' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Users read own iGO files and admins read all" on storage.objects;
create policy "Users read own iGO files and admins read all" on storage.objects
  for select to authenticated using (
    bucket_id = 'igo-delivery-files' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.current_user_role() = 'admin'::public.app_role
      or exists (
        select 1 from public.packages p where p.proof_of_delivery_path = name
          and (p.partner_id = public.current_partner_id() or p.assigned_driver_id = public.current_driver_id())
      )
      or exists (
        select 1 from public.payments pay where pay.receipt_path = name and pay.partner_id = public.current_partner_id()
      )
    )
  );

-- Apply confirmed payments to the partner's oldest unpaid invoices atomically.
create or replace function public.allocate_confirmed_payment()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_remaining numeric(12,2); v_due numeric(12,2); v_apply numeric(12,2); v_invoice record;
begin
  if new.status = 'confirmed'::public.payment_status and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    v_remaining := new.amount;
    for v_invoice in
      select i.id, i.subtotal, i.paid_amount from public.invoices i
      where i.partner_id = new.partner_id and i.status in ('unpaid'::public.invoice_status,'partially_paid'::public.invoice_status)
        and (new.target_invoice_id is null or i.id = new.target_invoice_id)
      order by i.created_at, i.id for update
    loop
      exit when v_remaining <= 0;
      v_due := greatest(0, v_invoice.subtotal - v_invoice.paid_amount);
      v_apply := least(v_remaining, v_due);
      if v_apply > 0 then
        insert into public.payment_allocations(payment_id, invoice_id, amount) values (new.id, v_invoice.id, v_apply);
        update public.invoices set paid_amount = paid_amount + v_apply,
          status = case when paid_amount + v_apply >= subtotal then 'paid'::public.invoice_status else 'partially_paid'::public.invoice_status end
          where id = v_invoice.id;
        v_remaining := v_remaining - v_apply;
      end if;
    end loop;
    if v_remaining > 0 then raise exception 'Confirmed payment exceeds this partner invoice balance'; end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists payments_allocate_on_confirmation on public.payments;
create trigger payments_allocate_on_confirmation after insert or update of status on public.payments
  for each row execute function public.allocate_confirmed_payment();

-- Notify approved drivers when a new package becomes available.
create or replace function public.notify_drivers_new_package()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.notifications(user_id,title,message)
  select d.user_id, 'New delivery available', 'Package ' || new.package_number::text || ' is ready for collection.'
  from public.drivers d
  where d.active = true and d.approval_status = 'approved'::public.partner_approval;
  return new;
end;
$function$;
drop trigger if exists packages_notify_drivers on public.packages;
create trigger packages_notify_drivers after insert on public.packages
  for each row execute function public.notify_drivers_new_package();

create or replace function public.notify_partner_on_package_status()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_owner uuid;
begin
  if new.status is distinct from old.status then
    select p.owner_id into v_owner from public.partners p where p.id = new.partner_id;
    if v_owner is not null then
      insert into public.notifications(user_id,title,message)
      values (v_owner, 'Package status updated', 'Package ' || new.package_number::text || ' is now ' || replace(new.status::text,'_',' ') || '.');
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists packages_notify_partner_status on public.packages;
create trigger packages_notify_partner_status after update of status on public.packages
  for each row execute function public.notify_partner_on_package_status();

create or replace function public.notify_payment_status_change()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_owner uuid;
begin
  if new.status is distinct from old.status then
    select p.owner_id into v_owner from public.partners p where p.id = new.partner_id;
    if v_owner is not null then
      insert into public.notifications(user_id,title,message)
      values (v_owner,
        case when new.status = 'confirmed'::public.payment_status then 'Payment approved' else 'Payment needs attention' end,
        'Your payment of MVR ' || new.amount::text || ' is ' || replace(new.status::text,'_',' ') || '.');
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists payments_notify_partner on public.payments;
create trigger payments_notify_partner after update of status on public.payments
  for each row execute function public.notify_payment_status_change();

create or replace function public.notify_admin_of_payment_submission()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.notifications(user_id,title,message)
  select p.id, 'Partner payment submitted', 'A partner submitted MVR ' || new.amount::text || ' for invoice review.'
  from public.profiles p where p.role = 'admin'::public.app_role;
  return new;
end;
$function$;
drop trigger if exists payments_notify_admin_submission on public.payments;
create trigger payments_notify_admin_submission after insert on public.payments
  for each row execute function public.notify_admin_of_payment_submission();

create or replace function public.notify_admin_of_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.notifications(user_id,title,message)
  select p.id, 'Driver withdrawal request', 'A driver requested MVR ' || new.amount::text || ' for review.'
  from public.profiles p where p.role = 'admin'::public.app_role;
  return new;
end;
$function$;
drop trigger if exists withdrawals_notify_admin on public.driver_withdrawal_requests;
create trigger withdrawals_notify_admin after insert on public.driver_withdrawal_requests
  for each row execute function public.notify_admin_of_withdrawal();

create or replace function public.notify_driver_withdrawal_decision()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.status is distinct from old.status then
    insert into public.notifications(user_id,title,message)
    values (new.requested_by, 'Withdrawal request updated', 'Your withdrawal request is now ' || new.status || '.');
  end if;
  return new;
end;
$function$;
drop trigger if exists withdrawals_notify_driver on public.driver_withdrawal_requests;
create trigger withdrawals_notify_driver after update of status on public.driver_withdrawal_requests
  for each row execute function public.notify_driver_withdrawal_decision();
