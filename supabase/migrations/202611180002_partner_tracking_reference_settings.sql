alter table public.packages
  add column if not exists partner_tracking_reference text;

alter table public.partners
  add column if not exists tracking_reference_format text,
  add column if not exists tracking_reference_next integer not null default 1;

create unique index if not exists packages_partner_tracking_reference_unique
  on public.packages(partner_id, partner_tracking_reference)
  where partner_tracking_reference is not null and partner_tracking_reference <> '';

create or replace function public.assign_partner_tracking_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_format text;
  v_prefix text;
  v_width integer;
  v_next integer;
  v_digits text;
begin
  if new.partner_tracking_reference is null or btrim(new.partner_tracking_reference) = '' then
    update public.partners
    set tracking_reference_next = greatest(coalesce(tracking_reference_next, 1), 1) + 1
    where id = new.partner_id
      and tracking_reference_format ~ '^[A-Za-z0-9][A-Za-z0-9/-]*0+$'
    returning tracking_reference_format, tracking_reference_next - 1
    into v_format, v_next;

    if not found then
      return new;
    end if;

    v_prefix := regexp_replace(v_format, '0+$', '');
    v_width := length(v_format) - length(v_prefix);
    if v_width < 1 or v_prefix = '' then
      return new;
    end if;

    new.partner_tracking_reference := v_prefix ||
      case when length(v_next::text) > v_width then v_next::text
        else lpad(v_next::text, v_width, '0') end;
    return new;
  end if;

  select tracking_reference_format
  into v_format
  from public.partners
  where id = new.partner_id;

  if v_format is null or v_format !~ '^[A-Za-z0-9][A-Za-z0-9/-]*0+$' then
    return new;
  end if;

  v_prefix := regexp_replace(v_format, '0+$', '');
  if left(new.partner_tracking_reference, length(v_prefix)) = v_prefix then
    v_digits := substring(new.partner_tracking_reference from length(v_prefix) + 1);
    if v_digits ~ '^[0-9]+$' then
      update public.partners
      set tracking_reference_next = greatest(coalesce(tracking_reference_next, 1), v_digits::integer + 1)
      where id = new.partner_id;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists packages_assign_partner_tracking_reference on public.packages;

create trigger packages_assign_partner_tracking_reference
before insert on public.packages
for each row
execute function public.assign_partner_tracking_reference();
