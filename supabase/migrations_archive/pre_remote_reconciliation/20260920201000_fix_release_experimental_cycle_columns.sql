-- ==============================================================================
-- Migration: 20260920201000_fix_release_experimental_cycle_columns.sql
-- Descrição: Atualiza release_experimental_cycle_if_owned removendo o espelhamento
--            indevido de ai_debounce_until e ai_auto_respond dentro do JSON
--            stage_completed_rules e adicionando suporte atômico a p_clear_cancel_flag.
-- ==============================================================================

CREATE OR REPLACE FUNCTION release_experimental_cycle_if_owned(
  p_conversation_id text,
  p_cycle_token text,
  p_processing_status text DEFAULT 'idle',
  p_debounce_until timestamptz DEFAULT NULL,
  p_revert_message_ids text[] DEFAULT NULL,
  p_mark_processed_ids text[] DEFAULT NULL,
  p_last_error text DEFAULT NULL,
  p_cycle_record jsonb DEFAULT NULL,
  p_outbox_map jsonb DEFAULT NULL,
  p_clear_cancel_flag boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_active_token text;
  v_msg_id text;
  v_recent jsonb;
  v_outbox jsonb;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_active_token := v_rules->>'active_cycle_token';

  -- 2. Se o lock pertence a outro ciclo, aborta sem alteração
  IF v_active_token IS NULL OR v_active_token <> p_cycle_token THEN
    RETURN jsonb_build_object(
      'released', false,
      'reason', 'token_mismatch',
      'activeToken', v_active_token
    );
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);

  -- 3. Reverte mensagens informadas para 'pending' pontualmente
  IF p_revert_message_ids IS NOT NULL THEN
    FOREACH v_msg_id IN ARRAY p_revert_message_ids LOOP
      IF v_msg_id IS NOT NULL AND btrim(v_msg_id) <> '' THEN
        v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], '"pending"'::jsonb, true);
      END IF;
    END LOOP;
  END IF;

  -- 4. Marca mensagens informadas como 'processed' pontualmente
  IF p_mark_processed_ids IS NOT NULL THEN
    FOREACH v_msg_id IN ARRAY p_mark_processed_ids LOOP
      IF v_msg_id IS NOT NULL AND btrim(v_msg_id) <> '' THEN
        v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], '"processed"'::jsonb, true);
      END IF;
    END LOOP;
  END IF;

  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
  IF p_processing_status IS NOT NULL THEN
    v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', to_jsonb(p_processing_status));
  END IF;

  IF p_last_error IS NOT NULL THEN
    v_orch := jsonb_set(v_orch, '{lastError}', to_jsonb(p_last_error));
  ELSIF p_processing_status = 'sent' THEN
    v_orch := jsonb_set(v_orch, '{lastError}', 'null'::jsonb);
  END IF;

  -- Atualiza recentCycles se fornecido
  IF p_cycle_record IS NOT NULL THEN
    v_recent := COALESCE(v_orch->'recentCycles', '[]'::jsonb);
    IF jsonb_typeof(v_recent) <> 'array' THEN
      v_recent := '[]'::jsonb;
    END IF;
    v_recent := jsonb_build_array(p_cycle_record) || v_recent;
    IF jsonb_array_length(v_recent) > 5 THEN
      SELECT jsonb_agg(elem) INTO v_recent
      FROM (
        SELECT elem FROM jsonb_array_elements(v_recent) WITH ORDINALITY arr(elem, idx)
        WHERE idx <= 5
      ) sub;
    END IF;
    v_orch := jsonb_set(v_orch, '{recentCycles}', v_recent);
  END IF;

  -- Atualiza outbox se fornecido
  IF p_outbox_map IS NOT NULL THEN
    v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);
    v_orch := jsonb_set(v_orch, '{outbox}', v_outbox || p_outbox_map);
  END IF;

  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
  -- Libera o token do ciclo
  v_rules := jsonb_set(v_rules, '{active_cycle_token}', 'null'::jsonb);

  -- Limpa flag de cancelamento manual de forma atômica se solicitado
  IF p_clear_cancel_flag IS TRUE THEN
    v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'null'::jsonb);
  END IF;

  -- 5. Atualização na tabela preservando debounce nas colunas da tabela e NUNCA dentro do JSON
  IF p_debounce_until IS NOT NULL THEN
    UPDATE instagram_conversations
    SET stage_completed_rules = v_rules,
        ai_auto_respond = true,
        ai_debounce_until = p_debounce_until
    WHERE id = p_conversation_id;
  ELSE
    UPDATE instagram_conversations
    SET stage_completed_rules = v_rules
    WHERE id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object(
    'released', true,
    'reason', 'released'
  );
END;
$$;
