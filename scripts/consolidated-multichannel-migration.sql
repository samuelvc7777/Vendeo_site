-- ============================================================================
-- SCRIPT CONSOLIDADO DE MIGRAÇÃO: IA TINDER -> WHATSAPP MULTICANAL + HARDENING RLS
-- Execução segura em bloco transacional único (PostgreSQL / Supabase SQL Editor)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. HABILITAR CANAL 'tinder' NAS TABELAS CANÔNICAS
-- ----------------------------------------------------------------------------
ALTER TABLE public.instagram_conversations
  DROP CONSTRAINT IF EXISTS instagram_conversations_channel_check;

ALTER TABLE public.instagram_conversations
  ADD CONSTRAINT instagram_conversations_channel_check
  CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text, 'tinder'::text]));

ALTER TABLE public.instagram_messages
  DROP CONSTRAINT IF EXISTS instagram_messages_channel_check;

ALTER TABLE public.instagram_messages
  ADD CONSTRAINT instagram_messages_channel_check
  CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text, 'tinder'::text]));

-- ----------------------------------------------------------------------------
-- 2. TABELA DE VÍNCULOS CANÔNICOS MULTICANAL (conversation_channel_identities)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('instagram', 'whatsapp', 'whatsapp2', 'tinder')),
  external_account_id text,
  external_identity_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'transferred', 'pending_verification', 'archived', 'collision_review')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_channel_external_identity UNIQUE (channel, external_identity_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_identities_conv_id
  ON public.conversation_channel_identities(conversation_id);

CREATE INDEX IF NOT EXISTS idx_channel_identities_channel_ext
  ON public.conversation_channel_identities(channel, external_identity_id);

ALTER TABLE public.conversation_channel_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_channel_identities" ON public.conversation_channel_identities;
CREATE POLICY "service_role_manage_channel_identities"
  ON public.conversation_channel_identities
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.conversation_channel_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversation_channel_identities TO service_role;

-- ----------------------------------------------------------------------------
-- 3. TABELA DE TRANSFERÊNCIAS DETERMINÍSTICAS (conversation_channel_transfers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_channel_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  source_channel text NOT NULL CHECK (source_channel IN ('instagram', 'whatsapp', 'whatsapp2', 'tinder')),
  target_channel text NOT NULL CHECK (target_channel IN ('instagram', 'whatsapp', 'whatsapp2', 'tinder')),
  target_recipient text NOT NULL,
  initial_message_text text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'confirmed', 'failed', 'uncertain')),
  provider_message_id text,
  failure_reason text,
  idempotency_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_channel_transfers_conv_id
  ON public.conversation_channel_transfers(conversation_id);

CREATE INDEX IF NOT EXISTS idx_channel_transfers_status
  ON public.conversation_channel_transfers(status);

ALTER TABLE public.conversation_channel_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_channel_transfers" ON public.conversation_channel_transfers;
CREATE POLICY "service_role_manage_channel_transfers"
  ON public.conversation_channel_transfers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.conversation_channel_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversation_channel_transfers TO service_role;

