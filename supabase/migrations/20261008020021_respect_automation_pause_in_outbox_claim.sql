CREATE OR REPLACE FUNCTION public.claim_outbox_entry(p_conversation_id text, p_outbox_id text, p_claim_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rules jsonb;
  v_ai_enabled boolean;
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
  SELECT stage_completed_rules, ai_auto_respond INTO v_rules, v_ai_enabled
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
    IF NOT COALESCE(v_ai_enabled, false)
      OR COALESCE(v_rules->>'status', 'idle') IN ('waiting_human','disabled','paused_guardrail','paused_handoff','cancelled','failed')
      OR COALESCE(v_rules->>'cancel_current_cycle', 'false') = 'true' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'automation_paused', 'entry', v_entry);
    END IF;
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
$function$

