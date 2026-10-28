create table public.tinder_conversation_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id text not null check (length(account_id) > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tinder_conversation_schedules_account_order_idx
  on public.tinder_conversation_schedules (account_id, position, created_at);

alter table public.tinder_conversation_schedules enable row level security;
revoke all on public.tinder_conversation_schedules from public, anon, authenticated;
grant select, insert, update, delete on public.tinder_conversation_schedules to service_role;

comment on table public.tinder_conversation_schedules is
  'Configuração textual do Tinder por conta; acesso somente pelo backend com sessão Match validada. Salvar não inicia envios.';

;
