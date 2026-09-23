-- ==============================================================================
-- Migration: 20260920193100_update_claim_outbox_entry_with_ownership.sql
-- Descrição: Atualiza a função claim_outbox_entry para validar estritamente
--            a propriedade do ciclo (active_cycle_token = p_claim_token) e que
--            nenhuma preempção foi solicitada (preempt_requested is not true)
--            ANTES de transicionar qualquer entrada para 'sending'.
-- ==============================================================================

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
  v_attempts int;
  v_updated_entry jsonb;
  v_k text;
  v_v jsonb;
  v_active_token text;
  v_preempt_requested boolean;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para garantir exclusão mútua absoluta no PostgreSQL
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

  -- 2. Valida se o ciclo detém a custódia exclusiva do lock
  IF v_active_token IS NULL OR v_active_token <> p_claim_token THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'cycle_token_mismatch',
      'activeToken', v_active_token
    );
  END IF;

  -- 3. Valida se preempção foi solicitada concorrentemente
  IF v_preempt_requested IS TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'cycle_preempted'
    );
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);

  -- 4. Localiza a entrada da outbox por chave, id ou idempotencyKey
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

  -- 5. Se já enviada com sucesso pela Meta, não reenvia
  IF v_status = 'sent' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_sent', 'entry', v_entry);
  END IF;

  -- 6. Se está com envio incerto (timeout de rede anterior), bloqueia retry automático
  IF v_status = 'dispatch_uncertain' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'dispatch_uncertain', 'isUncertain', true, 'entry', v_entry);
  END IF;

  -- 7. Se está em 'sending': checa se é ativo (<20s) ou stale (>=20s)
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
      -- SENDING STALE (>= 20s): Transiciona atomicamente para dispatch_uncertain no banco
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

  -- 8. Se está em 'pending': Adquire o claim atômico
  IF v_status = 'pending' THEN
    v_attempts := COALESCE((v_entry->>'attempts')::int, 0) + 1;
    v_updated_entry := v_entry || jsonb_build_object(
      'status', 'sending',
      'sendingAt', to_jsonb(now())::text,
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
      'entry', v_updated_entry
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'reason', 'invalid_status', 'entry', v_entry);
END;
$$;
