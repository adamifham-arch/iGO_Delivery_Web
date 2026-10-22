-- Let Operations dispatch staff assign active drivers and manage package delivery statuses.
-- Customer Support retains read-only package lookup. Finance permissions are unchanged.

drop policy if exists "Operations staff update dispatch packages" on public.packages;
create policy "Operations staff update dispatch packages"
on public.packages for update to authenticated
using (
  public.has_staff_role('operations_manager')
  or public.has_staff_role('operations_staff')
)
with check (
  public.has_staff_role('operations_manager')
  or public.has_staff_role('operations_staff')
);

drop policy if exists "Operations staff read active drivers" on public.drivers;
create policy "Operations staff read active drivers"
on public.drivers for select to authenticated
using (
  active is true
  and approval_status = 'approved'
  and (
    public.has_staff_role('operations_manager')
    or public.has_staff_role('operations_staff')
  )
);

create or replace function public.guard_staff_package_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_igo_full_admin()
    and (
      public.has_staff_role('operations_manager')
      or public.has_staff_role('operations_staff')
    ) then
    if (to_jsonb(new) - array[
      'status',
      'assigned_driver_id',
      'picked_up_at',
      'delivered_at',
      'proof_of_delivery_path',
      'failed_attempt_reason',
      'failed_attempt_at',
      'warehouse_received_at',
      'updated_at'
    ]) is distinct from (to_jsonb(old) - array[
      'status',
      'assigned_driver_id',
      'picked_up_at',
      'delivered_at',
      'proof_of_delivery_path',
      'failed_attempt_reason',
      'failed_attempt_at',
      'warehouse_received_at',
      'updated_at'
    ]) then
      raise exception 'Operations staff may only update driver assignment and delivery progress';
    end if;

    if new.status not in (
      'awaiting_collection',
      'picked_up',
      'delivered',
      'failed_attempt',
      'at_godown',
      'cancelled'
    ) then
      raise exception 'Choose a valid package status';
    end if;

    if new.assigned_driver_id is not null and not exists (
      select 1 from public.drivers d
      where d.id = new.assigned_driver_id
        and d.active is true
        and d.approval_status = 'approved'
    ) then
      raise exception 'Assign the package to an active approved driver';
    end if;

    if new.status in ('picked_up', 'delivered', 'failed_attempt')
      and new.assigned_driver_id is null then
      raise exception 'Assign a driver before updating this delivery status';
    end if;

    if new.status = 'failed_attempt'
      and nullif(trim(coalesce(new.failed_attempt_reason, '')), '') is null then
      raise exception 'Enter a reason for the failed delivery';
    end if;

    if new.status = 'delivered'
      and new.area = 'Boat'
      and nullif(trim(coalesce(new.proof_of_delivery_path, '')), '') is null then
      raise exception 'Attach a boat handover photo before marking this package delivered';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists staff_package_dispatch_guard on public.packages;
create trigger staff_package_dispatch_guard
before update on public.packages
for each row execute function public.guard_staff_package_dispatch();
