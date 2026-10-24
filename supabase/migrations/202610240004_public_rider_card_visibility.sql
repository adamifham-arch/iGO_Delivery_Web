-- Public landing-page visibility controls.
-- Public visitors may read the rider-card flag; only the superadmin can change it.

create table if not exists public.public_site_settings (
  key text primary key check (key = 'show_rider_card'),
  value jsonb not null default 'false'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.public_site_settings enable row level security;

insert into public.public_site_settings (key, value)
values ('show_rider_card', 'false'::jsonb)
on conflict (key) do nothing;

grant select on public.public_site_settings to anon, authenticated;
grant insert, update on public.public_site_settings to authenticated;

drop policy if exists "Public can read rider card visibility" on public.public_site_settings;
create policy "Public can read rider card visibility"
  on public.public_site_settings
  for select
  to anon, authenticated
  using (key = 'show_rider_card');

drop policy if exists "Superadmin can insert rider card visibility" on public.public_site_settings;
create policy "Superadmin can insert rider card visibility"
  on public.public_site_settings
  for insert
  to authenticated
  with check (key = 'show_rider_card' and public.is_igo_superadmin());

drop policy if exists "Superadmin can update rider card visibility" on public.public_site_settings;
create policy "Superadmin can update rider card visibility"
  on public.public_site_settings
  for update
  to authenticated
  using (key = 'show_rider_card' and public.is_igo_superadmin())
  with check (key = 'show_rider_card' and public.is_igo_superadmin());