-- ----------------------------------------------------------------------------
-- 4. RPC ATÔMICA DE VÍNCULO MULTICANAL
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_conversation_channel_identity_atomic(
  p_conversation_id text,
  p_channel text,
  p_external_identity_id text,
  p_external_account_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_status text DEFAULT 'active'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing RECORD;
  v_now timestamptz := clock_timestamp();
  v_conv_exists boolean;
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('instagram', 'whatsapp', 'whatsapp2', 'tinder') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_channel_parameter');
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('active', 'transferred', 'pending_verification', 'archived', 'collision_review') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status_parameter');
  END IF;

  IF p_conversation_id IS NULL OR length(trim(p_conversation_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_conversation_id');
  END IF;

  IF p_external_identity_id IS NULL OR length(trim(p_external_identity_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_external_identity_id');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.instagram_conversations WHERE id = p_conversation_id
  ) INTO v_conv_exists;

  IF NOT v_conv_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'conversation_not_found');
  END IF;

  SELECT id, conversation_id, status, metadata
    INTO v_existing
    FROM public.conversation_channel_identities
   WHERE channel = p_channel
     AND external_identity_id = p_external_identity_id
     FOR UPDATE;

  IF v_existing.id IS NOT NULL AND v_existing.conversation_id <> p_conversation_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'collision', true,
      'existing_conversation_id', v_existing.conversation_id,
      'error', 'identity_collision_existing_conversation'
    );
  END IF;

  IF v_existing.id IS NOT NULL AND v_existing.conversation_id = p_conversation_id THEN
    UPDATE public.conversation_channel_identities
       SET external_account_id = COALESCE(p_external_account_id, external_account_id),
           status = p_status,
           metadata = COALESCE(v_existing.metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
           updated_at = v_now
     WHERE id = v_existing.id;

    RETURN jsonb_build_object(
      'success', true,
      'is_new', false,
      'conversation_id', p_conversation_id
    );
  END IF;

  BEGIN
    INSERT INTO public.conversation_channel_identities (
      conversation_id,
      channel,
      external_account_id,
      external_identity_id,
      status,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      p_conversation_id,
      p_channel,
      p_external_account_id,
      p_external_identity_id,
      p_status,
      COALESCE(p_metadata, '{}'::jsonb),
      v_now,
      v_now
    );

    RETURN jsonb_build_object(
      'success', true,
      'is_new', true,
      'conversation_id', p_conversation_id
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT id, conversation_id, status, metadata
      INTO v_existing
      FROM public.conversation_channel_identities
     WHERE channel = p_channel
       AND external_identity_id = p_external_identity_id
       FOR UPDATE;

    IF v_existing.conversation_id <> p_conversation_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'collision', true,
        'existing_conversation_id', v_existing.conversation_id,
        'error', 'identity_collision_existing_conversation'
      );
    ELSE
      UPDATE public.conversation_channel_identities
         SET external_account_id = COALESCE(p_external_account_id, external_account_id),
             status = p_status,
             metadata = COALESCE(v_existing.metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
             updated_at = v_now
       WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'success', true,
        'is_new', false,
        'conversation_id', p_conversation_id
      );
    END IF;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_conversation_channel_identity_atomic(text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_conversation_channel_identity_atomic(text, text, text, text, jsonb, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. ESTADO DE SINCRONIZAÇÃO EM BACKGROUND DO TINDER (tinder_sync_state)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 6. COLUNAS DE REENTRADA FACTUAL DO BRAIN
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 7. COLUNAS PARA SALVAR CONTATO NO WHATSAPP GATEWAY
-- ----------------------------------------------------------------------------
ALTER TABLE public.whatsapp2_delivery_queue
  ADD COLUMN IF NOT EXISTS save_recipient_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipient_contact_name text,
  ADD COLUMN IF NOT EXISTS recipient_contact_save_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS recipient_contact_save_error text,
  ADD COLUMN IF NOT EXISTS recipient_contact_saved_at timestamptz;

ALTER TABLE public.whatsapp2_delivery_queue
  DROP CONSTRAINT IF EXISTS whatsapp2_delivery_queue_contact_save_status_check;

ALTER TABLE public.whatsapp2_delivery_queue
  ADD CONSTRAINT whatsapp2_delivery_queue_contact_save_status_check
  CHECK (recipient_contact_save_status IN ('not_requested', 'not_sent', 'pending', 'saved', 'failed'));

-- ----------------------------------------------------------------------------
-- 8. HARDENING DE SEGURANÇA RLS APONTADO PELO SUPABASE ADVISOR
-- ----------------------------------------------------------------------------
-- whatsapp2_delivery_queue
ALTER TABLE IF EXISTS public.whatsapp2_delivery_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_manage_whatsapp2_delivery_queue" ON public.whatsapp2_delivery_queue;
CREATE POLICY "service_role_manage_whatsapp2_delivery_queue"
  ON public.whatsapp2_delivery_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.whatsapp2_delivery_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp2_delivery_queue TO service_role;

-- whatsapp2_gateway_config
ALTER TABLE IF EXISTS public.whatsapp2_gateway_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_manage_whatsapp2_gateway_config" ON public.whatsapp2_gateway_config;
CREATE POLICY "service_role_manage_whatsapp2_gateway_config"
  ON public.whatsapp2_gateway_config FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.whatsapp2_gateway_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp2_gateway_config TO service_role;

-- openai_conversation_links
ALTER TABLE IF EXISTS public.openai_conversation_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_manage_openai_conversation_links" ON public.openai_conversation_links;
CREATE POLICY "service_role_manage_openai_conversation_links"
  ON public.openai_conversation_links FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.openai_conversation_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.openai_conversation_links TO service_role;

-- openai_message_receipts
ALTER TABLE IF EXISTS public.openai_message_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_manage_openai_message_receipts" ON public.openai_message_receipts;
CREATE POLICY "service_role_manage_openai_message_receipts"
  ON public.openai_message_receipts FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.openai_message_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.openai_message_receipts TO service_role;

COMMIT;
