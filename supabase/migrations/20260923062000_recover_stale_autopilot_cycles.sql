-- Recovery atômico de ciclo: o TTL não pode expirar durante a espera local do Agent.
-- A RPC nunca considera "sending" como não enviado.
CREATE OR REPLACE FUNCTION public.claim_experimental_cycle(
  p_conversation_id text, p_cycle_token text, p_stale_seconds int DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_outbox jsonb;
  v_old_token text;
  v_active_at timestamptz;
  v_entry_key text;
  v_entry jsonb;
  v_msg_id text;
  v_claimed jsonb;
  v_possible_send boolean := false;
  v_released int := 0;
  v_uncertain int := 0;
  v_recovered boolean := false;
  v_record jsonb;
  v_retry_count int;
BEGIN
  SELECT stage_completed_rules INTO v_rules
    FROM public.instagram_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;
  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  -- Uma nova inbound após esgotamento inaugura outro lote de tentativas.
  IF v_orch->>'technicalRetryExhaustedAt' IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.instagram_messages m
    WHERE m.conversation_id = p_conversation_id AND m.is_mine IS FALSE
      AND m.created_at > (v_orch->>'technicalRetryExhaustedAt')::timestamptz
      AND COALESCE(v_orch->'messageLedger'->>m.id, 'pending') <> 'processed'
  ) THEN
    v_orch := jsonb_set(v_orch, '{technicalRetryCount}', '0'::jsonb);
    v_orch := jsonb_set(v_orch, '{technicalRetryExhaustedAt}', 'null'::jsonb);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
  END IF;
  IF COALESCE((v_orch->>'technicalRetryCount')::int, 0) >= 3
    AND NULLIF(v_rules->>'active_cycle_token', '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'retry_exhausted');
  END IF;
  v_old_token := v_rules->>'active_cycle_token';
  IF v_old_token IS NOT NULL AND v_old_token <> '' AND v_old_token <> p_cycle_token THEN
    BEGIN
      v_active_at := (v_rules->>'active_cycle_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_active_at := NULL;
    END;
    IF v_active_at IS NOT NULL AND now() - v_active_at <
      (greatest(COALESCE(p_stale_seconds, 300), 300) || ' seconds')::interval THEN
      RETURN jsonb_build_object('success', false, 'reason', 'active_lock', 'activeCycleToken', v_old_token);
    END IF;

    v_recovered := true;
    v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
    v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
    v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);
    IF jsonb_typeof(v_ledger) <> 'object' OR jsonb_typeof(v_outbox) <> 'object' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'invalid_recovery_contract');
    END IF;

    FOR v_entry_key, v_entry IN SELECT * FROM jsonb_each(v_outbox) LOOP
      IF v_entry->>'cycleId' = v_old_token THEN
        IF v_entry->>'status' = 'sending' THEN
          v_entry := v_entry || jsonb_build_object(
            'status', 'dispatch_uncertain', 'isUncertain', true,
            'lastError', 'stale_cycle_recovery: envio iniciado sem confirmação');
          v_outbox := jsonb_set(v_outbox, ARRAY[v_entry_key], v_entry);
          v_uncertain := v_uncertain + 1;
        ELSIF v_entry->>'status' = 'dispatch_uncertain' OR COALESCE((v_entry->>'isUncertain')::boolean, false) THEN
          v_uncertain := v_uncertain + 1;
        END IF;
        IF v_entry->>'status' IN ('sent', 'sending', 'dispatch_uncertain')
          OR NULLIF(v_entry->>'providerMessageId', '') IS NOT NULL
          OR COALESCE((v_entry->>'isUncertain')::boolean, false) THEN
          v_possible_send := true;
        END IF;
      END IF;
    END LOOP;

    v_claimed := v_orch->'activeClaimedMessageIds';
    IF jsonb_typeof(v_claimed) = 'array' THEN
      FOR v_msg_id IN SELECT jsonb_array_elements_text(v_claimed) LOOP
        IF v_ledger->>v_msg_id = 'claimed' THEN
          v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], to_jsonb(CASE WHEN v_possible_send THEN 'processed' ELSE 'pending' END));
          IF NOT v_possible_send THEN v_released := v_released + 1; END IF;
        END IF;
      END LOOP;
    ELSE
      -- Compatibilidade com ciclos criados antes de activeClaimedMessageIds.
      FOR v_msg_id IN SELECT key FROM jsonb_each_text(v_ledger) WHERE value = 'claimed' LOOP
        v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], to_jsonb(CASE WHEN v_possible_send THEN 'processed' ELSE 'pending' END));
        IF NOT v_possible_send THEN v_released := v_released + 1; END IF;
      END LOOP;
    END IF;

    v_record := jsonb_build_object(
      'cycleId', v_old_token, 'conversationId', p_conversation_id,
      'status', 'failed', 'completedAt', now(),
      'trace', jsonb_build_array('cycle_marked_stale', 'cycle_recovery_started',
        CASE WHEN v_possible_send THEN 'dispatch_uncertain' ELSE 'pending_messages_released' END,
        'cycle_recovery_completed'));
    -- Preserva até cinco ciclos para auditoria.
    v_orch := jsonb_set(v_orch, '{recentCycles}',
      (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) FROM (
        SELECT value FROM jsonb_array_elements(
          jsonb_build_array(v_record) || CASE WHEN jsonb_typeof(v_orch->'recentCycles') = 'array'
            THEN v_orch->'recentCycles' ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS t(value, ord) WHERE ord <= 5
      ) AS recent));
    v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
    v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
    v_orch := jsonb_set(v_orch, '{activeClaimedMessageIds}', '[]'::jsonb);
    v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', '"failed"'::jsonb);
    v_orch := jsonb_set(v_orch, '{lastError}', to_jsonb('stale_agent_timeout'::text));
    v_retry_count := LEAST(3, COALESCE((v_orch->>'technicalRetryCount')::int, 0) + 1);
    v_orch := jsonb_set(v_orch, '{technicalRetryCount}', to_jsonb(v_retry_count));
    IF v_retry_count >= 3 THEN
      v_orch := jsonb_set(v_orch, '{technicalRetryExhaustedAt}', to_jsonb(now()::text));
    END IF;
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
    IF v_retry_count >= 3 THEN
      v_rules := jsonb_set(v_rules, '{active_cycle_token}', 'null'::jsonb);
      v_rules := jsonb_set(v_rules, '{active_cycle_at}', 'null'::jsonb);
      UPDATE public.instagram_conversations SET stage_completed_rules = v_rules WHERE id = p_conversation_id;
      RETURN jsonb_build_object('success', false, 'reason', 'retry_exhausted',
        'staleRecovered', true, 'previousCycleToken', v_old_token,
        'releasedMessageCount', v_released, 'uncertainMessageCount', v_uncertain);
    END IF;
  END IF;

  v_rules := jsonb_set(v_rules, '{active_cycle_token}', to_jsonb(p_cycle_token));
  v_rules := jsonb_set(v_rules, '{active_cycle_at}', to_jsonb(now()::text));
  UPDATE public.instagram_conversations SET stage_completed_rules = v_rules WHERE id = p_conversation_id;
  RETURN jsonb_build_object('success', true, 'reason', 'claimed',
    'activeCycleToken', p_cycle_token, 'staleRecovered', v_recovered,
    'previousCycleToken', CASE WHEN v_recovered THEN v_old_token ELSE NULL END,
    'releasedMessageCount', v_released, 'uncertainMessageCount', v_uncertain);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_experimental_cycle_messages(
  p_conversation_id text, p_cycle_token text, p_message_ids text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_msg_id text;
BEGIN
  SELECT stage_completed_rules INTO v_rules FROM public.instagram_conversations
    WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found'); END IF;
  IF v_rules->>'active_cycle_token' IS DISTINCT FROM p_cycle_token THEN
    RETURN jsonb_build_object('success', false, 'reason', 'cycle_token_mismatch');
  END IF;
  IF COALESCE((v_rules->>'preempt_requested')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'cycle_preempted');
  END IF;
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
  IF jsonb_typeof(v_ledger) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_ledger_contract');
  END IF;
  FOREACH v_msg_id IN ARRAY COALESCE(p_message_ids, ARRAY[]::text[]) LOOP
    IF NULLIF(btrim(v_msg_id), '') IS NOT NULL THEN
      v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], '"claimed"'::jsonb, true);
    END IF;
  END LOOP;
  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
  v_orch := jsonb_set(v_orch, '{activeClaimedMessageIds}', to_jsonb(COALESCE(p_message_ids, ARRAY[]::text[])));
  v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', '"processing"'::jsonb);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
  UPDATE public.instagram_conversations SET stage_completed_rules = v_rules WHERE id = p_conversation_id;
  RETURN jsonb_build_object('success', true, 'reason', 'messages_claimed');
