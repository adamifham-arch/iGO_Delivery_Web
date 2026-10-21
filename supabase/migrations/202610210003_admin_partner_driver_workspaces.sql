-- Give every admin a usable partner and driver workspace without changing
-- their account role or exposing another user's operational records.

create or replace function public.current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select partner.id
  from public.partners as partner
  join public.profiles as profile on profile.id = auth.uid()
  where partner.owner_id = auth.uid()
    and profile.role::text in ('partner', 'admin')
    and partner.approval_status::text = 'approved'
  order by partner.created_at asc
  limit 1
$function$;

create or replace function public.current_driver_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select driver.id
  from public.drivers as driver
  join public.profiles as profile on profile.id = auth.uid()
  where driver.user_id = auth.uid()
    and profile.role::text in ('driver', 'admin')
    and driver.active = true
    and driver.approval_status::text = 'approved'
  order by driver.created_at asc
  limit 1
$function$;

create or replace function public.ensure_admin_driver_workspace()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_phone text;
  v_driver_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in to open the driver workspace';
  end if;

  select profile.full_name, profile.phone
    into v_name, v_phone
  from public.profiles as profile
  where profile.id = v_user_id and profile.role::text = 'admin';
  if not found then
    raise exception 'Only admin accounts can prepare an admin driver workspace';
  end if;
  if nullif(btrim(v_name), '') is null or nullif(btrim(v_phone), '') is null then
    raise exception 'The admin account needs a name and registered phone number';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text));
  select driver.id into v_driver_id
  from public.drivers as driver
  where driver.user_id = v_user_id
  order by driver.created_at asc
  limit 1;

  if v_driver_id is null then
    insert into public.drivers (user_id, name, phone, active, approval_status)
    values (v_user_id, btrim(v_name), btrim(v_phone), true, 'approved')
    returning id into v_driver_id;
  end if;
  return v_driver_id;
end;
$function$;

create or replace function public.setup_admin_partner_workspace(
  p_business_name text,
  p_address text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_phone text;
  v_email text;
  v_business_name text := nullif(btrim(p_business_name), '');
  v_address text := nullif(btrim(p_address), '');
  v_partner_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in to set up the partner workspace';
  end if;
  if v_business_name is null or length(v_business_name) > 120 then
    raise exception 'Enter a partner or business name of 120 characters or fewer';
  end if;
  if v_address is null or length(v_address) > 500 then
    raise exception 'Enter a business address of 500 characters or fewer';
  end if;

  select profile.full_name, profile.phone, account.email
    into v_name, v_phone, v_email
  from public.profiles as profile
  join auth.users as account on account.id = profile.id
  where profile.id = v_user_id and profile.role::text = 'admin';
  if not found then
    raise exception 'Only admin accounts can create this partner workspace';
  end if;
  if nullif(btrim(v_name), '') is null or nullif(btrim(v_phone), '') is null then
    raise exception 'The admin account needs a name and registered phone number';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text));
  select partner.id into v_partner_id
  from public.partners as partner
  where partner.owner_id = v_user_id
  order by partner.created_at asc
  limit 1;

  if v_partner_id is null then
    insert into public.partners (
      owner_id, name, contact_name, phone, email, address, approval_status
    ) values (
      v_user_id, v_business_name, btrim(v_name), btrim(v_phone), v_email,
      v_address, 'approved'
    ) returning id into v_partner_id;
  end if;
  return v_partner_id;
end;
$function$;

revoke all on function public.ensure_admin_driver_workspace() from public, anon;
grant execute on function public.ensure_admin_driver_workspace() to authenticated;
revoke all on function public.setup_admin_partner_workspace(text, text) from public, anon;
grant execute on function public.setup_admin_partner_workspace(text, text) to authenticated;
grant execute on function public.current_partner_id() to authenticated;
grant execute on function public.current_driver_id() to authenticated;
