-- Keep partner logos in the partner record, not Auth user metadata/JWT claims.
-- Backfill any logo still present only in Auth metadata before removing it.
update public.partners as p
set logo_data_url = u.raw_user_meta_data ->> 'logo_data_url'
from auth.users as u
where p.owner_id = u.id
  and u.raw_user_meta_data ->> 'role' = 'partner'
  and u.raw_user_meta_data ? 'logo_data_url'
  and nullif(u.raw_user_meta_data ->> 'logo_data_url', '') is not null
  and p.logo_data_url is null;

create or replace function public.strip_igo_partner_logo_from_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.raw_user_meta_data ->> 'role' = 'partner'
     and new.raw_user_meta_data ? 'logo_data_url' then
    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'logo_data_url'
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.strip_igo_partner_logo_from_auth_metadata() from public;

-- The existing registration trigger sorts before this one alphabetically, so
-- it can copy the optional logo into public.partners before the auth copy is stripped.
create trigger igo_public_registration_strip_logo_metadata
  after insert on auth.users
  for each row
  when (
    new.raw_user_meta_data ->> 'role' = 'partner'
    and new.raw_user_meta_data ? 'logo_data_url'
  )
  execute function public.strip_igo_partner_logo_from_auth_metadata();

-- Repair partner accounts registered before the new trigger was installed.
update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'logo_data_url'
where raw_user_meta_data ->> 'role' = 'partner'
  and raw_user_meta_data ? 'logo_data_url';