END;
$$;

-- Seleção canônica do cron: debounce NULL também é elegível, mas só com inbound
-- realmente pendente. Evita varrer indefinidamente conversas já processadas.
CREATE OR REPLACE FUNCTION public.list_autopilot_due_conversations(p_now timestamptz DEFAULT now(), p_limit int DEFAULT 20)
RETURNS SETOF public.instagram_conversations LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.* FROM public.instagram_conversations c
  WHERE c.ai_auto_respond IS TRUE
    AND left(c.id, 2) <> '__'
    AND (c.ai_debounce_until IS NULL OR c.ai_debounce_until <= p_now)
    AND EXISTS (
      SELECT 1 FROM public.instagram_messages m
      WHERE m.conversation_id = c.id AND m.is_mine IS FALSE
        AND m.created_at >= p_now - interval '48 hours'
        AND COALESCE(c.stage_completed_rules->'orchestration'->'messageLedger'->>m.id, 'pending') <> 'processed'
    )
    AND (
      COALESCE((c.stage_completed_rules->'orchestration'->>'technicalRetryCount')::int, 0) < 3
      OR EXISTS (
        SELECT 1 FROM public.instagram_messages newer
        WHERE newer.conversation_id = c.id AND newer.is_mine IS FALSE
          AND newer.created_at > (c.stage_completed_rules->'orchestration'->>'technicalRetryExhaustedAt')::timestamptz
          AND COALESCE(c.stage_completed_rules->'orchestration'->'messageLedger'->>newer.id, 'pending') <> 'processed'
      )
    )
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT greatest(1, least(COALESCE(p_limit, 20), 50));
$$;

