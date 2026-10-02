create table if not exists public.whatsapp_stickers (
  id uuid primary key default gen_random_uuid(),
  sticker_url text not null unique,
  source_message_id text,
  title text,
  usage_count integer not null default 0 check (usage_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_stickers_created_at_idx
  on public.whatsapp_stickers (created_at desc);

alter table public.whatsapp_stickers enable row level security;

revoke all on table public.whatsapp_stickers from anon, authenticated;
grant all on table public.whatsapp_stickers to service_role;
