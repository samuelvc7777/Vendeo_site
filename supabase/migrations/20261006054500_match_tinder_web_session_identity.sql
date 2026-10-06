ALTER TABLE public.match_tinder_config
  ADD COLUMN IF NOT EXISTS persistent_device_id text,
  ADD COLUMN IF NOT EXISTS app_session_id text,
  ADD COLUMN IF NOT EXISTS app_session_started_at timestamptz;

UPDATE public.match_tinder_config
SET
  persistent_device_id = COALESCE(persistent_device_id, gen_random_uuid()::text),
  app_session_id = COALESCE(app_session_id, gen_random_uuid()::text),
  app_session_started_at = COALESCE(app_session_started_at, timezone('utc', now()))
WHERE id = 'default';

COMMENT ON COLUMN public.match_tinder_config.persistent_device_id IS
  'Stable per-installation identifier used by the Tinder web client headers.';
COMMENT ON COLUMN public.match_tinder_config.app_session_id IS
  'Server-side Tinder web app session identifier; never exposed as an auth credential.';
