-- Admin-only manual notifications with per-recipient in-app and Telegram delivery history.
create table if not exists public.manual_notification_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  message text not null,
  recipient_scope text not null,
  channels text[] not null,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint manual_notification_channels_valid check (channels <@ array['in_app','telegram']::text[] and cardinality(channels) > 0)
);

create table if not exists public.manual_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.manual_notification_batches(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_name text not null,
  recipient_email text not null default '',
  recipient_role text not null,
  notification_id text,
  in_app_status text not null check (in_app_status in ('not_requested','delivered')),
  telegram_status text not null check (telegram_status in ('not_requested','pending','sent','failed','not_connected')),
  telegram_error text,
  telegram_attempted_at timestamptz,
  telegram_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, recipient_user_id)
);

create index if not exists manual_notification_batches_created_idx
  on public.manual_notification_batches(created_at desc);
create index if not exists manual_notification_deliveries_batch_idx
  on public.manual_notification_deliveries(batch_id);
create index if not exists manual_notification_deliveries_notification_idx
  on public.manual_notification_deliveries(notification_id) where notification_id is not null;

alter table public.manual_notification_batches enable row level security;
alter table public.manual_notification_deliveries enable row level security;
revoke all on public.manual_notification_batches, public.manual_notification_deliveries from anon, authenticated;
grant all on public.manual_notification_batches, public.manual_notification_deliveries to service_role;

create or replace function public.list_manual_notification_recipients()
returns table(user_id uuid, display_name text, email text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_igo_full_admin() then
    raise exception 'Only full admins may send manual notifications' using errcode = '42501';
  end if;

  return query
  select p.id,
    coalesce(nullif(pg_catalog.btrim(p.full_name), ''), nullif(u.email, ''), 'iGO user'),
    coalesce(u.email, ''),
    p.role::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id <> auth.uid()
    and p.role::text in ('partner','driver','staff','admin')
  order by p.role::text, coalesce(nullif(pg_catalog.btrim(p.full_name), ''), u.email);
end;
$function$;

create or replace function public.prepare_manual_notification_send(
  p_title text,
  p_message text,
  p_scope text,
  p_user_ids uuid[] default '{}'::uuid[],
  p_channels text[] default array['in_app','telegram']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch_id uuid;
  v_count integer;
  v_in_app boolean;
  v_telegram boolean;
  v_user record;
  v_notification_id text;
  v_recipients jsonb := '[]'::jsonb;
  v_ids uuid[] := coalesce(p_user_ids, '{}'::uuid[]);
begin
  if auth.uid() is null or not public.is_igo_full_admin() then
    raise exception 'Only full admins may send manual notifications' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_title), '') is null or pg_catalog.length(pg_catalog.btrim(p_title)) > 100 then
    raise exception 'Enter a title of 1 to 100 characters' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(p_message), '') is null or pg_catalog.length(pg_catalog.btrim(p_message)) > 2000 then
    raise exception 'Enter a message of 1 to 2000 characters' using errcode = '22023';
  end if;
  if p_scope not in ('all','partner','driver','staff','admin','selected') then
    raise exception 'Choose a valid recipient group' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_channels), 0) = 0
     or not (p_channels <@ array['in_app','telegram']::text[]) then
    raise exception 'Choose at least one delivery method' using errcode = '22023';
  end if;
  if p_scope = 'selected' then
    if cardinality(v_ids) = 0 or cardinality(v_ids) > 300 then
      raise exception 'Select between 1 and 300 users' using errcode = '22023';
    end if;
    select count(distinct p.id) into v_count
      from public.profiles p
      where p.id = any(v_ids) and p.id <> auth.uid()
        and p.role::text in ('partner','driver','staff','admin');
    if v_count <> cardinality(v_ids) then
      raise exception 'One or more selected accounts are unavailable' using errcode = '22023';
    end if;
  else
    select count(*) into v_count from public.profiles p
    where p.id <> auth.uid()
      and p.role::text in ('partner','driver','staff','admin')
      and (p_scope = 'all' or p.role::text = p_scope);
    if v_count > 300 then
      raise exception 'This recipient group exceeds the 300-user send limit; choose a smaller group' using errcode = '22023';
    end if;
  end if;
  if v_count = 0 then
    raise exception 'There are no recipients in this group' using errcode = '22023';
  end if;

  v_in_app := 'in_app' = any(p_channels);
  v_telegram := 'telegram' = any(p_channels);
  insert into public.manual_notification_batches(created_by,title,message,recipient_scope,channels,recipient_count)
  values(auth.uid(),pg_catalog.btrim(p_title),pg_catalog.btrim(p_message),p_scope,p_channels,v_count)
  returning id into v_batch_id;

  for v_user in
    select p.id,
      coalesce(nullif(pg_catalog.btrim(p.full_name), ''), nullif(u.email, ''), 'iGO user') as display_name,
      coalesce(u.email, '') as email,
      p.role::text as user_role
    from public.profiles p
    join auth.users u on u.id=p.id
    where p.id <> auth.uid()
      and p.role::text in ('partner','driver','staff','admin')
      and ((p_scope = 'selected' and p.id = any(v_ids)) or (p_scope = 'all') or (p.role::text = p_scope))
    order by p.role::text, display_name
  loop
    insert into public.manual_notification_deliveries(
      batch_id,recipient_user_id,recipient_name,recipient_email,recipient_role,
      in_app_status,telegram_status
    ) values (
      v_batch_id,v_user.id,v_user.display_name,v_user.email,v_user.user_role,
      case when v_in_app then 'delivered' else 'not_requested' end,
      case when v_telegram then 'pending' else 'not_requested' end
    );

    if v_in_app then
      insert into public.notifications(user_id,title,message)
      values(v_user.id,pg_catalog.btrim(p_title),pg_catalog.btrim(p_message))
      returning id::text into v_notification_id;
      update public.manual_notification_deliveries
        set notification_id=v_notification_id
        where batch_id=v_batch_id and recipient_user_id=v_user.id;
    end if;

    v_recipients := v_recipients || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('user_id',v_user.id,'display_name',v_user.display_name,'email',v_user.email,'role',v_user.user_role)
    );
  end loop;

  return pg_catalog.jsonb_build_object('batch_id',v_batch_id,'recipient_count',v_count,'channels',p_channels,'recipients',v_recipients);
