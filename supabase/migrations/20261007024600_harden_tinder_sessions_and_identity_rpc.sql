-- The identity-linking function runs as its owner and must not be callable
-- through the public Data API. Runtime calls use the service-role client.
REVOKE EXECUTE ON FUNCTION public.link_conversation_channel_identity_atomic(text, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.link_conversation_channel_identity_atomic(text, text, text, text, jsonb, text)
  TO service_role;

-- Invalidate any session secret issued by the vulnerable pre-fix status route.
-- Keep the NOT NULL constraint: replace the saved digest with an unpredictable value
-- that cannot match the browser's existing session secret.
-- The operator can recover access by reconnecting with the already configured Tinder token.
UPDATE public.match_tinder_config
   SET session_hash = md5(gen_random_uuid()::text || clock_timestamp()::text),
       updated_at = clock_timestamp()
 WHERE id = 'default'
   AND auth_token IS NOT NULL;
