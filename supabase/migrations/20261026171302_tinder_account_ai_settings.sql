create table public.tinder_ai_settings (
  account_id text primary key check (length(account_id) > 0),
  is_enabled boolean not null default false,
  schedule_id uuid references public.tinder_conversation_schedules(id) on delete set null,
  enabled_since timestamptz,
  updated_at timestamptz not null default now(),
  constraint tinder_ai_activation_has_timestamp check (not is_enabled or enabled_since is not null)
);

create index tinder_ai_settings_schedule_idx on public.tinder_ai_settings(schedule_id);
alter table public.tinder_ai_settings enable row level security;
revoke all on public.tinder_ai_settings from public, anon, authenticated;
grant select, insert, update, delete on public.tinder_ai_settings to service_role;
comment on table public.tinder_ai_settings is
  'Ativação da abordagem por conta Tinder, independente de ai_auto_respond e do Brain de WhatsApp. Acesso somente por sessão Match validada.';

;
