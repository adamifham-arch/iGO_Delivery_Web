-- Add the internal staff role before creating staff workflow objects.
-- Keep existing owner/admin, partner, and driver roles unchanged.
alter type public.app_role add value if not exists 'staff';
