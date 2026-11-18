alter table public.packages
  add column if not exists partner_tracking_reference text;

alter table public.partners
  add column if not exists tracking_reference_format text,
  add column if not exists tracking_reference_next integer not null default 1;

create or replace function public.assign_partner_tracking_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  format_value text;
  sequence_value integer;
  prefix_value text;
  padding_width integer;
begin
  if nullif(btrim(new.partner_tracking_reference), '') is not null then
    new.partner_tracking_reference := btrim(new.partner_tracking_reference);
    return new;
  end if;

  update public.partners
  set tracking_reference_next = greatest(coalesce(tracking_reference_next, 1), 1) + 1
  where id = new.partner_id
    and coalesce(tracking_reference_format, '') ~ '.*0+$'
  returning tracking_reference_format, tracking_reference_next - 1
    into format_value, sequence_value;

  if format_value is null then
    return new;
  end if;

  prefix_value := regexp_replace(format_value, '0+$', '');
  padding_width := length(format_value) - length(prefix_value);
  if padding_width < 1 or prefix_value = '' then
    return new;
  end if;

  new.partner_tracking_reference :=
    prefix_value || lpad(sequence_value::text, padding_width, '0');
  return new;
end;
$$;

drop trigger if exists packages_assign_partner_tracking_reference on public.packages;
create trigger packages_assign_partner_tracking_reference
before insert on public.packages
for each row
execute function public.assign_partner_tracking_reference();
