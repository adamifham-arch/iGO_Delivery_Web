-- Allow the superadmin-managed landing page copy and slideshow transition settings.
-- Public visitors can read these display settings; only the superadmin may change them.

alter table public.public_site_settings
  drop constraint if exists public_site_settings_key_check;

alter table public.public_site_settings
  add constraint public_site_settings_key_check
  check (key in (
    'show_rider_card',
    'show_slideshow_card',
    'landing_hero_copy',
    'slideshow_transition'
  ));

insert into public.public_site_settings (key, value)
values
  ('landing_hero_copy', '{"title":"Focus on your business. We’ll handle the deliveries.","subtitle":"Best rates. Fast delivery."}'::jsonb),
  ('slideshow_transition', '"fade"'::jsonb)
on conflict (key) do nothing;

drop policy if exists "Public can read rider card visibility" on public.public_site_settings;
create policy "Public can read rider card visibility"
  on public.public_site_settings for select to anon, authenticated
  using (key in (
    'show_rider_card',
    'show_slideshow_card',
    'landing_hero_copy',
    'slideshow_transition'
  ));

drop policy if exists "Superadmin can insert rider card visibility" on public.public_site_settings;
create policy "Superadmin can insert rider card visibility"
  on public.public_site_settings for insert to authenticated
  with check (
    key in (
      'show_rider_card',
      'show_slideshow_card',
      'landing_hero_copy',
      'slideshow_transition'
    )
    and public.is_igo_superadmin()
  );

drop policy if exists "Superadmin can update rider card visibility" on public.public_site_settings;
create policy "Superadmin can update rider card visibility"
  on public.public_site_settings for update to authenticated
  using (
    key in (
      'show_rider_card',
      'show_slideshow_card',
      'landing_hero_copy',
      'slideshow_transition'
    )
    and public.is_igo_superadmin()
  )
  with check (
    key in (
      'show_rider_card',
      'show_slideshow_card',
      'landing_hero_copy',
      'slideshow_transition'
    )
    and public.is_igo_superadmin()
  );
