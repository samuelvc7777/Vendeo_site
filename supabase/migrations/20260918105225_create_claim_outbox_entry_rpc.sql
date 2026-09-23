CREATE OR REPLACE FUNCTION claim_outbox_entry(
  p_conversation_id text,
  p_outbox_id text,
  p_claim_token text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_entry_key text;
  v_entry jsonb;
  v_status text;
  v_sending_at text;
  v_sending_at_ms bigint;
  v_now_ms bigint;
BEGIN
  -- 1. Lock exclusivo a nível de linha no Postgres (FOR UPDATE)
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);

  -- 2. Localiza a entrada da outbox por chave direta ou por campos id/idempotencyKey
  IF v_outbox ? p_outbox_id THEN
    v_entry_key := p_outbox_id;
    v_entry := v_outbox->p_outbox_id;
  ELSE
    SELECT key, value INTO v_entry_key, v_entry
    FROM jsonb_each(v_outbox)
    WHERE value->>'id' = p_outbox_id OR value->>'idempotencyKey' = p_outbox_id
    LIMIT 1;
  END IF;

  IF v_entry IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'outbox_entry_not_found');
  END IF;

  v_status := v_entry->>'status';

  -- 3. Se já enviada: idempotência estrita
  IF v_status = 'sent' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'already_sent',
      'providerMessageId', v_entry->>'providerMessageId'
    );
  END IF;

  -- 4. Se incerta: retry automático bloqueado
  IF v_status = 'dispatch_uncertain' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'dispatch_uncertain');
  END IF;

  -- 5. Se status = 'sending':
  IF v_status = 'sending' THEN
    v_sending_at := v_entry->>'sendingAt';
    IF v_sending_at IS NOT NULL THEN
      v_sending_at_ms := (EXTRACT(EPOCH FROM v_sending_at::timestamptz) * 1000)::bigint;
      v_now_ms := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;

      -- Envio ativo recente (< 20s): rejeita por concorrência ativa
      IF (v_now_ms - v_sending_at_ms) < 20000 THEN
        RETURN jsonb_build_object('success', false, 'reason', 'sending_active');
      ELSE
        -- Envio stale (>= 20s): PROCESSO CAIU APÓS OU DURANTE ENVIO!
        -- Conforme regra 1 e 3: Não podemos presumir que não enviou. Marca dispatch_uncertain!
        v_entry := v_entry || jsonb_build_object(
          'status', 'dispatch_uncertain',
          'isUncertain', true,
          'lastError', 'Sending stale detectado (>20s sem confirmação) - processo anterior pode ter entregue'
        );
        v_outbox := jsonb_set(v_outbox, ARRAY[v_entry_key], v_entry);
        v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
        v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

        UPDATE instagram_conversations
        SET stage_completed_rules = v_rules
        WHERE id = p_conversation_id;

        RETURN jsonb_build_object('success', false, 'reason', 'sending_stale_uncertain');
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'reason', 'sending_active');
    END IF;
  END IF;

  -- 6. Somente se status = 'pending', adquire o direito de envio atomicamente
  IF v_status = 'pending' THEN
    v_entry := v_entry || jsonb_build_object(
      'status', 'sending',
      'sendingAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'claimedBy', p_claim_token,
      'attempts', COALESCE((v_entry->>'attempts')::int, 0) + 1
    );
    v_outbox := jsonb_set(v_outbox, ARRAY[v_entry_key], v_entry);
    v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

    UPDATE instagram_conversations
    SET stage_completed_rules = v_rules
    WHERE id = p_conversation_id;

    RETURN jsonb_build_object(
      'success', true,
      'entry', v_entry
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'reason', 'invalid_status', 'status', v_status);
END;
$$;;
