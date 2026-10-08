CREATE OR REPLACE FUNCTION public.prepare_brain_action_manual_retry(
  p_conversation_id text,
  p_action_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action public.brain_decision_actions%ROWTYPE;
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_entry jsonb;
  v_key text;
  v_item record;
  v_retry_blocked_tail boolean := false;
BEGIN
  SELECT stage_completed_rules INTO v_rules
  FROM public.instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  SELECT * INTO v_action
  FROM public.brain_decision_actions
  WHERE id = p_action_id AND conversation_id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_action.status, '') NOT IN ('failed_confirmed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'action_not_confirmed_failed');
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);
  FOR v_item IN SELECT key, value FROM jsonb_each(v_outbox) LOOP
    IF v_item.value->'payload'->>'brainActionId' = p_action_id THEN
      v_key := v_item.key;
      v_entry := v_item.value;
      EXIT;
    END IF;
  END LOOP;
  IF v_entry IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'outbox_action_not_found');
  END IF;
  IF v_entry->>'status' IN ('sent', 'sending', 'dispatch_uncertain') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'action_not_safely_retryable');
  END IF;

  IF v_action.status = 'failed_confirmed' THEN
    IF v_entry->>'status' <> 'failed' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'outbox_not_confirmed_failed');
    END IF;
  ELSE
    IF v_entry->>'status' <> 'cancelled' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'outbox_not_confirmed_cancelled');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.brain_turn_events cancelled
      WHERE cancelled.conversation_id = p_conversation_id
        AND cancelled.decision_id = v_action.decision_id
        AND cancelled.action_id = p_action_id
        AND cancelled.event_type = 'action_cancelled'
        AND cancelled.metadata->'providerError'->>'message' = 'blocked_by_failed_prior_action'
        AND EXISTS (
          SELECT 1
          FROM public.brain_turn_events failed
          JOIN public.brain_decision_actions prior
            ON prior.id = failed.action_id
          WHERE prior.decision_id = v_action.decision_id
            AND prior.action_index < v_action.action_index
            AND failed.event_type = 'action_failed_confirmed'
            AND failed.metadata->'providerError'->>'message' IN (
              'whatsapp_recipient_identity_unresolved',
              'whatsapp2_recipient_identity_unresolved'
            )
            AND failed.created_at <= cancelled.created_at
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.brain_decision_actions prior
          WHERE prior.decision_id = v_action.decision_id
            AND prior.action_index < v_action.action_index
            AND prior.status <> 'sent'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.instagram_messages newer
          JOIN public.brain_decisions decision
            ON decision.id = v_action.decision_id
          WHERE newer.conversation_id = p_conversation_id
            AND COALESCE(newer.is_mine, false) = false
            AND newer.timestamp > decision.created_at
        )
    ) INTO v_retry_blocked_tail;

    IF NOT v_retry_blocked_tail THEN
      RETURN jsonb_build_object('success', false, 'reason', 'cancelled_action_not_safely_retryable');
    END IF;
  END IF;

  v_entry := v_entry || jsonb_build_object(
    'status', 'pending',
    'notBefore', now(),
    'deliveryMode', 'manual',
    'isUncertain', false,
    'lastError', NULL
  );
  v_outbox := jsonb_set(v_outbox, ARRAY[v_key], v_entry, true);
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

  UPDATE public.instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  UPDATE public.brain_decision_actions
  SET status = 'pending', delivery_mode = 'manual', updated_at = now()
  WHERE id = p_action_id;

  INSERT INTO public.brain_turn_events (
    conversation_id, session_id, turn_id, decision_id, action_id,
    event_type, status, human_message, metadata
  )
  SELECT p_conversation_id, decision.session_id, decision.turn_id,
    v_action.decision_id, p_action_id, 'manual_delivery_authorized', 'pending',
    'Operador autorizou o reenvio manual da ação após falha confirmada.',
    jsonb_build_object(
      'deliveryMode', 'manual',
      'recoveredBlockedAction', v_action.status = 'cancelled'
    )
  FROM public.brain_decisions decision
  WHERE decision.id = v_action.decision_id;

  RETURN jsonb_build_object('success', true, 'entry', v_entry, 'outbox_key', v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_brain_action_manual_retry(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_brain_action_manual_retry(text, text) TO service_role;
