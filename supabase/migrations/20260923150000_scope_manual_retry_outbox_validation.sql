-- Migration local: escopo da validação de outbox por lote pendente na autorização manual de retry
-- Impede que outbox histórica de ciclos passados bloqueie o retry de novos lotes pendentes.

CREATE OR REPLACE FUNCTION public.authorize_manual_autopilot_retry(
  p_conversation_id text,
  p_new_cycle_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_outbox jsonb;
  v_recent_cycles jsonb;
  v_active_cycle jsonb;
  v_active_token text;
  v_active_at timestamptz;
  v_key text;
  v_entry jsonb;
  v_msg_id text;
  v_pending_count int := 0;
  v_pending_ids text[] := ARRAY[]::text[];
  v_ai_auto boolean;
  v_technical_retry_count int;
  v_exhausted_at text;
  v_last_error text;
  v_old_cycle text;
  
  -- Variáveis para escopo de ciclos relevantes
  v_relevant_cycle_ids text[] := ARRAY[]::text[];
  v_unrelated_cycle_ids text[] := ARRAY[]::text[];
  v_cycle_item jsonb;
  v_cycle_id text;
  v_claimed_ids text[];
  v_outbox_cycle_id text;
  v_is_relevant_outbox boolean;
BEGIN
  -- 1. Lock exclusivo na linha da conversa
  SELECT stage_completed_rules, ai_auto_respond
    INTO v_rules, v_ai_auto
    FROM public.instagram_conversations
    WHERE id = p_conversation_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found', 'message', 'Conversa não encontrada.');
  END IF;

  -- 2. Verifica se o autopiloto da conversa está ativado
  IF v_ai_auto IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'reason', 'autopilot_disabled', 'message', 'O autopiloto está desativado para esta conversa.');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);
  v_recent_cycles := COALESCE(v_orch->'recentCycles', '[]'::jsonb);
  v_active_cycle := v_orch->'activeCycle';

  -- 3. Verifica se existe ciclo ativo no momento (evita corrida/concorrência com outro worker)
  v_active_token := v_rules->>'active_cycle_token';
  IF v_active_token IS NOT NULL AND v_active_token <> '' THEN
    BEGIN
      v_active_at := (v_rules->>'active_cycle_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_active_at := NULL;
    END;
    -- Se o ciclo ativo tem menos de 300 segundos, é considerado ativo e bloqueia retry
    IF v_active_at IS NOT NULL AND now() - v_active_at < interval '300 seconds' THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'active_cycle_running',
        'message', 'Já existe um ciclo do Brain em execução para esta conversa.',
        'activeCycleToken', v_active_token
      );
    END IF;
  END IF;

  -- 4. Verifica se o estado realmente está esgotado (technicalRetryCount >= 3 ou technicalRetryExhaustedAt IS NOT NULL)
  v_technical_retry_count := COALESCE((v_orch->>'technicalRetryCount')::int, 0);
  v_exhausted_at := v_orch->>'technicalRetryExhaustedAt';
  v_last_error := v_orch->>'lastError';

  IF v_technical_retry_count < 3 AND v_exhausted_at IS NULL AND v_last_error <> 'technical_retry_exhausted' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_exhausted', 'message', 'As tentativas técnicas automáticas ainda não se esgotaram.');
  END IF;

  -- 5. RESOLVER PRIMEIRO O LOTE PENDENTE (pendingMessageIds)
  FOR v_msg_id, v_entry IN SELECT key, value FROM jsonb_each_text(v_ledger) LOOP
    IF v_entry = 'pending' THEN
      v_pending_count := v_pending_count + 1;
      v_pending_ids := array_append(v_pending_ids, v_msg_id);
    END IF;
  END LOOP;

  -- Se não há mensagens pending no ledger, busca inbounds recentes não processadas (< 48h)
  IF v_pending_count = 0 THEN
    FOR v_msg_id IN 
      SELECT m.id FROM public.instagram_messages m
      WHERE m.conversation_id = p_conversation_id
        AND m.is_mine IS FALSE
        AND m.created_at >= now() - interval '48 hours'
        AND COALESCE(v_ledger->>m.id, 'pending') <> 'processed'
      ORDER BY m.created_at DESC
      LIMIT 10
    LOOP
      v_pending_count := v_pending_count + 1;
      v_pending_ids := array_append(v_pending_ids, v_msg_id);
      v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], '"pending"'::jsonb);
    END LOOP;
  END IF;

  IF v_pending_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_pending_messages', 'message', 'Não há mensagens pendentes a responder.');
  END IF;

  -- 6. IDENTIFICAR CICLOS RELACIONADOS AO LOTE PENDENTE
  -- Itera sobre recentCycles e activeCycle para classificar quais ciclos processaram este lote
  IF jsonb_typeof(v_recent_cycles) = 'array' THEN
    FOR v_cycle_item IN SELECT * FROM jsonb_array_elements(v_recent_cycles) LOOP
      v_cycle_id := v_cycle_item->>'cycleId';
      IF v_cycle_id IS NOT NULL AND v_cycle_id <> '' THEN
        -- Extrai claimedMessageIds como array de texto
        SELECT COALESCE(array_agg(value#>>'{}'), ARRAY[]::text[]) INTO v_claimed_ids
          FROM jsonb_array_elements(COALESCE(v_cycle_item->'claimedMessageIds', '[]'::jsonb));
        
        -- Verifica interseção entre v_claimed_ids e v_pending_ids
        IF v_claimed_ids IS NOT NULL AND array_length(v_claimed_ids, 1) > 0 AND v_claimed_ids && v_pending_ids THEN
          v_relevant_cycle_ids := array_append(v_relevant_cycle_ids, v_cycle_id);
        ELSIF v_claimed_ids IS NOT NULL AND array_length(v_claimed_ids, 1) > 0 THEN
          v_unrelated_cycle_ids := array_append(v_unrelated_cycle_ids, v_cycle_id);
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_active_cycle IS NOT NULL AND jsonb_typeof(v_active_cycle) = 'object' THEN
    v_cycle_id := v_active_cycle->>'cycleId';
    IF v_cycle_id IS NOT NULL AND v_cycle_id <> '' THEN
      SELECT COALESCE(array_agg(value#>>'{}'), ARRAY[]::text[]) INTO v_claimed_ids
        FROM jsonb_array_elements(COALESCE(v_active_cycle->'claimedMessageIds', '[]'::jsonb));
      
      IF v_claimed_ids IS NOT NULL AND array_length(v_claimed_ids, 1) > 0 AND v_claimed_ids && v_pending_ids THEN
        v_relevant_cycle_ids := array_append(v_relevant_cycle_ids, v_cycle_id);
      ELSIF v_claimed_ids IS NOT NULL AND array_length(v_claimed_ids, 1) > 0 THEN
        v_unrelated_cycle_ids := array_append(v_unrelated_cycle_ids, v_cycle_id);
      END IF;
    END IF;
  END IF;

  -- 7. VALIDAÇÃO DE OUTBOX ESCOPADA (Fail-Closed apenas para o lote relevante ou ambíguo)
  FOR v_key, v_entry IN SELECT * FROM jsonb_each(v_outbox) LOOP
    v_outbox_cycle_id := COALESCE(v_entry->>'cycleId', '');
    
    -- Determina se a entrada de outbox é relevante ao lote atual:
    -- 1) Se o cycleId pertence aos ciclos relevantes deste lote: RELEVANTE
    -- 2) Se o cycleId pertence comprovadamente aos ciclos não-relacionados (outros lotes): IGNORA
    -- 3) Se o cycleId for desconhecido/ambíguo: FAIL-CLOSED (trata como relevante)
    IF v_outbox_cycle_id <> '' AND v_outbox_cycle_id = ANY(v_relevant_cycle_ids) THEN
      v_is_relevant_outbox := true;
    ELSIF v_outbox_cycle_id <> '' AND v_outbox_cycle_id = ANY(v_unrelated_cycle_ids) THEN
      v_is_relevant_outbox := false;
    ELSE
      -- Ambiguidade: se a outbox tem cycleId desconhecido ou não rastreado, age fail-closed
      v_is_relevant_outbox := true;
    END IF;

    IF v_is_relevant_outbox THEN
      IF v_entry->>'status' IN ('sent') OR NULLIF(v_entry->>'providerMessageId', '') IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'reason', 'outbox_already_sent',
          'message', 'Já existe mensagem enviada confirmada neste lote.',
          'blockingCycleId', v_outbox_cycle_id
        );
      END IF;
      IF v_entry->>'status' IN ('sending') THEN
        RETURN jsonb_build_object(
          'success', false,
          'reason', 'outbox_sending',
          'message', 'Existe mensagem em processo de envio no momento.',
          'blockingCycleId', v_outbox_cycle_id
        );
      END IF;
      IF v_entry->>'status' IN ('dispatch_uncertain') OR COALESCE((v_entry->>'isUncertain')::boolean, false) IS TRUE THEN
        RETURN jsonb_build_object(
          'success', false,
          'reason', 'outbox_uncertain',
          'message', 'Há um envio anterior com confirmação incerta para este lote. Não é seguro reenviar automaticamente.',
          'blockingCycleId', v_outbox_cycle_id
        );
      END IF;
    END IF;
  END LOOP;

  -- 8. AUTORIZAÇÃO ATÔMICA:
  -- - Registra o novo cycle_token
  -- - Marca manualRetryAttempt = true
  -- - Vincula previousCycleToken
  -- - Mantém technicalRetryCount em 3 para que o cron NÃO assuma
  v_old_cycle := COALESCE(v_rules->>'active_cycle_token', v_orch->>'lastCycleId');
  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
  v_orch := jsonb_set(v_orch, '{manualRetryAttempt}', 'true'::jsonb);
  v_orch := jsonb_set(v_orch, '{manualRetryCycleId}', to_jsonb(p_new_cycle_token));
  v_orch := jsonb_set(v_orch, '{manualRetryAuthorizedAt}', to_jsonb(now()::text));
  IF v_old_cycle IS NOT NULL THEN
    v_orch := jsonb_set(v_orch, '{manualRetryOfCycleId}', to_jsonb(v_old_cycle));
  END IF;

  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
  v_rules := jsonb_set(v_rules, '{active_cycle_token}', to_jsonb(p_new_cycle_token));
  v_rules := jsonb_set(v_rules, '{active_cycle_at}', to_jsonb(now()::text));

  UPDATE public.instagram_conversations
    SET stage_completed_rules = v_rules
    WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'authorized',
    'cycleToken', p_new_cycle_token,
    'previousCycleToken', v_old_cycle,
    'pendingMessageIds', to_jsonb(v_pending_ids),
    'pendingCount', v_pending_count,
    'relevantCycleIds', to_jsonb(v_relevant_cycle_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_manual_autopilot_retry(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_manual_autopilot_retry(text, text) TO service_role;
