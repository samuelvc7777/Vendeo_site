alter table public.match_tinder_config
  add column if not exists device_id text,
  add column if not exists app_session_id text,
  add column if not exists last_swipe jsonb not null default '{}'::jsonb;
