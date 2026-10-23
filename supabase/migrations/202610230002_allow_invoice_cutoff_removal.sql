-- NULL represents a disabled shared daily invoice cutoff.
alter table public.partners
  alter column invoice_cutoff drop not null;