end;
$function$;

create or replace function public.prepare_manual_notification_retry(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch public.manual_notification_batches%rowtype;
  v_recipients jsonb;
begin
  if auth.uid() is null or not public.is_igo_full_admin() then
    raise exception 'Only full admins may retry manual notifications' using errcode = '42501';
  end if;
  select * into v_batch from public.manual_notification_batches where id=p_batch_id;
  if not found or not ('telegram' = any(v_batch.channels)) then
    raise exception 'Notification history not found' using errcode = '22023';
  end if;

  update public.manual_notification_deliveries
    set telegram_status='pending', telegram_error=null
    where batch_id=p_batch_id and telegram_status in ('failed','pending')
      and recipient_user_id is not null;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'user_id',d.recipient_user_id,'display_name',d.recipient_name,'email',d.recipient_email,'role',d.recipient_role
    ) order by d.recipient_name),'[]'::jsonb)
    into v_recipients
    from public.manual_notification_deliveries d
    where d.batch_id=p_batch_id and d.telegram_status='pending'
      and d.recipient_user_id is not null;

  return pg_catalog.jsonb_build_object(
    'batch_id',v_batch.id,'title',v_batch.title,'message',v_batch.message,
    'channels',v_batch.channels,'recipients',v_recipients,
    'recipient_count',pg_catalog.jsonb_array_length(v_recipients)
  );
end;
$function$;

create or replace function public.list_manual_notification_history()
returns table(
  batch_id uuid,title text,message text,recipient_scope text,channels text[],recipient_count integer,created_at timestamptz,
  in_app_delivered integer,telegram_sent integer,telegram_failed integer,telegram_pending integer,telegram_not_connected integer,
  recipients jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_igo_full_admin() then
    raise exception 'Only full admins may view manual notification history' using errcode = '42501';
  end if;
  return query
  select b.id,b.title,b.message,b.recipient_scope,b.channels,b.recipient_count,b.created_at,
    count(*) filter (where d.in_app_status='delivered')::integer,
    count(*) filter (where d.telegram_status='sent')::integer,
    count(*) filter (where d.telegram_status='failed')::integer,
    count(*) filter (where d.telegram_status='pending')::integer,
    count(*) filter (where d.telegram_status='not_connected')::integer,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'user_id',d.recipient_user_id,'display_name',d.recipient_name,'email',d.recipient_email,'role',d.recipient_role,
      'in_app_status',d.in_app_status,'telegram_status',d.telegram_status,'telegram_error',d.telegram_error
    ) order by d.recipient_name),'[]'::jsonb)
  from public.manual_notification_batches b
  join public.manual_notification_deliveries d on d.batch_id=b.id
  group by b.id
  order by b.created_at desc
  limit 50;
end;
$function$;

revoke all on function public.list_manual_notification_recipients() from public,anon;
revoke all on function public.prepare_manual_notification_send(text,text,text,uuid[],text[]) from public,anon;
revoke all on function public.prepare_manual_notification_retry(uuid) from public,anon;
revoke all on function public.list_manual_notification_history() from public,anon;
grant execute on function public.list_manual_notification_recipients() to authenticated;
grant execute on function public.prepare_manual_notification_send(text,text,text,uuid[],text[]) to authenticated;
grant execute on function public.prepare_manual_notification_retry(uuid) to authenticated;
grant execute on function public.list_manual_notification_history() to authenticated;
