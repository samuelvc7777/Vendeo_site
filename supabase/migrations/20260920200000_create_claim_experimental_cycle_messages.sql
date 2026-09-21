-- ==============================================================================
-- Migration: 20260920200000_create_claim_experimental_cycle_messages.sql
-- Descrição: Função PL/pgSQL transacional com SELECT ... FOR UPDATE para registrar
--            o claim de mensagens e marcar o status como 'processing'.
--            Garante que o lock ainda pertence ao ciclo atual e que nenhuma
--            preempção ocorreu antes do claim, eliminando qualquer read-modify-write em JS.
-- ==============================================================================

CREATE OR REPLACE FUNCTION claim_experimental_cycle_messages(
  p_conversation_id text,
  p_cycle_token text,
  p_message_ids text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_active_token text;
  v_preempt_requested boolean;
  v_orch jsonb;
  v_ledger jsonb;
  v_msg_id text;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_active_token := v_rules->>'active_cycle_token';

  -- 2. Verifica se o lock ainda pertence a este ciclo
  IF v_active_token IS NULL OR v_active_token <> p_cycle_token THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'cycle_token_mismatch',
      'activeToken', v_active_token
    );
  END IF;

  -- 3. Verifica se preempção foi solicitada
  v_preempt_requested := COALESCE((v_rules->>'preempt_requested')::boolean, false);
  IF v_preempt_requested IS TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'cycle_preempted',
      'activeToken', v_active_token
    );
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);

  -- 4. Marca mensagens informadas como 'claimed'
  IF p_message_ids IS NOT NULL THEN
    FOREACH v_msg_id IN ARRAY p_message_ids LOOP
      IF v_msg_id IS NOT NULL AND btrim(v_msg_id) <> '' THEN
        v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], '"claimed"'::jsonb, true);
      END IF;
    END LOOP;
  END IF;

  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
  v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', '"processing"'::jsonb);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  -- 5. Atualização atômica preservando 100% dos demais campos
  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'messages_claimed'
  );
END;
$$;
