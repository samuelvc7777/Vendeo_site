-- Prevent permanently failed batches from poisoning the durable outbox scheduler.
-- Trailing actions after a confirmed permanent failure can never be delivered
-- because delivery ordering is strict. Terminalize those historical tails.

DO $$
DECLARE
  v_row record;
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_key text;
  v_entry jsonb;
BEGIN
  FOR v_row IN
    SELECT later.id AS action_id,
           later.conversation_id,
           later.idempotency_key
    FROM public.brain_decision_actions later
    WHERE later.status IN ('pending', 'waiting_delay')
      AND EXISTS (
        SELECT 1
        FROM public.brain_decision_actions prior
        WHERE prior.decision_id = later.decision_id
          AND prior.action_index < later.action_index
          AND prior.status = 'failed_confirmed'
      )
  LOOP
    SELECT stage_completed_rules
      INTO v_rules
    FROM public.instagram_conversations
    WHERE id = v_row.conversation_id
    FOR UPDATE;
    IF FOUND THEN
      v_rules := COALESCE(v_rules, '{}'::jsonb);
      v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
      v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);

      FOR v_key, v_entry IN SELECT * FROM jsonb_each(v_outbox) LOOP
        IF (v_entry->'payload'->>'brainActionId') = v_row.action_id
           OR v_key = v_row.idempotency_key
           OR (v_entry->>'idempotencyKey') = v_row.idempotency_key THEN
          IF v_entry->>'status' IN ('pending', 'waiting_delay') THEN
            v_outbox := jsonb_set(
              v_outbox,
              ARRAY[v_key],
              v_entry || jsonb_build_object(
                'status', 'cancelled',
                'lastError', 'blocked_by_failed_prior_action'
              ),
              true
            );
          END IF;
          EXIT;
        END IF;
      END LOOP;

      v_orch := jsonb_set(v_orch, '{outbox}', v_outbox, true);
      v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

      UPDATE public.instagram_conversations
      SET stage_completed_rules = v_rules
      WHERE id = v_row.conversation_id;
    END IF;

    UPDATE public.brain_decision_actions
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = v_row.action_id
      AND status IN ('pending', 'waiting_delay');
  END LOOP;
END;
$$;

UPDATE public.brain_decisions d
SET delivery_status = 'delivery_failed'
WHERE EXISTS (
  SELECT 1
  FROM public.brain_decision_actions a
  WHERE a.decision_id = d.id
    AND a.status = 'failed_confirmed'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.brain_decision_actions a
  WHERE a.decision_id = d.id
    AND a.status NOT IN ('failed_confirmed', 'cancelled')
);

-- Only return actions whose strict predecessors are all confirmed sent.
-- Among due conversations, prioritize batches that already started delivering.
CREATE OR REPLACE FUNCTION public.list_due_brain_action_conversations(
  p_now timestamptz DEFAULT now(),
  p_limit integer DEFAULT 30
) RETURNS TABLE (
  conversation_id text,
  due_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT
      a.conversation_id,
      a.decision_id,
      a.action_index,
      COALESCE(a.not_before, a.created_at) AS due_at,
      EXISTS (
        SELECT 1
        FROM public.brain_decision_actions sent_prior
        WHERE sent_prior.decision_id = a.decision_id
          AND sent_prior.action_index < a.action_index
          AND sent_prior.status = 'sent'
      ) AS started_batch
    FROM public.brain_decision_actions a
    WHERE a.status IN (
      'pending', 'waiting_delay', 'sending',
      'failed_retryable', 'dispatch_uncertain'
    )
      AND (a.not_before IS NULL OR a.not_before <= p_now)
      AND NOT EXISTS (
        SELECT 1
        FROM public.brain_decision_actions prior
        WHERE prior.decision_id = a.decision_id
          AND prior.action_index < a.action_index
          AND prior.status <> 'sent'
      )
  ),
  ranked AS (
    SELECT
      conversation_id,
      MIN(due_at) AS due_at,
      BOOL_OR(started_batch) AS has_started_batch
    FROM eligible
    GROUP BY conversation_id
  )
  SELECT conversation_id, due_at
  FROM ranked
  ORDER BY has_started_batch DESC, due_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
$$;

REVOKE ALL ON FUNCTION public.list_due_brain_action_conversations(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_due_brain_action_conversations(timestamptz, integer)
  TO service_role;
