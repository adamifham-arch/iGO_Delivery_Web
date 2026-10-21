-- Record the authenticated administrator who manually invited each admin account.
create table if not exists public.igo_admin_invite_audit (
  invited_user_id uuid primary key references public.profiles(id) on delete cascade,
  invited_by_user_id uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now()
);

alter table public.igo_admin_invite_audit enable row level security;
revoke all on table public.igo_admin_invite_audit from anon, authenticated;

create or replace function public.record_igo_admin_inviter(p_invited_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invited_user_id uuid;
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not exists (
    select 1
    from public.profiles as actor
    where actor.id = v_actor_id
      and actor.role::text = 'admin'
  ) then
    raise exception 'Only signed-in admins can record an admin invitation'
      using errcode = '42501';
  end if;

  select profile.id
    into v_invited_user_id
  from public.profiles as profile
  join auth.users as invited_user on invited_user.id = profile.id
  where profile.role::text = 'admin'
    and lower(invited_user.email) = lower(trim(p_invited_email))
    and profile.created_at >= now() - interval '15 minutes'
  order by profile.created_at desc
  limit 1;

  if v_invited_user_id is null then
    raise exception 'Could not find a newly created admin account for that email'
      using errcode = '22023';
  end if;

  insert into public.igo_admin_invite_audit (invited_user_id, invited_by_user_id)
  values (v_invited_user_id, v_actor_id)
  on conflict (invited_user_id) do nothing;
end;
$$;

revoke all on function public.record_igo_admin_inviter(text) from public;
revoke all on function public.record_igo_admin_inviter(text) from anon;
grant execute on function public.record_igo_admin_inviter(text) to authenticated;

create or replace function public.list_igo_admin_invite_audit()
returns table (
  invited_user_id uuid,
  invited_by_name text,
  invited_by_email text,
  invited_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles as actor
    where actor.id = auth.uid()
      and actor.role::text = 'admin'
  ) then
    raise exception 'Only signed-in admins can view admin invitation records'
      using errcode = '42501';
  end if;

  return query
    select audit.invited_user_id,
           inviter.full_name,
           inviter_user.email,
           audit.invited_at
    from public.igo_admin_invite_audit as audit
    left join public.profiles as inviter on inviter.id = audit.invited_by_user_id
    left join auth.users as inviter_user on inviter_user.id = audit.invited_by_user_id;
end;
$$;

revoke all on function public.list_igo_admin_invite_audit() from public;
revoke all on function public.list_igo_admin_invite_audit() from anon;
grant execute on function public.list_igo_admin_invite_audit() to authenticated;
