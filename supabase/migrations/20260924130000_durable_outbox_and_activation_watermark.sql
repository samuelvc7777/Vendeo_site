-- Migration: 20260924130000_durable_outbox_and_activation_watermark.sql
-- Implementa:
-- 1. Persistência atômica do lote durável de Outbox (persist_durable_outbox_batch)
-- 2. Dispatcher desacoplado do ciclo de Brain em claim_outbox_entry (sem bloqueio por active_cycle_token antigo ou preempção de inbound)
-- 3. Validação temporal de not_before e ordem estrita por action_index
-- 4. Reconciliação determinística de outbox incerto (reconcile_outbox_entry)
-- 5. Watermark determinístico de ativação do autopiloto (set_activation_watermark_atomic)

-- 1. PERSISTÊNCIA ATÔMICA DO LOTE COMPLETO DE OUTBOX
CREATE OR REPLACE FUNCTION persist_durable_outbox_batch(
  p_conversation_id text,
  p_cycle_token text,
  p_outbox_entries jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_entry jsonb;
  v_target_key text;
  v_keys text[] := ARRAY[]::text[];
  v_existing jsonb;
  v_status text;
  v_count int := 0;
BEGIN
  -- Lock exclusivo a nível de linha da conversa
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);

  -- Itera sobre as entradas do array JSON do lote
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_outbox_entries) LOOP
    v_target_key := COALESCE(v_entry->>'idempotencyKey', v_entry->>'id');
    IF v_target_key IS NOT NULL AND v_target_key <> '' THEN
      v_existing := v_outbox->v_target_key;
      -- Preserva status 'sent' ou 'sending' caso já exista
      IF v_existing IS NOT NULL THEN
        v_status := v_existing->>'status';
        IF v_status IN ('sent', 'sending', 'dispatch_uncertain') THEN
          v_entry := v_entry || jsonb_build_object('status', v_status);
        END IF;
      END IF;

      v_outbox := jsonb_set(v_outbox, ARRAY[v_target_key], v_entry, true);
      v_keys := array_append(v_keys, v_target_key);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'persisted',
    'count', v_count,
    'keys', to_jsonb(v_keys)
  );
END;
$$;

