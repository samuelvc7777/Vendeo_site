CREATE OR REPLACE FUNCTION request_experimental_cycle_preemption(
  p_conversation_id text,
  p_message_id text DEFAULT NULL,
  p_debounce_until timestamptz DEFAULT NULL
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
  v_new_rev int;
  v_ledger jsonb;
  v_debounce_target timestamptz;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para garantir isolamento ACID total
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'conversation_not_found'
    );
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_active_token := v_rules->>'active_cycle_token';

  -- 2. Lê e prepara o bloco orchestration
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_current_rev := COALESCE((v_orch->>'inboundRevision')::int, 0);
  v_new_rev := v_current_rev + 1;

  -- 3. Atualiza atomicamente a revisão e as flags de preempção no JSON atual
  v_orch := jsonb_set(v_orch, '{inboundRevision}', to_jsonb(v_new_rev));
  v_orch := jsonb_set(v_orch, '{preemptRequested}', 'true'::jsonb);
  v_rules := jsonb_set(v_rules, '{preempt_requested}', 'true'::jsonb);

  -- 4. Se p_message_id fornecido, marca no messageLedger como pending
  IF p_message_id IS NOT NULL AND btrim(p_message_id) <> '' THEN
    v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
    v_ledger := jsonb_set(v_ledger, ARRAY[p_message_id], '"pending"'::jsonb, true);
    v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
  END IF;

  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  -- 5. Define timestamp de debounce (padrão 2.5s caso não informado)
  v_debounce_target := COALESCE(p_debounce_until, NOW() + INTERVAL '2.5 seconds');

  -- 6. Atualização atômica na tabela: ai_debounce_until exclusivamente na coluna da tabela
  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules,
      ai_auto_respond = true,
      ai_debounce_until = v_debounce_target
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'inboundRevision', v_new_rev,
    'activeCycleToken', v_active_token
  );
END;
$$;;
