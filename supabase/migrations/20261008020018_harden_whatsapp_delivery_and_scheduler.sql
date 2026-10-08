-- Resultado desconhecido nunca autoriza reenvio; confirmação é monotônica.
CREATE OR REPLACE FUNCTION public.claim_whatsapp2_delivery_batch(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_stale_after_seconds integer DEFAULT 90,
  p_gateway_account_id text DEFAULT 'primary'
) RETURNS SETOF public.whatsapp2_delivery_queue
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  WITH stale AS (
    SELECT q.id FROM public.whatsapp2_delivery_queue q
    WHERE q.gateway_account_id = COALESCE(NULLIF(btrim(p_gateway_account_id), ''), 'primary')
      AND q.status = 'sending'
      AND (q.claimed_at IS NULL OR q.claimed_at < clock_timestamp() - make_interval(secs => greatest(10, p_stale_after_seconds)))
    ORDER BY q.created_at
    FOR UPDATE SKIP LOCKED LIMIT 25
  )
  UPDATE public.whatsapp2_delivery_queue q
  SET status = CASE WHEN NULLIF(btrim(q.provider_message_id), '') IS NOT NULL THEN 'sent' ELSE 'uncertain' END,
      last_error = CASE WHEN NULLIF(btrim(q.provider_message_id), '') IS NOT NULL THEN NULL ELSE 'whatsapp2_sending_stale_unknown_delivery' END,
      updated_at = clock_timestamp()
  FROM stale s WHERE q.id = s.id;

  RETURN QUERY
  WITH candidates AS (
    SELECT q.id FROM public.whatsapp2_delivery_queue q
    WHERE q.gateway_account_id = COALESCE(NULLIF(btrim(p_gateway_account_id), ''), 'primary')
      AND q.status = 'pending' AND NULLIF(btrim(q.provider_message_id), '') IS NULL
    ORDER BY q.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 5), 25))
  )
  UPDATE public.whatsapp2_delivery_queue q
  SET status = 'sending', claimed_by = NULLIF(btrim(p_worker_id), ''),
      claimed_at = clock_timestamp(), attempts = q.attempts + 1,
      last_error = NULL, updated_at = clock_timestamp()
  FROM candidates c WHERE q.id = c.id RETURNING q.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_whatsapp2_delivery(
  p_id text, p_worker_id text, p_success boolean,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL, p_uncertain boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.whatsapp2_delivery_queue%ROWTYPE;
  v_provider_id text;
  v_status text;
BEGIN
  SELECT * INTO v_row FROM public.whatsapp2_delivery_queue
  WHERE id = p_id AND (claimed_by = p_worker_id OR claimed_by IS NULL)
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'not_claimed'); END IF;
  IF v_row.status = 'sent' THEN
    RETURN jsonb_build_object('success', true, 'status', 'sent', 'provider_message_id', v_row.provider_message_id);
  END IF;
  IF v_row.status NOT IN ('sending', 'uncertain') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'delivery_not_inflight');
  END IF;
  v_provider_id := COALESCE(NULLIF(btrim(p_provider_message_id), ''), NULLIF(btrim(v_row.provider_message_id), ''));
  v_status := CASE WHEN v_provider_id IS NOT NULL THEN 'sent'
    WHEN p_success OR p_uncertain THEN 'uncertain' ELSE 'failed' END;
  UPDATE public.whatsapp2_delivery_queue
  SET status = v_status, provider_message_id = v_provider_id,
      last_error = CASE WHEN v_status = 'sent' THEN NULL
        WHEN p_success THEN 'whatsapp2_sent_without_provider_id' ELSE NULLIF(p_error, '') END,
      completed_at = CASE WHEN v_status IN ('sent', 'failed') THEN clock_timestamp() ELSE completed_at END,
      updated_at = clock_timestamp()
  WHERE id = p_id RETURNING * INTO v_row;
  RETURN jsonb_build_object('success', true, 'status', v_row.status, 'provider_message_id', v_row.provider_message_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_due_brain_action_conversations(
  p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 30
) RETURNS TABLE(conversation_id text, due_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH eligible AS (
    SELECT a.conversation_id, a.decision_id, a.action_index,
      COALESCE(a.not_before, a.created_at) AS due_at,
      EXISTS (SELECT 1 FROM public.brain_decision_actions prior
        WHERE prior.decision_id = a.decision_id AND prior.action_index < a.action_index AND prior.status = 'sent') AS started_batch
    FROM public.brain_decision_actions a
    JOIN public.instagram_conversations c ON c.id = a.conversation_id
    WHERE (a.not_before IS NULL OR a.not_before <= p_now)
      AND (
        (a.status IN ('pending','waiting_delay','sending','failed_retryable')
          AND COALESCE(c.ai_auto_respond, false)
          AND COALESCE(c.stage_completed_rules->>'status', 'idle') NOT IN
            ('waiting_human','disabled','paused_guardrail','paused_handoff','cancelled','failed')
          AND COALESCE(c.stage_completed_rules->>'cancel_current_cycle','false') <> 'true')
        OR (a.status = 'dispatch_uncertain' AND EXISTS (
          SELECT 1 FROM public.whatsapp2_delivery_queue q
          WHERE q.id = a.idempotency_key AND q.conversation_id = a.conversation_id
            AND q.status = 'sent' AND NULLIF(btrim(q.provider_message_id), '') IS NOT NULL
            AND q.gateway_account_id = CASE WHEN a.conversation_id ~ '^wa2:account-[0-9]{8,15}:'
              THEN split_part(a.conversation_id, ':', 2) ELSE 'primary' END
        ))
      )
      AND NOT EXISTS (SELECT 1 FROM public.brain_decision_actions prior
        WHERE prior.decision_id = a.decision_id AND prior.action_index < a.action_index AND prior.status <> 'sent')
  )
  SELECT e.conversation_id, MIN(e.due_at) AS due_at
  FROM eligible e GROUP BY e.conversation_id
  ORDER BY BOOL_OR(e.started_batch) DESC, MIN(e.due_at)
  LIMIT greatest(1, least(coalesce(p_limit, 30), 100));
$$;

-- Mantém as RPCs operacionais restritas ao backend.
REVOKE ALL ON FUNCTION public.claim_whatsapp2_delivery_batch(text,integer,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_whatsapp2_delivery(text,text,boolean,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_due_brain_action_conversations(timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp2_delivery_batch(text,integer,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp2_delivery(text,text,boolean,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_due_brain_action_conversations(timestamptz,integer) TO service_role;
