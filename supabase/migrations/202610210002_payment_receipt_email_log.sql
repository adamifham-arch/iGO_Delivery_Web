create table if not exists public.payment_receipt_emails (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  recipient text not null,
  status text not null check (status in ('queued','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.payment_receipt_emails enable row level security;
revoke all on public.payment_receipt_emails from anon, authenticated;
