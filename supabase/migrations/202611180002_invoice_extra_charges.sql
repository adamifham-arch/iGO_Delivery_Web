-- Add itemized invoice charges for partner-billed costs paid by iGO.
-- Admins can add charges before payment activity; the designated Superadmin can
-- adjust charges on invoices after a payment has been submitted.

alter table public.profiles
  add column if not exists is_superadmin boolean not null default false;

create or replace function public.current_user_is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select p.is_superadmin from public.profiles p where p.id = auth.uid()
  ), false)
$function$;

revoke all on function public.current_user_is_superadmin() from public, anon;
grant execute on function public.current_user_is_superadmin() to authenticated;

do $block$
declare v_matches integer;
begin
  select count(*) into v_matches
  from public.profiles
  where role = 'admin'::public.app_role
    and pg_catalog.lower(pg_catalog.btrim(full_name)) = 'adam ifham';

  if v_matches = 1 then
    update public.profiles
    set is_superadmin = true
    where role = 'admin'::public.app_role
      and pg_catalog.lower(pg_catalog.btrim(full_name)) = 'adam ifham';
  else
    raise notice 'Superadmin account was not assigned: expected one admin profile named Adam Ifham, found %.', v_matches;
  end if;
end
$block$;

create or replace function public.guard_superadmin_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.is_superadmin and not public.current_user_is_superadmin() then
      raise exception 'Only the current Superadmin can designate a Superadmin';
    end if;
  elsif new.is_superadmin is distinct from old.is_superadmin
    and not public.current_user_is_superadmin() then
    raise exception 'Only the current Superadmin can change Superadmin access';
  end if;
  return new;
end
$function$;

drop trigger if exists profiles_guard_superadmin_flag on public.profiles;
create trigger profiles_guard_superadmin_flag
  before insert or update of is_superadmin on public.profiles
  for each row execute function public.guard_superadmin_flag();

create table if not exists public.invoice_charges (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 160),
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists invoice_charges_invoice_created_idx
  on public.invoice_charges(invoice_id, created_at);

alter table public.invoice_charges enable row level security;
drop policy if exists "Invoice participants can read charges" on public.invoice_charges;
create policy "Invoice participants can read charges"
  on public.invoice_charges for select to authenticated
  using (
    exists (
      select 1
      from public.invoices i
      join public.partners p on p.id = i.partner_id
      where i.id = invoice_charges.invoice_id
        and (
          public.current_user_role() = 'admin'::public.app_role
          or p.owner_id = auth.uid()
        )
    )
  );

revoke all on public.invoice_charges from anon, authenticated;
grant select on public.invoice_charges to authenticated;

create or replace function public.add_invoice_charge(
  p_invoice_id uuid,
  p_description text,
  p_amount numeric
)
returns public.invoice_charges
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invoice public.invoices%rowtype;
  v_charge public.invoice_charges%rowtype;
  v_total numeric(12,2);
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only admins can add invoice charges';
  end if;
  if p_description is null or pg_catalog.length(pg_catalog.btrim(p_description)) not between 1 and 160 then
    raise exception 'Enter a charge description up to 160 characters';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Charge amount must be greater than zero';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then raise exception 'Invoice not found'; end if;

  if not public.current_user_is_superadmin() and (
    coalesce(v_invoice.paid_amount, 0) > 0
    or exists (
      select 1 from public.payments pay
      where pay.target_invoice_id = p_invoice_id
        and pay.status is distinct from 'rejected'::public.payment_status
    )
    or exists (
      select 1 from public.payment_allocations pa
      where pa.invoice_id = p_invoice_id
    )
  ) then
    raise exception 'Only the Superadmin can change an invoice after a payment is submitted';
  end if;

  insert into public.invoice_charges(invoice_id, description, amount, created_by)
  values (p_invoice_id, pg_catalog.btrim(p_description), pg_catalog.round(p_amount, 2), auth.uid())
  returning * into v_charge;

  select
    (select coalesce(pg_catalog.sum(ii.amount), 0) from public.invoice_items ii where ii.invoice_id = p_invoice_id)
    +
    (select coalesce(pg_catalog.sum(ic.amount), 0) from public.invoice_charges ic where ic.invoice_id = p_invoice_id)
  into v_total;

  update public.invoices
  set subtotal = v_total,
      status = case
        when coalesce(paid_amount, 0) >= v_total then 'paid'::public.invoice_status
        when coalesce(paid_amount, 0) > 0 then 'partially_paid'::public.invoice_status
        else 'unpaid'::public.invoice_status
      end
  where id = p_invoice_id;

  return v_charge;
end
$function$;

revoke all on function public.add_invoice_charge(uuid, text, numeric) from public, anon;
grant execute on function public.add_invoice_charge(uuid, text, numeric) to authenticated;
