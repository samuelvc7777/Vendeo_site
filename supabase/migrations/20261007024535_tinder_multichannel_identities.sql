-- ============================================================================
-- Migration: 20261006140000_tinder_multichannel_identities.sql
-- Objetivo: Habilitar canal 'tinder' nas conversas/mensagens canônicas e criar
--           tabelas de identidades multi-canal e transferências determinísticas.
-- Autoridade: CONTEXT.md e ADR 0004 (docs/adr/0004-canonical-conversation-across-channels.md)
-- Status: Migration local criada; NÃO APLICAR EM PRODUÇÃO sem validação de RLS e staging.
-- ============================================================================

-- 1. Extensão da restrição de canal em instagram_conversations
ALTER TABLE public.instagram_conversations
  DROP CONSTRAINT IF EXISTS instagram_conversations_channel_check;

ALTER TABLE public.instagram_conversations
  ADD CONSTRAINT instagram_conversations_channel_check
  CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text, 'tinder'::text]));

-- 2. Extensão da restrição de canal em instagram_messages
ALTER TABLE public.instagram_messages
  DROP CONSTRAINT IF EXISTS instagram_messages_channel_check;

ALTER TABLE public.instagram_messages
  ADD CONSTRAINT instagram_messages_channel_check
  CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text, 'tinder'::text]));

-- 3. Tabela de vínculos canônicos multi-canal (ADR 0004)
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

-- RLS: Habilitado e configurado para service_role (Advisor-compliant)
ALTER TABLE public.conversation_channel_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_channel_identities" ON public.conversation_channel_identities;
CREATE POLICY "service_role_manage_channel_identities"
  ON public.conversation_channel_identities
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Tabela de rastreamento de transferências de conversas entre canais
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

-- RLS: Habilitado e configurado para service_role
ALTER TABLE public.conversation_channel_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_channel_transfers" ON public.conversation_channel_transfers;
CREATE POLICY "service_role_manage_channel_transfers"
  ON public.conversation_channel_transfers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. RPC Atômica para vínculo seguro e prevenção de concorrência e colisão (ADR 0004)
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
  -- Validação estrita de parâmetros de entrada
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

  -- Valida existência da conversa canônica garantindo integridade referencial
  SELECT EXISTS(
    SELECT 1 FROM public.instagram_conversations WHERE id = p_conversation_id
  ) INTO v_conv_exists;

  IF NOT v_conv_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'conversation_not_found');
  END IF;

  -- 1. Primeiro verifica se já existe registro e bloqueia a linha
  SELECT id, conversation_id, status, metadata
    INTO v_existing
    FROM public.conversation_channel_identities
   WHERE channel = p_channel
     AND external_identity_id = p_external_identity_id
     FOR UPDATE;

  -- Se já existir e pertencer a OUTRA conversa: BLOQUEIA SEM ALTERAR A OUTRA CONVERSA!
  IF v_existing.id IS NOT NULL AND v_existing.conversation_id <> p_conversation_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'collision', true,
      'existing_conversation_id', v_existing.conversation_id,
      'error', 'identity_collision_existing_conversation'
    );
  END IF;

  -- Se já existir e pertencer à mesma conversa: atualiza idempotente
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

  -- 2. Se não existir, tenta inserção com tratamento transacional contra condição de corrida
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
    -- Condição de corrida tratada: outra transação concorrente inseriu no mesmo instante.
    -- Re-consulta com lock FOR UPDATE para checar colisão com segurança.
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

-- Revogação estrita de privilégios públicos e concessão exclusiva ao papel de serviço
REVOKE EXECUTE ON FUNCTION public.link_conversation_channel_identity_atomic(text, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_conversation_channel_identity_atomic(text, text, text, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_conversation_channel_identity_atomic(text, text, text, text, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.link_conversation_channel_identity_atomic(text, text, text, text, jsonb, text) TO service_role;


-- ============================================================================
-- SCRIPT DE ROLLBACK / DOWN (Para execução manual reversa se necessário):
--
-- DROP POLICY IF EXISTS "service_role_manage_channel_transfers" ON public.conversation_channel_transfers;
-- DROP TABLE IF EXISTS public.conversation_channel_transfers;
-- DROP POLICY IF EXISTS "service_role_manage_channel_identities" ON public.conversation_channel_identities;
-- DROP TABLE IF EXISTS public.conversation_channel_identities;
--
-- ALTER TABLE public.instagram_conversations
--   DROP CONSTRAINT IF EXISTS instagram_conversations_channel_check;
-- ALTER TABLE public.instagram_conversations
--   ADD CONSTRAINT instagram_conversations_channel_check
--   CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text]));
--
-- ALTER TABLE public.instagram_messages
--   DROP CONSTRAINT IF EXISTS instagram_messages_channel_check;
-- ALTER TABLE public.instagram_messages
--   ADD CONSTRAINT instagram_messages_channel_check
--   CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text]));
-- ============================================================================
