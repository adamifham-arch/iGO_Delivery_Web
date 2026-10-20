-- Allow partners to update their own logo while keeping ownership, approval, and billing fields admin-only.
do $migration$
declare
  v_definition text;
  v_old text := $old$array['name','contact_name','phone','email','page_url','address']$old$;
  v_new text := $new$array['name','contact_name','phone','email','page_url','address','logo_data_url']$new$;
begin
  select pg_get_functiondef('public.guard_igo_updates()'::regprocedure) into v_definition;
  if position(v_new in v_definition) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception 'Expected partner update allow-list was not found';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;