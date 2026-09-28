-- Teto determinístico do debounce do AutoPilot.
-- Mantém o quiet period configurável sem permitir adiamento indefinido.

CREATE OR REPLACE FUNCTION public.schedule_autopilot_debounce_capped(
  p_conversation_id text,
  p_quiet_seconds integer,
  p_max_window_seconds integer,
  p_preempt boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_existing_until timestamptz;
  v_started_at timestamptz;
  v_deadline_at timestamptz;
  v_candidate_at timestamptz;
  v_scheduled_at timestamptz;
  v_quiet_seconds integer := GREATEST(COALESCE(p_quiet_seconds, 0), 0);
  v_max_seconds integer := GREATEST(
    COALESCE(p_max_window_seconds, p_quiet_seconds, 0),
    GREATEST(COALESCE(p_quiet_seconds, 0), 0)
  );
BEGIN
  SELECT stage_completed_rules, ai_debounce_until
    INTO v_rules, v_existing_until
    FROM public.instagram_conversations
   WHERE id = p_conversation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := CASE WHEN jsonb_typeof(v_rules) = 'object' THEN v_rules ELSE '{}'::jsonb END;
  v_orch := CASE
    WHEN jsonb_typeof(v_rules->'orchestration') = 'object'
      THEN v_rules->'orchestration'
    ELSE '{}'::jsonb
  END;

  IF v_existing_until IS NOT NULL AND v_existing_until > now() THEN
    BEGIN
      v_started_at := NULLIF(v_orch->>'debounceWindowStartedAt', '')::timestamptz;
      v_deadline_at := NULLIF(v_orch->>'debounceDeadlineAt', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_started_at := NULL;
      v_deadline_at := NULL;
    END;
  END IF;

  IF v_started_at IS NULL OR v_deadline_at IS NULL OR v_deadline_at <= now() THEN
    v_started_at := now();
    v_deadline_at := v_started_at + make_interval(secs => v_max_seconds);
  END IF;

  v_candidate_at := now() + make_interval(secs => v_quiet_seconds);
  v_scheduled_at := LEAST(v_candidate_at, v_deadline_at);

  v_orch := jsonb_set(v_orch, '{debounceWindowStartedAt}', to_jsonb(v_started_at), true);
  v_orch := jsonb_set(v_orch, '{debounceDeadlineAt}', to_jsonb(v_deadline_at), true);
  IF p_preempt THEN
    v_orch := jsonb_set(v_orch, '{preemptRequested}', 'true'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{preempt_requested}', 'true'::jsonb, true);
  END IF;
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

  UPDATE public.instagram_conversations
     SET stage_completed_rules = v_rules,
         ai_auto_respond = true,
         ai_debounce_until = v_scheduled_at
   WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'scheduled_at', v_scheduled_at,
    'window_started_at', v_started_at,
    'deadline_at', v_deadline_at,
    'capped', v_candidate_at > v_deadline_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_autopilot_debounce_capped(text, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_autopilot_debounce_capped(text, integer, integer, boolean)
  TO service_role;