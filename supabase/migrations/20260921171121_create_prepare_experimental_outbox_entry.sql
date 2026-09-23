CREATE OR REPLACE FUNCTION prepare_experimental_outbox_entry(
  p_conversation_id text,
  p_cycle_token text,
  p_outbox_entry jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_entry_id text;
  v_target_key text;
  v_active_token text;
  v_preempt_requested boolean;
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
  v_preempt_requested := COALESCE((v_rules->>'preempt_requested')::boolean, false);

  -- 2. Valida se o ciclo ainda é o detentor exclusivo
  IF v_active_token IS NULL OR v_active_token <> p_cycle_token THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'cycle_token_mismatch',
      'activeToken', v_active_token
    );
  END IF;

  -- 3. Valida se preempção foi solicitada
  IF v_preempt_requested IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'reason', 'cycle_preempted');
  END IF;

  v_target_key := COALESCE(p_outbox_entry->>'idempotencyKey', p_outbox_entry->>'id');
  IF v_target_key IS NULL OR v_target_key = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_outbox_key');
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);

  -- 4. Aplica patch pontual na chave da outbox mantendo todo o restante do JSON intacto
  v_outbox := jsonb_set(v_outbox, ARRAY[v_target_key], p_outbox_entry, true);
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'prepared',
    'outboxKey', v_target_key
  );
END;
$$;;
