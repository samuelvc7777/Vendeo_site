ALTER TABLE public.brain_turns
  ADD COLUMN IF NOT EXISTS recovery_lease_token text,
  ADD COLUMN IF NOT EXISTS recovery_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_brain_turns_late_recovery
  ON public.brain_turns (recovery_lease_expires_at, created_at)
  WHERE status = 'brain_late';

CREATE TABLE IF NOT EXISTS public.brain_manual_facts (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.brain_sessions(id) ON DELETE CASCADE,
  turn_id text NOT NULL REFERENCES public.brain_turns(id) ON DELETE CASCADE,
  memory_key text,
  question text NOT NULL,
  fact text NOT NULL,
  permanent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_manual_facts_session
  ON public.brain_manual_facts (conversation_id, session_id, created_at);
ALTER TABLE public.brain_manual_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brain_manual_facts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brain_manual_facts TO service_role;

CREATE TABLE IF NOT EXISTS public.brain_operator_login_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brain_operator_login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brain_operator_login_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_brain_late_turns(
  p_worker_token text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 90
) RETURNS SETOF public.brain_turns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_worker_token IS NULL OR btrim(p_worker_token) = '' THEN
    RAISE EXCEPTION 'worker token is required';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.brain_turns
    WHERE status = 'brain_late'
      AND (recovery_lease_expires_at IS NULL OR recovery_lease_expires_at <= now())
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.brain_turns AS turn
  SET recovery_lease_token = p_worker_token,
      recovery_lease_expires_at = now() + make_interval(secs => GREATEST(15, LEAST(COALESCE(p_lease_seconds, 90), 300))),
      updated_at = now()
  FROM candidates
  WHERE turn.id = candidates.id
  RETURNING turn.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_brain_late_turn(
  p_turn_id text,
  p_worker_token text,
  p_status text DEFAULT 'brain_late'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_status NOT IN ('brain_late', 'failed_technical', 'completed') THEN
    RAISE EXCEPTION 'invalid late-turn recovery status';
  END IF;
  UPDATE public.brain_turns
  SET status = p_status,
      recovery_lease_token = NULL,
      recovery_lease_expires_at = NULL,
      completed_at = CASE WHEN p_status IN ('completed', 'failed_technical') THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_turn_id
    AND status = 'brain_late'
    AND recovery_lease_token = p_worker_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('released', v_updated = 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_brain_operator_login_attempt(
  p_key_hash text,
  p_now timestamptz DEFAULT now(),
  p_window_seconds integer DEFAULT 900,
  p_max_attempts integer DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.brain_operator_login_limits%ROWTYPE;
  v_reset boolean;
BEGIN
  IF p_key_hash IS NULL OR length(p_key_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid login rate-limit key';
  END IF;
  INSERT INTO public.brain_operator_login_limits (key_hash, window_started_at, attempt_count, updated_at)
  VALUES (p_key_hash, p_now, 1, p_now)
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN public.brain_operator_login_limits.window_started_at <= p_now - make_interval(secs => GREATEST(60, p_window_seconds))
        THEN p_now ELSE public.brain_operator_login_limits.window_started_at END,
    attempt_count = CASE
      WHEN public.brain_operator_login_limits.window_started_at <= p_now - make_interval(secs => GREATEST(60, p_window_seconds))
        THEN 1 ELSE LEAST(public.brain_operator_login_limits.attempt_count + 1, GREATEST(1, p_max_attempts) + 1) END,
    blocked_until = CASE
      WHEN public.brain_operator_login_limits.window_started_at <= p_now - make_interval(secs => GREATEST(60, p_window_seconds))
        THEN NULL ELSE public.brain_operator_login_limits.blocked_until END,
    updated_at = p_now
  RETURNING * INTO v_row;
  v_reset := v_row.window_started_at = p_now AND v_row.attempt_count = 1;
  RETURN jsonb_build_object(
    'allowed', v_row.blocked_until IS NULL AND v_row.attempt_count <= GREATEST(1, p_max_attempts),
    'attempt_count', v_row.attempt_count,
    'retry_after_seconds', CASE
      WHEN v_row.blocked_until IS NOT NULL THEN GREATEST(1, ceil(extract(epoch FROM (v_row.blocked_until - p_now)))::integer)
      WHEN v_row.attempt_count > GREATEST(1, p_max_attempts) THEN GREATEST(1, ceil(extract(epoch FROM (v_row.window_started_at + make_interval(secs => GREATEST(60, p_window_seconds)) - p_now)))::integer)
      ELSE 0 END,
    'reset', v_reset
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_brain_operator_login_attempts(p_key_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.brain_operator_login_limits WHERE key_hash = p_key_hash;
$$;

REVOKE ALL ON FUNCTION public.claim_brain_late_turns(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_brain_late_turns(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.release_brain_late_turn(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_brain_late_turn(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.consume_brain_operator_login_attempt(text, timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_brain_operator_login_attempt(text, timestamptz, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.clear_brain_operator_login_attempts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_brain_operator_login_attempts(text) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_brain_manual_resolution(
  p_conversation_id text,
  p_turn_id text,
  p_answer text,
  p_save_for_future boolean DEFAULT false,
  p_memory_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn public.brain_turns%ROWTYPE;
  v_session public.brain_sessions%ROWTYPE;
  v_rules jsonb;
  v_orchestration jsonb;
  v_ledger jsonb;
  v_message_id text;
  v_question text;
  v_context text;
  v_fact_id text;
BEGIN
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN
    RAISE EXCEPTION 'manual resolution answer is required';
  END IF;
  SELECT * INTO v_turn FROM public.brain_turns
  WHERE id = p_turn_id AND conversation_id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND OR v_turn.status <> 'waiting_manual' THEN
    RAISE EXCEPTION 'manual resolution is not waiting for this conversation';
  END IF;
  SELECT * INTO v_session FROM public.brain_sessions WHERE id = v_turn.session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'brain session not found'; END IF;
  SELECT payload->'manualResolution'->>'question', payload->'manualResolution'->>'context'
    INTO v_question, v_context
  FROM public.brain_decisions WHERE turn_id = p_turn_id AND decision_type = 'manual_resolution'
  ORDER BY version DESC, created_at DESC LIMIT 1;
  IF COALESCE(v_question, '') = '' THEN RAISE EXCEPTION 'manual question not found'; END IF;
  IF p_save_for_future AND COALESCE(p_memory_key, '') = '' THEN
    RAISE EXCEPTION 'memory key required when saving manual resolution';
  END IF;

  v_fact_id := 'manual_fact_' || md5(p_turn_id || ':' || clock_timestamp()::text || ':' || random()::text);
  INSERT INTO public.brain_manual_facts (
    id, conversation_id, session_id, turn_id, memory_key, question, fact, permanent
  ) VALUES (
    v_fact_id, p_conversation_id, v_session.id, p_turn_id, p_memory_key,
    v_question, btrim(p_answer), p_save_for_future
  );

  IF p_save_for_future THEN
    INSERT INTO public.persona_memory (persona_id, category, key, value, source_type, confidence, aliases)
    VALUES ('larissa', 'manual_resolution', p_memory_key,
      jsonb_build_object('fact', btrim(p_answer), 'question', v_question), 'generated', 1.0,
      ARRAY[v_question]::text[])
    ON CONFLICT (persona_id, key) DO UPDATE SET
      value = EXCLUDED.value, category = EXCLUDED.category, aliases = EXCLUDED.aliases,
      source_type = EXCLUDED.source_type, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  SELECT stage_completed_rules INTO v_rules FROM public.instagram_conversations
  WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found'; END IF;
  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orchestration := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_ledger := COALESCE(v_orchestration->'messageLedger', '{}'::jsonb);
  FOREACH v_message_id IN ARRAY v_turn.inbound_message_ids LOOP
    v_ledger := jsonb_set(v_ledger, ARRAY[v_message_id], '"pending"'::jsonb, true);
  END LOOP;
  v_orchestration := jsonb_set(v_orchestration, '{messageLedger}', v_ledger, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orchestration, true);
  v_rules := v_rules - 'cancel_current_cycle' - 'pause_reason';
  IF v_rules->>'status' = 'paused_manual' THEN v_rules := v_rules - 'status'; END IF;
  UPDATE public.instagram_conversations
  SET stage_completed_rules = v_rules, ai_auto_respond = true, ai_debounce_until = NULL
  WHERE id = p_conversation_id;
  UPDATE public.brain_turns SET status = 'brain_running', completed_at = NULL, updated_at = now()
  WHERE id = p_turn_id;
  INSERT INTO public.brain_turn_events (
    conversation_id, session_id, turn_id, event_type, status, human_message, metadata
  ) VALUES (
    p_conversation_id, v_session.id, p_turn_id, 'manual_resolution_received', 'brain_running',
    'Operador respondeu à solicitação do Brain; o fato foi persistido no escopo da sessão.',
    jsonb_build_object('manualFactId', v_fact_id, 'saved_for_future_sessions', p_save_for_future)
  );
  RETURN jsonb_build_object(
    'success', true, 'session_id', v_session.provider_session_id,
    'session_row_id', v_session.id, 'manual_fact_id', v_fact_id,
    'question', v_question, 'context', COALESCE(v_context, ''),
    'inbound_message_ids', to_jsonb(v_turn.inbound_message_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_brain_manual_resolution(text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_brain_manual_resolution(text, text, text, boolean, text) TO service_role;