-- 2. DISPATCHER DESACOPLADO COM ORDEM ESTRITA E NOT_BEFORE
CREATE OR REPLACE FUNCTION claim_outbox_entry(
  p_conversation_id text,
  p_outbox_id text,
  p_claim_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_target_key text := p_outbox_id;
  v_entry jsonb;
  v_status text;
  v_sending_at text;
  v_sending_at_ts timestamptz;
  v_not_before text;
  v_not_before_ts timestamptz;
  v_attempts int;
  v_updated_entry jsonb;
  v_k text;
  v_v jsonb;
  v_entry_index int;
  v_entry_cycle text;
  v_other_index int;
  v_other_status text;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para garantir exclusão mútua absoluta
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);

  -- 2. Localiza a entrada da outbox por chave, id ou idempotencyKey
  v_entry := v_outbox->p_outbox_id;
  IF v_entry IS NULL THEN
    FOR v_k, v_v IN SELECT * FROM jsonb_each(v_outbox) LOOP
      IF (v_v->>'id') = p_outbox_id OR (v_v->>'idempotencyKey') = p_outbox_id THEN
        v_target_key := v_k;
        v_entry := v_v;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_entry IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'outbox_entry_not_found');
  END IF;

  v_status := v_entry->>'status';

  -- 3. Se já enviada com sucesso, não reenvia
  IF v_status = 'sent' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_sent', 'entry', v_entry);
  END IF;

  -- 4. Se está com envio incerto, bloqueia retry automático cego
  IF v_status = 'dispatch_uncertain' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'dispatch_uncertain', 'isUncertain', true, 'entry', v_entry);
  END IF;

  -- 5. Se está em 'sending': checa se é ativo (<20s) ou stale (>=20s)
  IF v_status = 'sending' THEN
    v_sending_at := v_entry->>'sendingAt';
    IF v_sending_at IS NOT NULL THEN
      BEGIN
        v_sending_at_ts := v_sending_at::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_sending_at_ts := now();
      END;
    ELSE
      v_sending_at_ts := now();
    END IF;

    IF (now() - v_sending_at_ts) < interval '20 seconds' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'sending_active', 'entry', v_entry);
    ELSE
      -- SENDING STALE (>= 20s): Transiciona atomicamente para dispatch_uncertain
      v_updated_entry := v_entry || jsonb_build_object(
        'status', 'dispatch_uncertain',
        'isUncertain', true,
        'lastError', 'Sending stale detectado (>20s sem confirmação) - processo anterior pode ter entregue'
      );
      v_outbox := jsonb_set(v_outbox, ARRAY[v_target_key], v_updated_entry);
      v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
      v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

      UPDATE instagram_conversations
      SET stage_completed_rules = v_rules
      WHERE id = p_conversation_id;

      RETURN jsonb_build_object(
        'success', false,
        'reason', 'sending_stale_uncertain',
        'isUncertain', true,
        'entry', v_updated_entry
      );
    END IF;
  END IF;

  -- 6. Se está em 'pending': Valida dependências de ordem e not_before
  IF v_status = 'pending' THEN
    v_entry_index := COALESCE((v_entry->>'actionIndex')::int, 0);
    v_entry_cycle := v_entry->>'cycleId';

    -- 6.1. Validação de ordem estrita: nenhuma ação anterior do mesmo ciclo pode estar pendente/sending/uncertain
    IF v_entry_cycle IS NOT NULL AND v_entry_index > 0 THEN
      FOR v_k, v_v IN SELECT * FROM jsonb_each(v_outbox) LOOP
        IF (v_v->>'cycleId') = v_entry_cycle THEN
          v_other_index := COALESCE((v_v->>'actionIndex')::int, 0);
          v_other_status := COALESCE(v_v->>'status', 'pending');
          IF v_other_index < v_entry_index AND v_other_status <> 'sent' THEN
            RETURN jsonb_build_object(
              'success', false,
              'reason', 'blocked_by_prior_action',
              'priorIndex', v_other_index,
              'priorStatus', v_other_status,
              'entry', v_entry
            );
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 6.2. Validação temporal de not_before
    v_not_before := v_entry->>'notBefore';
    IF v_not_before IS NOT NULL THEN
      BEGIN
        v_not_before_ts := v_not_before::timestamptz;
        IF v_not_before_ts > now() THEN
          RETURN jsonb_build_object(
            'success', false,
            'reason', 'action_not_due_yet',
            'notBefore', v_not_before,
            'entry', v_entry
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Se parsing falhar, assume due agora
      END;
    END IF;

    -- 6.3. Adquire o claim atômico
    v_attempts := COALESCE((v_entry->>'attempts')::int, 0) + 1;
    v_updated_entry := v_entry || jsonb_build_object(
      'status', 'sending',
      'sendingAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'claimedBy', p_claim_token,
      'attempts', v_attempts
    );
    v_outbox := jsonb_set(v_outbox, ARRAY[v_target_key], v_updated_entry);
    v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

    UPDATE instagram_conversations
    SET stage_completed_rules = v_rules
    WHERE id = p_conversation_id;

    RETURN jsonb_build_object(
      'success', true,
      'reason', 'claimed',
      'entry', v_updated_entry
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'reason', 'invalid_status', 'entry', v_entry);
END;
$$;

-- 3. RECONCILIAÇÃO DETERMINÍSTICA DE OUTBOX INCERTO
CREATE OR REPLACE FUNCTION reconcile_outbox_entry(
  p_conversation_id text,
  p_outbox_id text,
  p_provider_message_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_target_key text := p_outbox_id;
  v_entry jsonb;
  v_updated_entry jsonb;
  v_k text;
  v_v jsonb;
BEGIN
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);

  v_entry := v_outbox->p_outbox_id;
  IF v_entry IS NULL THEN
    FOR v_k, v_v IN SELECT * FROM jsonb_each(v_outbox) LOOP
      IF (v_v->>'id') = p_outbox_id OR (v_v->>'idempotencyKey') = p_outbox_id THEN
        v_target_key := v_k;
        v_entry := v_v;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_entry IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'outbox_entry_not_found');
  END IF;

  v_updated_entry := v_entry || jsonb_build_object(
    'status', 'sent',
    'isUncertain', false,
    'providerMessageId', p_provider_message_id,
    'sentAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  v_outbox := jsonb_set(v_outbox, ARRAY[v_target_key], v_updated_entry);
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'reason', 'reconciled_sent', 'entry', v_updated_entry);
END;
$$;

