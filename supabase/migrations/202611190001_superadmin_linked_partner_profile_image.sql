-- Permit the superadmin to update only the partner profile linked to their own account.
-- Regular partner accounts remain limited to their own partner profile.
create or replace function public.save_igo_partner_logo(p_logo_data_url text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_partner boolean;
  v_is_superadmin boolean;
begin
  if v_user_id is null then
    raise exception 'Sign in to update the partner profile image';
  end if;

  select exists (
    select 1
    from public.profiles
    where id = v_user_id
      and role = 'partner'::public.app_role
  ) into v_is_partner;

  v_is_superadmin := coalesce(public.is_igo_superadmin(), false);

  if not v_is_partner and not v_is_superadmin then
    raise exception 'Only the partner or superadmin linked to this partner profile can update its image';
  end if;

  if p_logo_data_url is not null and (
    length(p_logo_data_url) > 360000
    or p_logo_data_url !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  ) then
    raise exception 'Partner profile images must be small PNG, JPEG, or WebP images';
  end if;

  update public.partners
  set logo_data_url = p_logo_data_url
  where owner_id = v_user_id;

  if not found then
    raise exception 'No partner profile is linked to this account';
  end if;
end;
$$;

revoke all on function public.save_igo_partner_logo(text) from public;
grant execute on function public.save_igo_partner_logo(text) to authenticated;
