create or replace function public.list_manual_notification_recipients()
returns table(user_id uuid, display_name text, email text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_igo_full_admin() then
    raise exception 'Only full admins may send manual notifications' using errcode = '42501';
  end if;

  return query
  select
    p.id::uuid as user_id,
    coalesce(nullif(pg_catalog.btrim(p.full_name), ''), nullif(u.email::text, ''), 'iGO user')::text as display_name,
    coalesce(u.email::text, '')::text as email,
    p.role::text as role
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id <> auth.uid()
    and p.role::text in ('partner', 'driver', 'staff', 'admin')
  order by p.role::text,
    coalesce(nullif(pg_catalog.btrim(p.full_name), ''), nullif(u.email::text, ''), 'iGO user')::text;
end;
$function$;
