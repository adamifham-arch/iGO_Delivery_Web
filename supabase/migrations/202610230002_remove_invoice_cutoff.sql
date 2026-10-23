-- Allow admins to remove the shared daily invoice cutoff.
-- A NULL value disables scheduled generation while preserving manual invoicing.
create or replace function public.save_invoice_cutoff(p_cutoff time without time zone)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in as an admin to save the invoice cutoff';
  end if;
  if public.current_user_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only admins may change the invoice cutoff';
  end if;

  update public.partners
  set invoice_cutoff = p_cutoff;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'No partner records were updated; the invoice cutoff was not saved';
  end if;
  return v_updated;
end;
$function$;

revoke all on function public.save_invoice_cutoff(time without time zone) from public, anon;
grant execute on function public.save_invoice_cutoff(time without time zone) to authenticated;
