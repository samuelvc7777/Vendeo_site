-- ==============================================================================
-- Migration: 20260918145000_create_ack_experimental_cycle_preemption.sql
-- Descrição: Função PL/pgSQL com SELECT ... FOR UPDATE para lock exclusivo de linha
--            e reconhecimento (ACK) atômico de preempção baseado em inboundRevision.
--            Garante que flags de preempções antigas sejam limpas somente quando o novo
--            ciclo incorporou todas as inbounds, sem apagar novas inbounds concorrentes.
-- ==============================================================================

CREATE OR REPLACE FUNCTION ack_experimental_cycle_preemption(
  p_conversation_id text,
  p_cycle_token text,
  p_expected_inbound_revision int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_active_token text;
  v_current_rev int;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para evitar qualquer condição de corrida
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
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
  IF v_active_token IS NOT NULL AND v_active_token <> p_cycle_token THEN
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

    UPDATE instagram_conversations
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
