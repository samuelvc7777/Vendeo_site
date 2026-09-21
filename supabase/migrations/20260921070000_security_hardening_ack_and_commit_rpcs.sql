-- ==============================================================================
-- Migration: 20260921070000_security_hardening_ack_and_commit_rpcs.sql
-- Descrição: Hardening de segurança para as funções críticas ack_experimental_cycle_preemption
--            e commit_experimental_cycle_if_owned.
--            Adiciona SET search_path = public e qualifica public.instagram_conversations,
--            preservando 100% da assinatura, lógica de concorrência e retorno.
--            Reaplica REVOKE ALL FROM PUBLIC e GRANT EXECUTE TO service_role.
-- ==============================================================================

-- 1. ack_experimental_cycle_preemption
CREATE OR REPLACE FUNCTION ack_experimental_cycle_preemption(
  p_conversation_id text,
  p_cycle_token text,
  p_expected_inbound_revision int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_active_token text;
  v_current_rev int;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para evitar qualquer condição de corrida
  SELECT stage_completed_rules INTO v_rules
  FROM public.instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'acknowledged', false,
      'reason', 'conversation_not_found'
    );
  END IF;

  v_active_token := v_rules->>'active_cycle_token';

  -- 2. Valida se o ciclo atual ainda detém a custódia da conversa
  IF v_active_token IS NULL OR v_active_token <> p_cycle_token THEN
    RETURN jsonb_build_object(
      'acknowledged', false,
      'reason', 'cycle_token_mismatch',
      'activeToken', v_active_token
    );
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_current_rev := COALESCE((v_orch->>'inboundRevision')::int, 0);

  -- 3. Comparação atômica de revisão (Compare-And-Swap)
  -- Se a revisão atual for exatamente a que o ciclo assumiu no snapshot/watermark:
  -- significa que nenhuma nova mensagem chegou depois. É seguro fazer ACK e limpar as flags.
  IF v_current_rev = p_expected_inbound_revision THEN
    v_rules := jsonb_set(v_rules, '{preempt_requested}', 'false'::jsonb);
    v_orch := jsonb_set(v_orch, '{preemptRequested}', 'false'::jsonb);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

    UPDATE public.instagram_conversations
    SET stage_completed_rules = v_rules
    WHERE id = p_conversation_id;

    RETURN jsonb_build_object(
      'acknowledged', true,
      'currentRevision', v_current_rev,
      'reason', 'preemption_acknowledged'
    );
  END IF;

  -- 4. Se a revisão atual for maior que a esperada:
  -- uma nova mensagem inbound chegou concorrentemente durante o claim/início do ciclo.
  -- NUNCA limpa as flags para não apagar a preempção legítima!
  IF v_current_rev > p_expected_inbound_revision THEN
    RETURN jsonb_build_object(
      'acknowledged', false,
      'currentRevision', v_current_rev,
      'expectedRevision', p_expected_inbound_revision,
      'reason', 'newer_revision_detected'
    );
  END IF;

  RETURN jsonb_build_object(
    'acknowledged', false,
    'currentRevision', v_current_rev,
    'reason', 'unexpected_revision_state'
  );
END;
$$;

-- 2. commit_experimental_cycle_if_owned
CREATE OR REPLACE FUNCTION commit_experimental_cycle_if_owned(
  p_conversation_id text,
  p_cycle_token text,
  p_new_stage_completed_rules jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_active_token text;
  v_preempt_requested boolean;
  v_final_rules jsonb;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para garantir isolamento ACID total
  SELECT stage_completed_rules INTO v_rules
  FROM public.instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'committed', false,
      'reason', 'not_found'
    );
  END IF;

  v_active_token := v_rules->>'active_cycle_token';
  v_preempt_requested := COALESCE((v_rules->>'preempt_requested')::boolean, false);

  -- 2. Valida se o ciclo atual ainda detém a custódia exclusiva do lock
  IF v_active_token IS NULL OR v_active_token <> p_cycle_token THEN
    RETURN jsonb_build_object(
      'committed', false,
      'reason', 'lost_lock',
      'activeToken', v_active_token
    );
  END IF;

  -- 3. Valida se preempção foi solicitada no último instante
  IF v_preempt_requested IS TRUE THEN
    RETURN jsonb_build_object(
      'committed', false,
      'reason', 'preempted'
    );
  END IF;

  -- 4. Garante que active_cycle_token seja limpo no commit oficial e preempção limpa
  v_final_rules := jsonb_set(p_new_stage_completed_rules, '{active_cycle_token}', 'null'::jsonb);
  v_final_rules := jsonb_set(v_final_rules, '{preempt_requested}', 'false'::jsonb);

  -- 5. Atualiza atomicamente a linha bloqueada
  UPDATE public.instagram_conversations
  SET stage_completed_rules = v_final_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'committed', true,
    'reason', 'committed'
  );
END;
$$;

-- 3. Permissões de Segurança Estritas: Apenas service_role
DO $$
BEGIN
  REVOKE ALL ON FUNCTION ack_experimental_cycle_preemption(text, text, integer) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION ack_experimental_cycle_preemption(text, text, integer) TO service_role;

  REVOKE ALL ON FUNCTION commit_experimental_cycle_if_owned(text, text, jsonb) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION commit_experimental_cycle_if_owned(text, text, jsonb) TO service_role;
END;
$$;
