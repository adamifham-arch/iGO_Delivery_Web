-- Expose registered account email addresses to signed-in admins only.
create or replace function public.list_igo_account_contact_emails()
returns table (user_id uuid, email text)
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
    raise exception 'Only signed-in admins can view account contact emails'
      using errcode = '42501';
  end if;

  return query
    select profile.id, auth_user.email::text
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id;
end;
$$;

revoke all on function public.list_igo_account_contact_emails() from public;
revoke all on function public.list_igo_account_contact_emails() from anon;
grant execute on function public.list_igo_account_contact_emails() to authenticated;
