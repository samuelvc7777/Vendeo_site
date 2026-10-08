-- Estado durável do poller autorizado do Tinder e reentrada factual de falhas
-- de transferência no Brain. Esta migration é local; não aplicar sem staging.

CREATE TABLE IF NOT EXISTS public.tinder_sync_state (
  match_id text PRIMARY KEY,
  cursor text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.tinder_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_manage_tinder_sync_state ON public.tinder_sync_state;
CREATE POLICY service_role_manage_tinder_sync_state
  ON public.tinder_sync_state
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON public.tinder_sync_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tinder_sync_state TO service_role;

CREATE OR REPLACE FUNCTION public.claim_tinder_sync_lease(
  p_match_id text,
  p_lease_token uuid,
  p_ttl_seconds integer DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_claimed_match_id text;
BEGIN
  IF NULLIF(btrim(p_match_id), '') IS NULL OR p_lease_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'acquired', false, 'reason', 'invalid_lease_request');
  END IF;

  INSERT INTO public.tinder_sync_state (match_id, lease_token, lease_expires_at)
  VALUES (
    p_match_id,
    p_lease_token,
    clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_ttl_seconds, 120), 900)))
  )
  ON CONFLICT (match_id) DO UPDATE
     SET lease_token = EXCLUDED.lease_token,
         lease_expires_at = EXCLUDED.lease_expires_at,
         updated_at = clock_timestamp()
   WHERE public.tinder_sync_state.lease_expires_at IS NULL
      OR public.tinder_sync_state.lease_expires_at <= clock_timestamp()
  RETURNING match_id INTO v_claimed_match_id;

  RETURN jsonb_build_object('success', true, 'acquired', v_claimed_match_id IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tinder_sync_cursor(
  p_match_id text,
  p_lease_token uuid,
  p_cursor text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated_match_id text;
BEGIN
  IF NULLIF(btrim(p_match_id), '') IS NULL OR p_lease_token IS NULL OR NULLIF(btrim(p_cursor), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_cursor_request');
  END IF;

  UPDATE public.tinder_sync_state
     SET cursor = p_cursor,
         updated_at = clock_timestamp()
   WHERE match_id = p_match_id
     AND lease_token = p_lease_token
     AND lease_expires_at > clock_timestamp()
  RETURNING match_id INTO v_updated_match_id;

  RETURN jsonb_build_object('success', v_updated_match_id IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_tinder_sync_lease(
  p_match_id text,
  p_lease_token uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_released_match_id text;
BEGIN
  UPDATE public.tinder_sync_state
     SET lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = clock_timestamp()
   WHERE match_id = p_match_id
     AND lease_token = p_lease_token
  RETURNING match_id INTO v_released_match_id;

  RETURN jsonb_build_object('success', v_released_match_id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tinder_sync_lease(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tinder_sync_cursor(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_tinder_sync_lease(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tinder_sync_lease(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_tinder_sync_cursor(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_tinder_sync_lease(text, uuid) TO service_role;

ALTER TABLE public.conversation_channel_transfers
  ADD COLUMN IF NOT EXISTS brain_reentry_status text NOT NULL DEFAULT 'not_required'
    CHECK (brain_reentry_status IN ('not_required', 'pending', 'queueing', 'queued', 'processed', 'blocked')),
  ADD COLUMN IF NOT EXISTS brain_reentry_message_id text
    REFERENCES public.instagram_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brain_reentry_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS brain_reentry_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS brain_reentry_outcome text
    CHECK (brain_reentry_outcome IN ('failed', 'uncertain')),
  ADD COLUMN IF NOT EXISTS brain_reentry_technical_code text,
  ADD COLUMN IF NOT EXISTS brain_reentry_details text;

CREATE INDEX IF NOT EXISTS idx_channel_transfers_brain_reentry
  ON public.conversation_channel_transfers (updated_at, conversation_id)
  WHERE brain_reentry_status IN ('pending', 'queueing');
