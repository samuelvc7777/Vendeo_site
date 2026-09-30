-- Once a Brain outbox batch has started delivering, a newer inbound must not
-- freeze the remaining balloons. Unstarted batches remain fail-closed.
CREATE OR REPLACE FUNCTION public.claim_outbox_entry_brain_safe(
  p_conversation_id text,
  p_outbox_id text,
  p_claim_token text,
  p_cycle_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_active_cycle text;
  v_has_pending_inbound boolean;
  v_target_cycle text;
  v_batch_started boolean := false;
BEGIN
  SELECT stage_completed_rules INTO v_rules
  FROM public.instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_active_cycle := v_rules->>'active_cycle_token';
  v_target_cycle := COALESCE(
    NULLIF(p_cycle_id, ''),
    v_orch->'outbox'->p_outbox_id->>'cycleId'
  );

  IF v_target_cycle IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_each(COALESCE(v_orch->'outbox', '{}'::jsonb)) AS queued(outbox_key, entry)
      WHERE queued.entry->>'cycleId' = v_target_cycle
        AND queued.entry->>'status' = 'sent'
    ) INTO v_batch_started;
  END IF;

  IF v_active_cycle IS NOT NULL
     AND v_target_cycle IS DISTINCT FROM v_active_cycle
     AND NOT v_batch_started THEN
    RETURN jsonb_build_object('success', false, 'reason', 'brain_review_in_progress');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_each(COALESCE(v_orch->'messageLedger', '{}'::jsonb)) AS ledger(message_id, message_status)
    WHERE ledger.message_status = '"pending"'::jsonb
  ) INTO v_has_pending_inbound;

  IF v_has_pending_inbound AND NOT v_batch_started THEN
    RETURN jsonb_build_object('success', false, 'reason', 'pending_inbound_requires_brain_review');
  END IF;

  RETURN public.claim_outbox_entry(
    p_conversation_id,
    p_outbox_id,
    p_claim_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_outbox_entry_brain_safe(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_entry_brain_safe(text, text, text, text)
  TO service_role;
