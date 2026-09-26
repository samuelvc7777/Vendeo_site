-- Recupera ciclos realmente vencidos com comparação tipada e validação atômica do token.
-- Evita liberar um ciclo novo por comparação lexicográfica de timestamps serializados.

CREATE OR REPLACE FUNCTION public.try_parse_timestamptz(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN NULLIF(btrim(p_value), '')::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_stale_experimental_cycle_atomic(
  p_conversation_id text,
  p_expected_cycle_token text,
  p_stale_before timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_outbox jsonb;
  v_active_token text;
  v_active_at timestamptz;
  v_claimed_ids jsonb;
  v_key text;
  v_entry jsonb;
  v_message_id text;
  v_possible_send boolean := false;
  v_released_count int := 0;
  v_record jsonb;
BEGIN
  SELECT stage_completed_rules INTO v_rules
  FROM public.instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'conversation_not_found');
  END IF;

  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN
    v_rules := '{}'::jsonb;
  END IF;

  v_active_token := NULLIF(v_rules->>'active_cycle_token', '');
  IF v_active_token IS NULL OR v_active_token IS DISTINCT FROM p_expected_cycle_token THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'cycle_token_changed');
  END IF;

  v_active_at := public.try_parse_timestamptz(v_rules->>'active_cycle_at');
  IF v_active_at IS NULL OR p_stale_before IS NULL OR v_active_at >= p_stale_before THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'cycle_not_stale');
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  IF jsonb_typeof(v_orch) <> 'object' THEN v_orch := '{}'::jsonb; END IF;
  v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);
  IF jsonb_typeof(v_ledger) <> 'object' OR jsonb_typeof(v_outbox) <> 'object' THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'invalid_recovery_contract');
  END IF;

  -- Não reenvia mensagens cujo envio possa ter chegado ao Instagram.
  FOR v_key, v_entry IN SELECT * FROM jsonb_each(v_outbox) LOOP
    IF v_entry->>'cycleId' = v_active_token THEN
      IF v_entry->>'status' = 'sending' THEN
        v_entry := v_entry || jsonb_build_object(
          'status', 'dispatch_uncertain',
          'isUncertain', true,
          'lastError', 'stale_cycle_recovery: envio iniciado sem confirmação'
        );
        v_outbox := jsonb_set(v_outbox, ARRAY[v_key], v_entry);
      END IF;
      IF v_entry->>'status' IN ('sent', 'sending', 'dispatch_uncertain')
        OR NULLIF(v_entry->>'providerMessageId', '') IS NOT NULL
        OR COALESCE((v_entry->>'isUncertain')::boolean, false) THEN
        v_possible_send := true;
      END IF;
    END IF;
  END LOOP;

  v_claimed_ids := v_orch->'activeClaimedMessageIds';
  IF jsonb_typeof(v_claimed_ids) = 'array' THEN
    FOR v_message_id IN SELECT jsonb_array_elements_text(v_claimed_ids) LOOP
      IF v_ledger->>v_message_id = 'claimed' THEN
        v_ledger := jsonb_set(v_ledger, ARRAY[v_message_id], to_jsonb(
          CASE WHEN v_possible_send THEN 'processed' ELSE 'pending' END
        ));
        IF NOT v_possible_send THEN v_released_count := v_released_count + 1; END IF;
      END IF;
    END LOOP;
  ELSE
    FOR v_message_id IN SELECT key FROM jsonb_each_text(v_ledger) WHERE value = 'claimed' LOOP
      v_ledger := jsonb_set(v_ledger, ARRAY[v_message_id], to_jsonb(
        CASE WHEN v_possible_send THEN 'processed' ELSE 'pending' END
      ));
      IF NOT v_possible_send THEN v_released_count := v_released_count + 1; END IF;
    END LOOP;
  END IF;

  v_record := jsonb_build_object(
    'cycleId', v_active_token,
    'conversationId', p_conversation_id,
    'status', 'failed',
    'startedAt', v_active_at,
    'completedAt', now(),
    'trace', jsonb_build_array('cycle_marked_stale',
      CASE WHEN v_possible_send THEN 'dispatch_uncertain' ELSE 'pending_messages_released' END)
  );

  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
  v_orch := jsonb_set(v_orch, '{activeClaimedMessageIds}', '[]'::jsonb);
  v_orch := jsonb_set(v_orch, '{processingCycleToken}', 'null'::jsonb);
  v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', '"failed"'::jsonb);
  v_orch := jsonb_set(v_orch, '{lastError}', to_jsonb('stale_cycle_recovered'::text));
  v_orch := jsonb_set(v_orch, '{recentCycles}',
    (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) FROM (
      SELECT value FROM jsonb_array_elements(
        jsonb_build_array(v_record) || CASE WHEN jsonb_typeof(v_orch->'recentCycles') = 'array'
          THEN v_orch->'recentCycles' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS t(value, ord) WHERE ord <= 5
    ) AS recent)
  );
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
  v_rules := jsonb_set(v_rules, '{active_cycle_token}', 'null'::jsonb);
  v_rules := jsonb_set(v_rules, '{active_cycle_at}', 'null'::jsonb);

  UPDATE public.instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'recovered', true,
    'reason', 'stale_cycle_recovered',
    'cycleToken', v_active_token,
    'activeAt', v_active_at,
    'possibleSend', v_possible_send,
    'releasedMessageCount', v_released_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_stale_experimental_cycles_atomic(
  p_stale_before timestamptz,
  p_limit int DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate record;
  v_result jsonb;
  v_recovered jsonb := '[]'::jsonb;
BEGIN
  FOR v_candidate IN
    SELECT id, stage_completed_rules->>'active_cycle_token' AS cycle_token
    FROM public.instagram_conversations
    WHERE NULLIF(stage_completed_rules->>'active_cycle_token', '') IS NOT NULL
      AND public.try_parse_timestamptz(stage_completed_rules->>'active_cycle_at') < p_stale_before
    ORDER BY public.try_parse_timestamptz(stage_completed_rules->>'active_cycle_at') ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 10), 50))
  LOOP
    v_result := public.recover_stale_experimental_cycle_atomic(
      v_candidate.id, v_candidate.cycle_token, p_stale_before
    );
    IF COALESCE((v_result->>'recovered')::boolean, false) THEN
      v_recovered := v_recovered || jsonb_build_array(v_result);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('recovered', v_recovered, 'count', jsonb_array_length(v_recovered));
END;
$$;

REVOKE ALL ON FUNCTION public.try_parse_timestamptz(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stale_experimental_cycle_atomic(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stale_experimental_cycles_atomic(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_stale_experimental_cycles_atomic(timestamptz, int) TO service_role;
