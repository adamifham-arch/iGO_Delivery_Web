-- Add statuses used by the driver workflow. This is intentionally separate
-- from migrations that reference the new enum values (Postgres enum values
-- must commit before they can be used).
alter type public.package_status add value if not exists 'failed_attempt';
alter type public.package_status add value if not exists 'at_godown';
alter type public.package_status add value if not exists 'cancelled';
