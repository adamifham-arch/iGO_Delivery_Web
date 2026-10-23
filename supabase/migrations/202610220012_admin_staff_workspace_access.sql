-- Let the owner restore manually invited admin accounts to Admin or Staff mode,
-- and configure which admin workspace views are available to each invite.
alter table public.igo_admin_invite_audit
  add column if not exists workspace_access text[] not null
    default array['Admin','Partner','Driver']::text[],
  add column if not exists workspace_switcher_visible boolean not null default true;

update public.igo_admin_invite_audit audit
set workspace_access = array['Staff']::text[]
from public.profiles profile
where profile.id = audit.invited_user_id
  and profile.role::text = 'staff'
  and audit.workspace_access = array['Admin','Partner','Driver']::text[];

create or replace function public.list_igo_admin_access_settings()
returns table (
  invited_user_id uuid,
  account_role text,
  workspace_access text[],
  workspace_switcher_visible boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid() and actor.role::text = 'admin'
  ) then
    raise exception 'Only signed-in admins can view admin access settings'
      using errcode = '42501';
  end if;

  return query
    select audit.invited_user_id,
           profile.role::text,
           case when profile.role::text = 'staff' then array['Staff']::text[]
                else audit.workspace_access end,
           audit.workspace_switcher_visible
    from public.igo_admin_invite_audit audit
    join public.profiles profile on profile.id = audit.invited_user_id
    order by profile.full_name;
end;
$$;

revoke all on function public.list_igo_admin_access_settings() from public, anon;
grant execute on function public.list_igo_admin_access_settings() to authenticated;

create or replace function public.get_igo_current_workspace_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_access text[];
  v_visible boolean;
begin
  select profile.role::text into v_role
  from public.profiles profile where profile.id = auth.uid();
  if v_role is null then
    raise exception 'Signed-in account has no iGO profile'
      using errcode = '42501';
  end if;

  if v_role = 'staff' then
    return jsonb_build_object(
      'workspace_access', array['Staff']::text[],
      'workspace_switcher_visible', false
    );
  end if;
  if v_role <> 'admin' then
    return jsonb_build_object(
      'workspace_access', array[]::text[],
      'workspace_switcher_visible', false
    );
  end if;

  select audit.workspace_access, audit.workspace_switcher_visible
    into v_access, v_visible
  from public.igo_admin_invite_audit audit
  where audit.invited_user_id = auth.uid();

  return jsonb_build_object(
    'workspace_access', coalesce(v_access, array['Admin','Partner','Driver']::text[]),
    'workspace_switcher_visible', coalesce(v_visible, true)
  );
end;
$$;

revoke all on function public.get_igo_current_workspace_access() from public, anon;
grant execute on function public.get_igo_current_workspace_access() to authenticated;

create or replace function public.set_igo_managed_admin_access(
  p_user_id uuid,
  p_role text,
  p_workspace_access text[],
  p_workspace_switcher_visible boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access text[] := coalesce(p_workspace_access, array[]::text[]);
begin
  if auth.uid() is null or not public.is_igo_superadmin() then
    raise exception 'Only the owner may change manually added admin access'
      using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'You cannot change your own owner account access'
      using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('admin','staff') then
    raise exception 'Choose Admin or Staff mode'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.igo_superadmins membership where membership.user_id = p_user_id) then
    raise exception 'Superadmin access cannot be changed here'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.igo_admin_invite_audit audit
    where audit.invited_user_id = p_user_id
  ) then
    raise exception 'This account was not manually added as an admin'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_access) workspace
    where workspace not in ('Admin','Partner','Driver','Staff')
  ) or cardinality(v_access) <> cardinality(array(select distinct unnest(v_access))) then
    raise exception 'Choose each supported workspace once'
      using errcode = '22023';
  end if;
  if p_role = 'admin' and (
    not ('Admin' = any(v_access))
    or 'Staff' = any(v_access)
  ) then
    raise exception 'Admin mode requires the Admin workspace'
      using errcode = '22023';
  end if;
  if p_role = 'staff' and v_access <> array['Staff']::text[] then
    raise exception 'Staff mode only grants the Staff workspace'
      using errcode = '22023';
  end if;

  update public.profiles
    set role = p_role::public.app_role
  where id = p_user_id
    and role::text in ('admin','staff');
  if not found then
    raise exception 'The selected account is not an admin or staff account'
      using errcode = '22023';
  end if;

  update public.igo_admin_invite_audit
    set workspace_access = v_access,
        workspace_switcher_visible = coalesce(p_workspace_switcher_visible, true)
  where invited_user_id = p_user_id;
end;
$$;

revoke all on function public.set_igo_managed_admin_access(uuid,text,text[],boolean) from public, anon;
grant execute on function public.set_igo_managed_admin_access(uuid,text,text[],boolean) to authenticated;
