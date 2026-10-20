-- Allow each authenticated partner to add or replace only their own logo.
create or replace function public.save_igo_partner_logo(p_logo_data_url text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sign in to update the partner logo';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'partner'::public.app_role
  ) then
    raise exception 'Only partner accounts can update a partner logo';
  end if;

  if p_logo_data_url is not null and (
    length(p_logo_data_url) > 360000
    or p_logo_data_url !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  ) then
    raise exception 'Partner logos must be small PNG, JPEG, or WebP images';
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
