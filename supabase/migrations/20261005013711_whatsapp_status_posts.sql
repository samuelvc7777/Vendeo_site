-- Migration: 20261004100000_whatsapp_status_posts.sql
-- Descrição: Tabela para histórico de publicações de Status/Stories do WhatsApp pelo Vendeo.
-- Não destrutiva, idempotente (IF NOT EXISTS).

create table if not exists public.whatsapp_status_posts (
  id uuid primary key default gen_random_uuid(),
  whatsapp_status_id text,
  type text not null check (type in ('text', 'image', 'video')),
  text_content text,
  background_color text,
  font_index integer default 0,
  media_url text,
  caption text,
  mime_type text,
  file_size bigint,
  duration_seconds integer,
  status text not null default 'sent' check (status in ('pending', 'sent', 'failed')),
  error_message text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_status_posts_created_at
  on public.whatsapp_status_posts (created_at desc);

create index if not exists idx_whatsapp_status_posts_idempotency
  on public.whatsapp_status_posts (idempotency_key)
  where idempotency_key is not null;

-- RLS
alter table public.whatsapp_status_posts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'whatsapp_status_posts' and policyname = 'Permitir leitura de status_posts para todos'
  ) then
    create policy "Permitir leitura de status_posts para todos"
      on public.whatsapp_status_posts
      for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'whatsapp_status_posts' and policyname = 'Permitir insercao de status_posts para todos'
  ) then
    create policy "Permitir insercao de status_posts para todos"
      on public.whatsapp_status_posts
      for insert
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'whatsapp_status_posts' and policyname = 'Permitir atualizacao de status_posts para todos'
  ) then
    create policy "Permitir atualizacao de status_posts para todos"
      on public.whatsapp_status_posts
      for update
      using (true)
      with check (true);
  end if;
end $$;
