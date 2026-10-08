-- Secure Tinder provider for the Match area.
-- Tinder credentials stay server-side; browser access uses a revocable opaque session key.

CREATE TABLE IF NOT EXISTS public.match_tinder_config (
  id text PRIMARY KEY DEFAULT 'default',
  auth_token text NOT NULL,
  session_hash text NOT NULL,
  user_id text,
  user_name text,
  avatar_url text,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_validated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.match_tinder_config ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policy on purpose: only the service-role Edge Function can read the Tinder token.
REVOKE ALL ON TABLE public.match_tinder_config FROM anon, authenticated;
GRANT ALL ON TABLE public.match_tinder_config TO service_role;

COMMENT ON TABLE public.match_tinder_config IS
  'Private server-side Tinder connection for the Match area. Never expose auth_token or session_hash to clients.';