-- 4. WATERMARK DETERMINÍSTICO E ATÔMICO DE ATIVAÇÃO
-- Realiza a leitura da última mensagem e gravação do watermark na mesma transação sob lock FOR UPDATE,
-- eliminando 100% da janela de race entre leitura no cliente e gravação no banco.
CREATE OR REPLACE FUNCTION arm_autopilot_with_watermark_atomic(
  p_conversation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_current_rev int;
  v_watermark jsonb;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para serialização atômica estrita
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  -- 2. Lê a revisão monotônica atual de inbound
  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_current_rev := COALESCE((v_orch->>'inboundRevision')::int, 0);

  -- 3. Watermark autoritativo: unicamente inboundRevision sob lock FOR UPDATE (zero heurísticas temporais)
  v_watermark := jsonb_build_object(
    'inboundRevision', v_current_rev
  );

  -- 4. Atualiza stage_completed_rules e ativa o autopiloto sob o mesmo lock
  v_orch := jsonb_set(v_orch, '{activation_watermark}', v_watermark, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  UPDATE instagram_conversations
  SET 
    stage_completed_rules = v_rules,
    ai_auto_respond = true,
    ai_debounce_until = NULL
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'watermark', v_watermark, 'inbound_revision', v_current_rev);
END;
$$;

CREATE OR REPLACE FUNCTION set_activation_watermark_atomic(
  p_conversation_id text,
  p_watermark jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
BEGIN
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_orch := jsonb_set(v_orch, '{activation_watermark}', p_watermark, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  UPDATE instagram_conversations
  SET 
    stage_completed_rules = v_rules,
    ai_auto_respond = true,
    ai_debounce_until = NULL
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'watermark', p_watermark);
END;
$$;

-- 4.1. SERIALIZAÇÃO ATÔMICA DE INBOUND VIA WEBHOOK
-- Garante que a gravação física de mensagens inbound do webhook ocorra sob o mesmo lock FOR UPDATE
-- da conversa, eliminando janelas de corrida com arm_autopilot_with_watermark_atomic
CREATE OR REPLACE FUNCTION record_inbound_message_atomic(
  p_conversation_id text,
  p_message_id text,
  p_contact_id text,
  p_sender_id text,
  p_text text,
  p_timestamp text,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL,
  p_reply_to_message_id text DEFAULT NULL,
  p_audio_transcript text DEFAULT NULL,
  p_audio_transcription_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_current_rev int;
  v_new_rev int;
  v_ledger jsonb;
  v_msg_revs jsonb;
  v_auto_respond boolean;
  v_is_restricted boolean;
  v_watermark jsonb;
  v_watermark_rev int;
  v_eligible_after_activation boolean;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para serializar com arm_autopilot_with_watermark_atomic
  SELECT stage_completed_rules, COALESCE(ai_auto_respond, false), COALESCE(is_restricted, false)
  INTO v_rules, v_auto_respond, v_is_restricted
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  -- 2. Upsert da mensagem na tabela instagram_messages sob lock da conversa
  INSERT INTO instagram_messages (
    id, conversation_id, contact_id, sender_id, text, timestamp,
    is_mine, status, media_url, media_type, reply_to_message_id,
    direction, audio_transcript, audio_transcribed_at, audio_transcription_error,
    created_at
  ) VALUES (
    p_message_id, p_conversation_id, p_contact_id, p_sender_id, p_text, p_timestamp,
    false, 'delivered', p_media_url, p_media_type, p_reply_to_message_id,
    'inbound', p_audio_transcript, CASE WHEN p_audio_transcript IS NOT NULL THEN NOW() ELSE NULL END, p_audio_transcription_error,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    text = EXCLUDED.text,
    audio_transcript = COALESCE(EXCLUDED.audio_transcript, instagram_messages.audio_transcript),
    audio_transcription_error = EXCLUDED.audio_transcription_error,
    media_url = COALESCE(EXCLUDED.media_url, instagram_messages.media_url),
    media_type = COALESCE(EXCLUDED.media_type, instagram_messages.media_type);

  IF NOT FOUND AND v_rules IS NULL THEN
    RETURN jsonb_build_object('success', true, 'conversation_exists', false, 'inbound_revision', 1, 'eligible_after_activation', false);
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_current_rev := COALESCE((v_orch->>'inboundRevision')::int, 0);
  v_new_rev := v_current_rev + 1;

  -- 3. Atualiza inboundRevision, messageInboundRevisions e messageLedger de forma monotônica
  v_orch := jsonb_set(v_orch, '{inboundRevision}', to_jsonb(v_new_rev));
  
  v_msg_revs := COALESCE(v_orch->'messageInboundRevisions', '{}'::jsonb);
  v_msg_revs := jsonb_set(v_msg_revs, ARRAY[p_message_id], to_jsonb(v_new_rev), true);
  v_orch := jsonb_set(v_orch, '{messageInboundRevisions}', v_msg_revs);

  v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
  v_ledger := jsonb_set(v_ledger, ARRAY[p_message_id], '"pending"'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);

  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  v_watermark := v_orch->'activation_watermark';
  IF v_watermark IS NOT NULL AND (v_watermark ? 'inboundRevision') THEN
    v_watermark_rev := (v_watermark->>'inboundRevision')::int;
  ELSE
    v_watermark_rev := NULL;
  END IF;

  v_eligible_after_activation := (
    v_auto_respond AND 
    NOT v_is_restricted AND 
    (v_watermark_rev IS NULL OR v_new_rev > v_watermark_rev)
  );

  RETURN jsonb_build_object(
    'success', true,
    'inbound_revision', v_new_rev,
    'ai_auto_respond', v_auto_respond,
    'is_restricted', v_is_restricted,
    'watermark_revision', v_watermark_rev,
    'eligible_after_activation', v_eligible_after_activation
  );
END;
$$;

-- 5. FINALIZAÇÃO ATÔMICA DE OUTBOX ENTRY (SENT / FAILED / DISPATCH_UNCERTAIN)
CREATE OR REPLACE FUNCTION finalize_outbox_entry(
  p_conversation_id text,
  p_outbox_id text,
  p_status text,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_target_key text := p_outbox_id;
  v_entry jsonb;
  v_updated_entry jsonb;
  v_k text;
  v_v jsonb;
BEGIN
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);

  v_entry := v_outbox->p_outbox_id;
  IF v_entry IS NULL THEN
    FOR v_k, v_v IN SELECT * FROM jsonb_each(v_outbox) LOOP
      IF (v_v->>'id') = p_outbox_id OR (v_v->>'idempotencyKey') = p_outbox_id THEN
        v_target_key := v_k;
        v_entry := v_v;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_entry IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'outbox_entry_not_found');
  END IF;

  -- Se já estava 'sent', preserva por idempotência
  IF (v_entry->>'status') = 'sent' AND p_status <> 'sent' THEN
    RETURN jsonb_build_object('success', true, 'reason', 'already_sent_preserved', 'entry', v_entry);
  END IF;

  v_updated_entry := v_entry || jsonb_build_object(
    'status', p_status,
    'lastError', p_error
  );

  IF p_status = 'sent' THEN
    v_updated_entry := v_updated_entry || jsonb_build_object(
      'isUncertain', false,
      'providerMessageId', COALESCE(p_provider_message_id, v_entry->>'providerMessageId'),
      'sentAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  ELSIF p_status = 'dispatch_uncertain' THEN
    v_updated_entry := v_updated_entry || jsonb_build_object('isUncertain', true);
  END IF;

  v_outbox := jsonb_set(v_outbox, ARRAY[v_target_key], v_updated_entry);
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'reason', 'finalized', 'status', p_status, 'entry', v_updated_entry);
END;
$$;

-- Permissões de execução para service_role
REVOKE ALL ON FUNCTION persist_durable_outbox_batch(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION persist_durable_outbox_batch(text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION claim_outbox_entry(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbox_entry(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION reconcile_outbox_entry(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconcile_outbox_entry(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION set_activation_watermark_atomic(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_activation_watermark_atomic(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION arm_autopilot_with_watermark_atomic(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arm_autopilot_with_watermark_atomic(text) TO service_role;

REVOKE ALL ON FUNCTION finalize_outbox_entry(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_outbox_entry(text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION record_inbound_message_atomic(text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inbound_message_atomic(text, text, text, text, text, text, text, text, text, text, text) TO service_role, authenticated, anon;

GRANT EXECUTE ON FUNCTION arm_autopilot_with_watermark_atomic(text) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION set_activation_watermark_atomic(text, jsonb) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION persist_durable_outbox_batch(text, text, jsonb) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION claim_outbox_entry(text, text, text) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION reconcile_outbox_entry(text, text, text) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION finalize_outbox_entry(text, text, text, text, text) TO service_role, authenticated, anon;
