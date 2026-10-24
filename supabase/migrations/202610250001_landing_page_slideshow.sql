-- Public landing slideshow, its shared visibility setting, and public image storage.

alter table public.public_site_settings
  drop constraint if exists public_site_settings_key_check;
alter table public.public_site_settings
  add constraint public_site_settings_key_check
  check (key in ('show_rider_card', 'show_slideshow_card'));

insert into public.public_site_settings (key, value)
values ('show_slideshow_card', 'false'::jsonb)
on conflict (key) do nothing;

drop policy if exists "Public can read rider card visibility" on public.public_site_settings;
create policy "Public can read rider card visibility"
  on public.public_site_settings for select to anon, authenticated
  using (key in ('show_rider_card', 'show_slideshow_card'));

drop policy if exists "Superadmin can insert rider card visibility" on public.public_site_settings;
create policy "Superadmin can insert rider card visibility"
  on public.public_site_settings for insert to authenticated
  with check (key in ('show_rider_card', 'show_slideshow_card') and public.is_igo_superadmin());

drop policy if exists "Superadmin can update rider card visibility" on public.public_site_settings;
create policy "Superadmin can update rider card visibility"
  on public.public_site_settings for update to authenticated
  using (key in ('show_rider_card', 'show_slideshow_card') and public.is_igo_superadmin())
  with check (key in ('show_rider_card', 'show_slideshow_card') and public.is_igo_superadmin());

create table if not exists public.landing_page_slides (
  id uuid primary key default gen_random_uuid(),
  image_path text not null unique,
  alt_text text not null,
  caption text not null default '',
  display_order integer not null default 0 check (display_order >= 0),
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.landing_page_slides enable row level security;
grant select on public.landing_page_slides to anon, authenticated;
grant insert, update, delete on public.landing_page_slides to authenticated;

drop policy if exists "Public can read visible landing page slides" on public.landing_page_slides;
create policy "Public can read visible landing page slides"
  on public.landing_page_slides for select to anon, authenticated
  using (is_visible);

drop policy if exists "Superadmin can manage landing page slides" on public.landing_page_slides;
create policy "Superadmin can manage landing page slides"
  on public.landing_page_slides for all to authenticated
  using (public.is_igo_superadmin())
  with check (public.is_igo_superadmin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'landing-page-slides',
  'landing-page-slides',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read landing page slide images" on storage.objects;
create policy "Public can read landing page slide images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'landing-page-slides');

drop policy if exists "Superadmin can upload landing page slide images" on storage.objects;
create policy "Superadmin can upload landing page slide images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'landing-page-slides' and public.is_igo_superadmin());

drop policy if exists "Superadmin can update landing page slide images" on storage.objects;
create policy "Superadmin can update landing page slide images"
  on storage.objects for update to authenticated
  using (bucket_id = 'landing-page-slides' and public.is_igo_superadmin())
  with check (bucket_id = 'landing-page-slides' and public.is_igo_superadmin());

drop policy if exists "Superadmin can delete landing page slide images" on storage.objects;
create policy "Superadmin can delete landing page slide images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'landing-page-slides' and public.is_igo_superadmin());
