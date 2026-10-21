-- Allow existing superadmins to promote admin profiles without granting
-- clients direct write access to the superadmin membership table.

create or replace function public.list_igo_superadmin_user_ids()
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_igo_superadmin() then
    raise exception 'Only superadmins can view superadmin accounts'
      using errcode = '42501';
  end if;

  return query
    select membership.user_id
    from public.igo_superadmins as membership;
end;
$$;

revoke all on function public.list_igo_superadmin_user_ids() from public;
revoke all on function public.list_igo_superadmin_user_ids() from anon;
grant execute on function public.list_igo_superadmin_user_ids() to authenticated;

create or replace function public.promote_igo_admin_to_superadmin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_igo_superadmin() then
    raise exception 'Only superadmins can promote admin accounts'
      using errcode = '42501';
  end if;

  if p_user_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_user_id
      and profile.role::text = 'admin'
  ) then
    raise exception 'The selected account is not an admin'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.igo_superadmins as membership
    where membership.user_id = p_user_id
  ) then
    insert into public.igo_superadmins (user_id)
    values (p_user_id);
  end if;
end;
$$;

revoke all on function public.promote_igo_admin_to_superadmin(uuid) from public;
revoke all on function public.promote_igo_admin_to_superadmin(uuid) from anon;
grant execute on function public.promote_igo_admin_to_superadmin(uuid) to authenticated;
