-- Canonical global AutoPilot settings. Replaces the synthetic
-- instagram_conversations row __autopilot_config__.

create table if not exists public.autopilot_settings (
  id text primary key,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.autopilot_settings (id, config, updated_at)
select
  'global',
  coalesce(stage_completed_rules->'config', '{}'::jsonb),
  coalesce(updated_at, clock_timestamp())
from public.instagram_conversations
where id = '__autopilot_config__'
on conflict (id) do update
set config = excluded.config,
    updated_at = excluded.updated_at;

insert into public.autopilot_settings (id, config)
values (
  'global',
  jsonb_build_object(
    'isEnabledGlobally', true,
    'mode', 'automatic',
    'responseDelayMinutes', 1,
    'maxDebounceWindowMinutes', 3,
    'activationWaitMinutes', 1,
    'pauseOnPhotoReceived', true,
    'pauseOnSensitiveContent', true,
    'handOffAtRaffleStep', true,
    'typingDelaySecondsPerBalloon', 4,
    'updatedAt', clock_timestamp()
  )
)
on conflict (id) do nothing;

alter table public.autopilot_settings enable row level security;

drop policy if exists autopilot_settings_read on public.autopilot_settings;
create policy autopilot_settings_read
  on public.autopilot_settings
  for select
  to anon, authenticated
  using (id = 'global');

drop policy if exists autopilot_settings_write on public.autopilot_settings;
create policy autopilot_settings_write
  on public.autopilot_settings
  for all
  to anon, authenticated
  using (id = 'global')
  with check (id = 'global');

grant select, insert, update on public.autopilot_settings to anon, authenticated;
grant select, insert, update, delete on public.autopilot_settings to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'autopilot_settings'
  ) then
    alter publication supabase_realtime add table public.autopilot_settings;
  end if;
end $$;

create index if not exists idx_autopilot_settings_updated_at
  on public.autopilot_settings(updated_at desc);
