-- Optional Supabase pg_cron scheduler. Runs once per Maldives-local day at
-- each partner's saved cutoff time (checked once per minute).
create extension if not exists pg_cron;

-- Allow the private scheduler to call the existing generator without opening
-- invoice generation to anonymous or partner/driver sessions.
create or replace function public.generate_delivered_invoices(p_partner_id uuid default null)
returns setof public.invoices
language plpgsql security definer set search_path = '' as $function$
declare
  v_group record;
  v_invoice public.invoices%rowtype;
  v_items integer;
begin
  if auth.uid() is null then
    if pg_catalog.current_setting('igo.invoice_cutoff_worker', true) is distinct from 'yes' then
      raise exception 'Only the internal cutoff worker may run without an authenticated admin';
    end if;
  elsif public.current_user_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only authenticated admins may generate invoices';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(8427319001);
  for v_group in
    select p.partner_id, pg_catalog.min(p.delivered_at) as period_start,
      pg_catalog.max(p.delivered_at) as period_end, pg_catalog.sum(p.delivery_fee) as subtotal
    from public.packages p
    where p.status = 'delivered'::public.package_status and p.delivered_at is not null
      and (p_partner_id is null or p.partner_id = p_partner_id)
      and not exists (select 1 from public.invoice_items ii where ii.package_id = p.id)
    group by p.partner_id order by p.partner_id
  loop
    insert into public.invoices(partner_id,invoice_number,period_start,period_end,subtotal)
    values (v_group.partner_id,
      'INV-' || pg_catalog.to_char(pg_catalog.clock_timestamp(),'YYYYMMDD') || '-' ||
      pg_catalog.upper(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','')),
      v_group.period_start,v_group.period_end,v_group.subtotal)
    returning * into v_invoice;
    insert into public.invoice_items(invoice_id,package_id,amount)
    select v_invoice.id,p.id,p.delivery_fee from public.packages p
    where p.partner_id=v_group.partner_id and p.status='delivered'::public.package_status
      and p.delivered_at is not null
      and not exists(select 1 from public.invoice_items ii where ii.package_id=p.id)
    on conflict(package_id) do nothing;
    get diagnostics v_items = row_count;
    if v_items = 0 then
      delete from public.invoices where id=v_invoice.id;
      continue;
    end if;
    update public.invoices i set subtotal=(select pg_catalog.sum(ii.amount) from public.invoice_items ii where ii.invoice_id=v_invoice.id)
      where i.id=v_invoice.id returning * into v_invoice;
    insert into public.notifications(user_id,title,message)
    select p.owner_id,'Invoice available','Invoice ' || v_invoice.invoice_number || ' is ready. Total: MVR ' ||
      pg_catalog.btrim(pg_catalog.to_char(v_invoice.subtotal,'FM999999999999990.00')) || '. Transfer payment and submit your receipt.'
    from public.partners p where p.id=v_invoice.partner_id and p.owner_id is not null;
    return next v_invoice;
  end loop;
  return;
end;
$function$;

create or replace function public.process_invoice_cutoffs()
returns integer language plpgsql security definer set search_path = '' as $function$
declare
  v_partner record;
  v_count integer;
  v_total integer := 0;
begin
  perform pg_catalog.set_config('igo.invoice_cutoff_worker','yes',true);
  for v_partner in
    select p.id from public.partners p
    where p.approval_status='approved'::public.partner_approval
      and p.invoice_cutoff is not null
      and p.invoice_cutoff <= (pg_catalog.now() at time zone 'Indian/Maldives')::time
      and p.last_invoice_local_date is distinct from (pg_catalog.now() at time zone 'Indian/Maldives')::date
    order by p.id for update skip locked
  loop
    perform * from public.generate_delivered_invoices(v_partner.id);
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    update public.partners set
      last_invoice_cutoff_at=pg_catalog.now(),
      last_invoice_local_date=(pg_catalog.now() at time zone 'Indian/Maldives')::date
    where id=v_partner.id;
  end loop;
  return v_total;
end;
$function$;
revoke all on function public.process_invoice_cutoffs() from public, anon, authenticated;

do $schedule$
begin
  if not exists (select 1 from cron.job where jobname='igo-daily-invoice-cutoff') then
    perform cron.schedule('igo-daily-invoice-cutoff','* * * * *','select public.process_invoice_cutoffs();');
  end if;
end;
$schedule$;