-- Release compare-and-set: nenhuma falha local pode rebaixar uma outbox que já
-- começou o HTTP para pending, nem liberar seu inbound para novo despacho.
CREATE OR REPLACE FUNCTION public.release_experimental_cycle_if_owned(
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
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_outbox jsonb;
  v_recent jsonb;
  v_key text;
  v_entry jsonb;
  v_existing jsonb;
  v_msg_id text;
  v_possible_send boolean := false;
  v_retry_count int;
  v_next_retry timestamptz;
BEGIN
  SELECT stage_completed_rules INTO v_rules FROM public.instagram_conversations
    WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('released', false, 'reason', 'conversation_not_found'); END IF;
  v_rules := COALESCE(v_rules, '{}'::jsonb);
  IF v_rules->>'active_cycle_token' IS DISTINCT FROM p_cycle_token THEN
    RETURN jsonb_build_object('released', false, 'reason', 'token_mismatch',
      'activeToken', v_rules->>'active_cycle_token');
  END IF;
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);
  IF jsonb_typeof(v_ledger) <> 'object' OR jsonb_typeof(v_outbox) <> 'object' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invalid_recovery_contract');
  END IF;
  IF p_outbox_map IS NOT NULL THEN
    IF jsonb_typeof(p_outbox_map) <> 'object' THEN
      RETURN jsonb_build_object('released', false, 'reason', 'invalid_outbox_contract');
    END IF;
    FOR v_key, v_entry IN SELECT * FROM jsonb_each(p_outbox_map) LOOP
      v_existing := v_outbox->v_key;
      IF v_existing->>'status' = 'sent' AND v_entry->>'status' <> 'sent' THEN
        v_entry := v_existing;
      ELSIF v_existing->>'status' IN ('sending', 'dispatch_uncertain')
        AND v_entry->>'status' NOT IN ('sent', 'dispatch_uncertain') THEN
        v_entry := v_existing || jsonb_build_object('status', 'dispatch_uncertain', 'isUncertain', true);
      END IF;
      v_outbox := jsonb_set(v_outbox, ARRAY[v_key], v_entry, true);
    END LOOP;
  END IF;
  FOR v_key, v_entry IN SELECT * FROM jsonb_each(v_outbox) LOOP
    IF v_entry->>'cycleId' = p_cycle_token THEN
      IF v_entry->>'status' = 'sending' THEN
        v_entry := v_entry || jsonb_build_object('status', 'dispatch_uncertain', 'isUncertain', true);
        v_outbox := jsonb_set(v_outbox, ARRAY[v_key], v_entry);
      END IF;
      IF v_entry->>'status' IN ('sent', 'dispatch_uncertain')
        OR NULLIF(v_entry->>'providerMessageId', '') IS NOT NULL
        OR COALESCE((v_entry->>'isUncertain')::boolean, false) THEN
        v_possible_send := true;
      END IF;
    END IF;
  END LOOP;

  FOREACH v_msg_id IN ARRAY COALESCE(p_revert_message_ids, ARRAY[]::text[]) LOOP
    IF NULLIF(btrim(v_msg_id), '') IS NOT NULL THEN
      v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], to_jsonb(CASE WHEN v_possible_send THEN 'processed' ELSE 'pending' END));
    END IF;
  END LOOP;
  FOREACH v_msg_id IN ARRAY COALESCE(p_mark_processed_ids, ARRAY[]::text[]) LOOP
    IF NULLIF(btrim(v_msg_id), '') IS NOT NULL THEN
      v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], '"processed"'::jsonb);
    END IF;
  END LOOP;
  -- Se o caller retornou/abortou antes de informar IDs, resolve todo o lote
  -- ainda claimed conforme a evidência persistida de envio.
  IF jsonb_typeof(v_orch->'activeClaimedMessageIds') = 'array' THEN
    FOR v_msg_id IN SELECT jsonb_array_elements_text(v_orch->'activeClaimedMessageIds') LOOP
      IF v_ledger->>v_msg_id = 'claimed' THEN
        v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id],
          to_jsonb(CASE WHEN v_possible_send THEN 'processed' ELSE 'pending' END));
      END IF;
    END LOOP;
  END IF;
  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
  v_orch := jsonb_set(v_orch, '{activeClaimedMessageIds}', '[]'::jsonb);
  IF p_processing_status IS NOT NULL THEN
    v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', to_jsonb(p_processing_status));
  END IF;
  IF p_processing_status = 'failed' AND p_last_error IS NOT NULL AND NOT v_possible_send THEN
    v_retry_count := LEAST(3, COALESCE((v_orch->>'technicalRetryCount')::int, 0) + 1);
    v_orch := jsonb_set(v_orch, '{technicalRetryCount}', to_jsonb(v_retry_count));
    IF v_retry_count >= 3 THEN
      v_orch := jsonb_set(v_orch, '{technicalRetryExhaustedAt}', to_jsonb(now()::text));
    ELSE
      v_next_retry := now() + (power(2, v_retry_count - 1)::int || ' minutes')::interval;
    END IF;
  ELSIF p_processing_status = 'sent' THEN
    v_orch := jsonb_set(v_orch, '{technicalRetryCount}', '0'::jsonb);
    v_orch := jsonb_set(v_orch, '{technicalRetryExhaustedAt}', 'null'::jsonb);
  END IF;
  IF p_last_error IS NOT NULL THEN
    v_orch := jsonb_set(v_orch, '{lastError}', to_jsonb(p_last_error));
  ELSIF p_processing_status = 'sent' THEN
    v_orch := jsonb_set(v_orch, '{lastError}', 'null'::jsonb);
  END IF;
  IF p_cycle_record IS NOT NULL THEN
    v_recent := CASE WHEN jsonb_typeof(v_orch->'recentCycles') = 'array'
      THEN v_orch->'recentCycles' ELSE '[]'::jsonb END;
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) INTO v_recent FROM (
      SELECT value FROM jsonb_array_elements(jsonb_build_array(p_cycle_record) || v_recent)
      WITH ORDINALITY AS t(value, ord) WHERE ord <= 5
    ) AS recent;
    v_orch := jsonb_set(v_orch, '{recentCycles}', v_recent);
  END IF;
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
  v_rules := jsonb_set(v_rules, '{active_cycle_token}', 'null'::jsonb);
  v_rules := jsonb_set(v_rules, '{active_cycle_at}', 'null'::jsonb);
  IF p_clear_cancel_flag THEN
    v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'null'::jsonb);
  END IF;
  UPDATE public.instagram_conversations SET stage_completed_rules = v_rules,
    ai_auto_respond = CASE WHEN p_debounce_until IS NOT NULL AND NOT v_possible_send AND COALESCE(v_retry_count, 0) < 3 THEN true ELSE ai_auto_respond END,
    ai_debounce_until = CASE WHEN p_debounce_until IS NOT NULL AND NOT v_possible_send AND COALESCE(v_retry_count, 0) < 3
      THEN greatest(p_debounce_until, COALESCE(v_next_retry, p_debounce_until))
      WHEN COALESCE(v_retry_count, 0) >= 3 THEN NULL
      ELSE ai_debounce_until END
    WHERE id = p_conversation_id;
  RETURN jsonb_build_object('released', true, 'reason', 'released', 'possibleSend', v_possible_send,
    'retryCount', COALESCE(v_retry_count, 0), 'retryExhausted', COALESCE(v_retry_count, 0) >= 3);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_experimental_cycle(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_experimental_cycle(text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.list_autopilot_due_conversations(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_autopilot_due_conversations(timestamptz, integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_experimental_cycle_messages(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_experimental_cycle_messages(text, text, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.release_experimental_cycle_if_owned(text, text, text, timestamptz, text[], text[], text, jsonb, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_experimental_cycle_if_owned(text, text, text, timestamptz, text[], text[], text, jsonb, jsonb, boolean) TO service_role;
