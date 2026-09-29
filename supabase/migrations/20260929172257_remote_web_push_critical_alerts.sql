-- Push remoto crítico: assinaturas Web Push + configuração VAPID + deduplicação de eventos.
-- Somente service_role pode ler/gravar. O operador registra assinatura via Edge Function autenticada.

create table if not exists public.web_push_runtime_config (
  id text primary key default 'default',
  vapid_public_key text not null,
  vapid_private_key text not null,
  subject text not null default 'https://vendeo-e755e.web.app',
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint web_push_runtime_config_singleton check (id = 'default')
);

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  failure_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz
);

create table if not exists public.web_push_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('manual_resolution_required','workflow_finalized')),
  conversation_id text not null references public.instagram_conversations(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  success_count integer not null default 0,
  failure_count integer not null default 0
);

create index if not exists web_push_subscriptions_enabled_idx
  on public.web_push_subscriptions(enabled, updated_at desc);

create index if not exists web_push_events_conversation_idx
  on public.web_push_events(conversation_id, created_at desc);

alter table public.web_push_runtime_config enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_events enable row level security;

revoke all on public.web_push_runtime_config from public, anon, authenticated;
revoke all on public.web_push_subscriptions from public, anon, authenticated;
revoke all on public.web_push_events from public, anon, authenticated;

grant select, insert, update, delete on public.web_push_runtime_config to service_role;
grant select, insert, update, delete on public.web_push_subscriptions to service_role;
grant select, insert, update, delete on public.web_push_events to service_role;
