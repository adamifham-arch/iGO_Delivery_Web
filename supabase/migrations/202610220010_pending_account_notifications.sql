-- Notify all full admins when a partner or driver account is created pending approval.
create or replace function public.notify_admins_of_pending_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_type text;
begin
  if new.approval_status is distinct from 'pending'::public.partner_approval then
    return new;
  end if;

  v_account_type := case
    when tg_table_name = 'partners' then 'partner'
    else 'driver'
  end;

  insert into public.notifications(user_id, title, message)
  select p.id,
    'New user awaiting approval',
    'A ' || v_account_type || ' account (' || coalesce(nullif(btrim(new.name), ''), 'unnamed') || ') is waiting for approval.'
  from public.profiles p
  where p.role = 'admin'::public.app_role;

  return new;
end;
$function$;

revoke all on function public.notify_admins_of_pending_account() from public;

drop trigger if exists partners_notify_pending_admins on public.partners;
create trigger partners_notify_pending_admins
  after insert on public.partners
  for each row execute function public.notify_admins_of_pending_account();

drop trigger if exists drivers_notify_pending_admins on public.drivers;
create trigger drivers_notify_pending_admins
  after insert on public.drivers
  for each row execute function public.notify_admins_of_pending_account();

-- Surface accounts that were already waiting when this migration is applied.
insert into public.notifications(user_id, title, message)
select admins.id,
  'New user awaiting approval',
  'A ' || pending.account_type || ' account (' || coalesce(nullif(btrim(pending.name), ''), 'unnamed') || ') is waiting for approval.'
from public.profiles admins
cross join (
  select 'partner'::text as account_type, name
  from public.partners
  where approval_status = 'pending'::public.partner_approval
  union all
  select 'driver'::text as account_type, name
  from public.drivers
  where approval_status = 'pending'::public.partner_approval
) pending
where admins.role = 'admin'::public.app_role
  and not exists (
    select 1
    from public.notifications existing
    where existing.user_id = admins.id
      and existing.title = 'New user awaiting approval'
      and existing.message = 'A ' || pending.account_type || ' account (' || coalesce(nullif(btrim(pending.name), ''), 'unnamed') || ') is waiting for approval.'
  );
