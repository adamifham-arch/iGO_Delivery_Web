-- Link each iGO user to a Telegram chat for outbound notification delivery.
-- Telegram IDs and one-time linking codes are never writable by browser users.

create table if not exists public.telegram_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_chat_id text not null unique,
  telegram_username text,
  linked_at timestamptz not null default now()
);

alter table public.telegram_connections enable row level security;
revoke all on public.telegram_connections from anon, authenticated;
grant select, delete on public.telegram_connections to authenticated;

drop policy if exists "Users read own Telegram connection" on public.telegram_connections;
create policy "Users read own Telegram connection" on public.telegram_connections
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users disconnect own Telegram connection" on public.telegram_connections;
create policy "Users disconnect own Telegram connection" on public.telegram_connections
  for delete to authenticated using (user_id = auth.uid());

create table if not exists public.telegram_link_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from public, anon, authenticated;
grant all on public.telegram_link_codes to service_role;

create or replace function public.consume_telegram_link_code(
  p_code_hash text,
  p_chat_id text,
  p_username text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  delete from public.telegram_link_codes
  where code_hash = p_code_hash and expires_at > pg_catalog.now()
  returning user_id into v_user_id;

  if v_user_id is null then
    return false;
  end if;

  insert into public.telegram_connections(user_id, telegram_chat_id, telegram_username, linked_at)
  values (v_user_id, p_chat_id, nullif(pg_catalog.btrim(p_username), ''), pg_catalog.now())
  on conflict (user_id) do update
    set telegram_chat_id = excluded.telegram_chat_id,
        telegram_username = excluded.telegram_username,
        linked_at = excluded.linked_at;

  return true;
end;
$function$;

revoke all on function public.consume_telegram_link_code(text, text, text) from public, anon, authenticated;
grant execute on function public.consume_telegram_link_code(text, text, text) to service_role;

