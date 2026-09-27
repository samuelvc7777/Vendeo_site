-- Decisão semântica e entrega são projeções independentes. A decisão passa a
-- poder ser auditada como commitada mesmo enquanto suas ações seguem na outbox.
ALTER TABLE public.brain_decisions
  ADD COLUMN IF NOT EXISTS semantic_state_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_status text;

ALTER TABLE public.brain_decisions
  DROP CONSTRAINT IF EXISTS brain_decisions_delivery_status_check;
ALTER TABLE public.brain_decisions
  ADD CONSTRAINT brain_decisions_delivery_status_check
  CHECK (delivery_status IS NULL OR delivery_status IN (
    'delivery_pending', 'partially_sent', 'fully_sent',
    'dispatch_uncertain', 'delivery_failed', 'delivery_cancelled'
  ));

CREATE OR REPLACE FUNCTION public.persist_brain_decision_with_outbox(
  p_session jsonb,
  p_turn jsonb,
  p_decision jsonb,
  p_actions jsonb,
  p_outbox_entries jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_outbox_result jsonb;
  v_rules jsonb;
  v_orchestration jsonb;
  v_semantic_state jsonb;
  v_already_committed boolean := false;
  v_decision_id text := p_decision->>'id';
  v_conversation_id text := p_decision->>'conversation_id';
  v_committed_decision_id text;
  v_next_stage_id text;
  v_current_stage_id text;
BEGIN
  PERFORM public.persist_brain_decision(p_session, p_turn, p_decision, p_actions);
  IF jsonb_typeof(p_outbox_entries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_outbox_entries must be an array';
  END IF;
  IF jsonb_array_length(p_outbox_entries) > 0 THEN
    SELECT public.persist_durable_outbox_batch(
      v_conversation_id,
      p_turn->>'id',
      p_outbox_entries
    ) INTO v_outbox_result;
    IF COALESCE((v_outbox_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'durable outbox persistence failed: %', COALESCE(v_outbox_result->>'reason', 'unknown');
    END IF;
  END IF;

  v_semantic_state := p_decision->'payload'->'semanticState';
  IF jsonb_typeof(v_semantic_state) = 'object' THEN
    SELECT semantic_state_committed_at IS NOT NULL INTO v_already_committed
    FROM public.brain_decisions WHERE id = v_decision_id FOR UPDATE;
  END IF;
  IF jsonb_typeof(v_semantic_state) = 'object' AND NOT COALESCE(v_already_committed, false) THEN
    SELECT stage_completed_rules, current_stage_id INTO v_rules, v_current_stage_id
    FROM public.instagram_conversations WHERE id = v_conversation_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found for semantic commit'; END IF;
    v_rules := COALESCE(v_rules, '{}'::jsonb);
    IF (v_rules->>'active_cycle_token') IS DISTINCT FROM (v_semantic_state->>'cycleToken') THEN
      RAISE EXCEPTION 'semantic commit lost cycle ownership';
    END IF;
    IF v_semantic_state ? 'expectedCurrentStageId'
      AND v_current_stage_id IS DISTINCT FROM NULLIF(v_semantic_state->>'expectedCurrentStageId', '') THEN
      RAISE EXCEPTION 'semantic commit lost current stage CAS';
    END IF;

    v_orchestration := COALESCE(v_rules->'orchestration', '{}'::jsonb);
    v_orchestration := jsonb_set(v_orchestration, '{completedGoalIds}', COALESCE(v_semantic_state->'completedGoalIds', '[]'::jsonb), true);
    v_orchestration := jsonb_set(v_orchestration, '{objectiveProgress}', COALESCE(v_semantic_state->'objectiveProgress', '{}'::jsonb), true);
    v_orchestration := jsonb_set(v_orchestration, '{currentPhase}', COALESCE(v_semantic_state->'currentPhase', 'null'::jsonb), true);
    v_orchestration := jsonb_set(v_orchestration, '{currentStageId}', COALESCE(v_semantic_state->'currentStageId', 'null'::jsonb), true);
    v_orchestration := jsonb_set(v_orchestration, '{checkpoint}', COALESCE(v_semantic_state->'checkpoint', 'null'::jsonb), true);
    v_orchestration := jsonb_set(v_orchestration, '{lastDecision}', COALESCE(v_semantic_state->'lastDecision', 'null'::jsonb), true);
    v_orchestration := jsonb_set(v_orchestration, '{semanticDecisionId}', to_jsonb(v_decision_id), true);

    v_rules := jsonb_set(v_rules, '{completed_goals}', COALESCE(v_semantic_state->'completedGoalIds', '[]'::jsonb), true);
    v_rules := jsonb_set(v_rules, '{objective_progress}', COALESCE(v_semantic_state->'objectiveProgress', '{}'::jsonb), true);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orchestration, true);
    v_next_stage_id := NULLIF(v_semantic_state->>'currentStageId', '');
    UPDATE public.instagram_conversations
    SET stage_completed_rules = v_rules,
        current_stage_id = COALESCE(v_next_stage_id, current_stage_id)
    WHERE id = v_conversation_id;

    UPDATE public.brain_decisions
    SET semantic_state_committed_at = COALESCE(semantic_state_committed_at, now()),
        delivery_status = CASE WHEN jsonb_array_length(p_actions) > 0
          THEN COALESCE(delivery_status, 'delivery_pending') ELSE NULL END
    WHERE id = v_decision_id AND semantic_state_committed_at IS NULL
    RETURNING id INTO v_committed_decision_id;
    IF v_committed_decision_id IS NOT NULL THEN
      INSERT INTO public.brain_turn_events (
        conversation_id, session_id, turn_id, decision_id, event_type,
        status, human_message, metadata
      ) VALUES (
        v_conversation_id, p_decision->>'session_id', p_turn->>'id', v_decision_id,
        'semantic_state_committed', 'semantic_state_committed',
        'Estado semântico do Brain commitado independentemente da entrega.',
        jsonb_build_object('stageId', v_next_stage_id,
          'objectiveUpdates', COALESCE(v_semantic_state->'objectiveProgress', '{}'::jsonb))
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'decision_id', v_decision_id,
    'semantic_state_committed', jsonb_typeof(v_semantic_state) = 'object',
    'outbox_count', jsonb_array_length(p_outbox_entries)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_brain_decision_with_outbox(jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_brain_decision_with_outbox(jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
