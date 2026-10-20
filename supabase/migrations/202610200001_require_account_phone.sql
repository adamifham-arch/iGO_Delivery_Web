begin;

update public.partners as partner
set phone = profile.phone
from public.profiles as profile
where profile.id = partner.owner_id
  and nullif(btrim(partner.phone), '') is null
  and nullif(btrim(profile.phone), '') is not null;

update public.drivers as driver
set phone = profile.phone
from public.profiles as profile
where profile.id = driver.user_id
  and nullif(btrim(driver.phone), '') is null
  and nullif(btrim(profile.phone), '') is not null;

alter table public.profiles alter column phone set not null;
alter table public.partners alter column phone set not null;
alter table public.drivers alter column phone set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_phone_not_blank') then
    alter table public.profiles add constraint profiles_phone_not_blank check (length(btrim(phone)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.partners'::regclass and conname = 'partners_phone_not_blank') then
    alter table public.partners add constraint partners_phone_not_blank check (length(btrim(phone)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.drivers'::regclass and conname = 'drivers_phone_not_blank') then
    alter table public.drivers add constraint drivers_phone_not_blank check (length(btrim(phone)) > 0);
  end if;
end $$;

commit;