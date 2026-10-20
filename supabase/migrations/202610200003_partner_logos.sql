-- Store partner brand marks submitted with public partner applications.
alter table public.partners
  add column if not exists logo_data_url text;

create or replace function public.handle_igo_public_registration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role public.app_role;
  v_full_name text;
  v_phone text;
  v_business_name text;
  v_address text;
  v_logo_data_url text;
begin
  if coalesce(new.raw_user_meta_data ->> 'igo_self_registration', 'false') <> 'true' then
    return new;
  end if;

  if new.raw_user_meta_data ->> 'role' not in ('partner', 'driver') then
    raise exception 'Public iGO registration only supports partner and driver accounts';
  end if;

  v_role := (new.raw_user_meta_data ->> 'role')::public.app_role;
  v_full_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');
  v_business_name := nullif(btrim(new.raw_user_meta_data ->> 'business_name'), '');
  v_address := nullif(btrim(new.raw_user_meta_data ->> 'address'), '');
  v_logo_data_url := nullif(btrim(new.raw_user_meta_data ->> 'logo_data_url'), '');

  if v_full_name is null or v_phone is null then
    raise exception 'A full name and registered phone number are required';
  end if;

  insert into public.profiles (id, full_name, phone, role)
  values (new.id, v_full_name, v_phone, v_role)
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        role = excluded.role;

  if v_role = 'partner'::public.app_role then
    if v_business_name is null or v_address is null then
      raise exception 'A business name and address are required for partner registration';
    end if;

    if v_logo_data_url is not null and (
      length(v_logo_data_url) > 360000
      or v_logo_data_url !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    ) then
      raise exception 'Partner logos must be small PNG, JPEG, or WebP images';
    end if;

    insert into public.partners (
      owner_id, name, contact_name, phone, email, address, approval_status, logo_data_url
    ) values (
      new.id, v_business_name, v_full_name, v_phone, new.email, v_address,
      'pending'::public.partner_approval, v_logo_data_url
    );
  else
    insert into public.drivers (
      user_id, name, phone, active, approval_status
    ) values (
      new.id, v_full_name, v_phone, false, 'pending'::public.partner_approval
    );
  end if;

  return new;
end;
$$;

revoke all on function public.handle_igo_public_registration() from public;
