-- Separa a intenção persistente de habilitação do estado operacional e atualiza
-- a projeção visual por conversa, sem ler/gravar o objeto global no cliente.

CREATE OR REPLACE FUNCTION public.set_autopilot_runtime_state_atomic(
  p_conversation_id text,
  p_status text,
  p_reason text DEFAULT NULL,
  p_cancel_current_cycle boolean DEFAULT false,
  p_clear_cancel_current_cycle boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_enabled boolean;
BEGIN
  IF p_status NOT IN ('idle', 'processing', 'waiting_delay', 'waiting_human', 'paused_guardrail', 'paused_handoff', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_runtime_status');
  END IF;

  SELECT stage_completed_rules, COALESCE(ai_auto_respond, false)
    INTO v_rules, v_enabled
    FROM public.instagram_conversations
   WHERE id = p_conversation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN v_rules := '{}'::jsonb; END IF;
  v_rules := jsonb_set(v_rules, '{status}', to_jsonb(p_status), true);
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    v_rules := v_rules - 'pause_reason';
  ELSE
    v_rules := jsonb_set(v_rules, '{pause_reason}', to_jsonb(p_reason), true);
  END IF;
  IF p_cancel_current_cycle THEN
    v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'true'::jsonb, true);
  ELSIF p_clear_cancel_current_cycle THEN
    v_rules := v_rules - 'cancel_current_cycle';
  END IF;

  UPDATE public.instagram_conversations
     SET stage_completed_rules = v_rules,
         ai_debounce_until = CASE WHEN p_cancel_current_cycle THEN NULL ELSE ai_debounce_until END
   WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'isEnabled', v_enabled, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.set_autopilot_runtime_state_atomic(text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_autopilot_runtime_state_atomic(text, text, text, boolean, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.disable_autopilot_explicitly_atomic(
  p_conversation_id text,
  p_reason text DEFAULT 'operator_toggle_off'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_old_enabled boolean;
  v_updated_at timestamptz;
BEGIN
  SELECT stage_completed_rules, COALESCE(ai_auto_respond, false)
    INTO v_rules, v_old_enabled
    FROM public.instagram_conversations
   WHERE id = p_conversation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := CASE WHEN jsonb_typeof(v_rules) = 'object' THEN v_rules ELSE '{}'::jsonb END;
  v_rules := jsonb_set(v_rules, '{status}', '"disabled"'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'true'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{pause_reason}', to_jsonb(COALESCE(NULLIF(btrim(p_reason), ''), 'operator_toggle_off')), true);
  UPDATE public.instagram_conversations
     SET ai_auto_respond = false,
         ai_debounce_until = NULL,
         stage_completed_rules = v_rules,
         updated_at = clock_timestamp()
   WHERE id = p_conversation_id
   RETURNING updated_at INTO v_updated_at;

  RETURN jsonb_build_object('success', true, 'oldValue', v_old_enabled, 'newValue', false,
    'isEnabled', false, 'status', 'disabled', 'updatedAt', v_updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.disable_autopilot_explicitly_atomic(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_autopilot_explicitly_atomic(text, text) TO service_role;

-- Removidas após migrar os chamadores: o contrato ambíguo permitia que pausa
-- temporária fosse interpretada como desligamento permanente.
DROP FUNCTION IF EXISTS public.patch_autopilot_pause_atomic(text, boolean);
DROP FUNCTION IF EXISTS public.patch_autopilot_pause_atomic(text, boolean, text);

CREATE OR REPLACE FUNCTION public.arm_autopilot_with_watermark_atomic(
  p_conversation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_current_rev int;
  v_watermark jsonb;
  v_old_enabled boolean;
  v_updated_at timestamptz;
BEGIN
  SELECT stage_completed_rules, COALESCE(ai_auto_respond, false)
    INTO v_rules, v_old_enabled
    FROM public.instagram_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := CASE WHEN jsonb_typeof(v_rules) = 'object' THEN v_rules ELSE '{}'::jsonb END;
  v_orch := CASE WHEN jsonb_typeof(v_rules->'orchestration') = 'object' THEN v_rules->'orchestration' ELSE '{}'::jsonb END;
  v_current_rev := COALESCE((v_orch->>'inboundRevision')::int, 0);
  v_watermark := jsonb_build_object('inboundRevision', v_current_rev);
  v_orch := jsonb_set(v_orch, '{activation_watermark}', v_watermark, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
  v_rules := v_rules - 'cancel_current_cycle' - 'pause_reason';
  IF v_rules->>'status' IN ('paused_manual', 'paused_handoff', 'paused_guardrail', 'waiting_human', 'disabled', 'cancelled') THEN
    v_rules := jsonb_set(v_rules, '{status}', '"active"'::jsonb, true);
  END IF;

  UPDATE public.instagram_conversations
     SET stage_completed_rules = v_rules,
         ai_auto_respond = true,
         ai_debounce_until = NULL,
         updated_at = clock_timestamp()
   WHERE id = p_conversation_id
   RETURNING updated_at INTO v_updated_at;

  RETURN jsonb_build_object('success', true, 'watermark', v_watermark,
    'inbound_revision', v_current_rev, 'oldValue', v_old_enabled,
    'newValue', true, 'isEnabled', true, 'updatedAt', v_updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.arm_autopilot_with_watermark_atomic(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arm_autopilot_with_watermark_atomic(text) TO service_role;

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
  v_enabled boolean;
BEGIN
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN RAISE EXCEPTION 'manual resolution answer is required'; END IF;
  SELECT * INTO v_turn FROM public.brain_turns
   WHERE id = p_turn_id AND conversation_id = p_conversation_id FOR UPDATE;
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
  IF p_save_for_future AND COALESCE(p_memory_key, '') = '' THEN RAISE EXCEPTION 'memory key required when saving manual resolution'; END IF;

  SELECT stage_completed_rules, COALESCE(ai_auto_respond, false)
    INTO v_rules, v_enabled FROM public.instagram_conversations
   WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found'; END IF;
  IF NOT v_enabled THEN RAISE EXCEPTION 'autopilot disabled by explicit operator action'; END IF;

  v_fact_id := 'manual_fact_' || md5(p_turn_id || ':' || clock_timestamp()::text || ':' || random()::text);
  INSERT INTO public.brain_manual_facts (id, conversation_id, session_id, turn_id, memory_key, question, fact, permanent)
  VALUES (v_fact_id, p_conversation_id, v_session.id, p_turn_id, p_memory_key, v_question, btrim(p_answer), p_save_for_future);

  IF p_save_for_future THEN
    INSERT INTO public.persona_memory (persona_id, category, key, value, source_type, confidence, aliases)
    VALUES ('larissa', 'manual_resolution', p_memory_key,
      jsonb_build_object('fact', btrim(p_answer), 'question', v_question), 'generated', 1.0,
      ARRAY[v_question]::text[])
    ON CONFLICT (persona_id, key) DO UPDATE SET
      value = EXCLUDED.value, category = EXCLUDED.category, aliases = EXCLUDED.aliases,
      source_type = EXCLUDED.source_type, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  v_rules := CASE WHEN jsonb_typeof(v_rules) = 'object' THEN v_rules ELSE '{}'::jsonb END;
  v_orchestration := CASE WHEN jsonb_typeof(v_rules->'orchestration') = 'object' THEN v_rules->'orchestration' ELSE '{}'::jsonb END;
  v_ledger := CASE WHEN jsonb_typeof(v_orchestration->'messageLedger') = 'object' THEN v_orchestration->'messageLedger' ELSE '{}'::jsonb END;
  FOREACH v_message_id IN ARRAY v_turn.inbound_message_ids LOOP
    v_ledger := jsonb_set(v_ledger, ARRAY[v_message_id], '"pending"'::jsonb, true);
  END LOOP;
  v_orchestration := jsonb_set(v_orchestration, '{messageLedger}', v_ledger, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orchestration, true);
  v_rules := v_rules - 'cancel_current_cycle' - 'pause_reason';
  IF v_rules->>'status' IN ('paused_manual', 'waiting_human') THEN v_rules := v_rules - 'status'; END IF;
  UPDATE public.instagram_conversations
     SET stage_completed_rules = v_rules, ai_debounce_until = NULL
   WHERE id = p_conversation_id;
  UPDATE public.brain_turns SET status = 'brain_running', completed_at = NULL, updated_at = now() WHERE id = p_turn_id;
  INSERT INTO public.brain_turn_events (conversation_id, session_id, turn_id, event_type, status, human_message, metadata)
  VALUES (p_conversation_id, v_session.id, p_turn_id, 'manual_resolution_received', 'brain_running',
    'Operador respondeu à solicitação do Brain; o fato foi persistido no escopo da sessão.',
    jsonb_build_object('manualFactId', v_fact_id, 'saved_for_future_sessions', p_save_for_future));
  RETURN jsonb_build_object('success', true, 'isEnabled', v_enabled, 'session_id', v_session.provider_session_id,
    'session_row_id', v_session.id, 'manual_fact_id', v_fact_id, 'question', v_question,
    'context', COALESCE(v_context, ''), 'inbound_message_ids', to_jsonb(v_turn.inbound_message_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_brain_manual_resolution(text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_brain_manual_resolution(text, text, text, boolean, text) TO service_role;

-- This RPC edits only one projection key. The persisted conversation flag is
-- always read under lock and overwrites any stale/client-supplied isEnabled.
CREATE OR REPLACE FUNCTION public.patch_autopilot_projection_state_atomic(
  p_conversation_id text,
  p_state_patch jsonb,
  p_expected_state_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_state_row jsonb;
  v_root jsonb;
  v_states jsonb;
  v_current jsonb;
  v_next jsonb;
  v_current_at timestamptz;
  v_patch_at timestamptz;
BEGIN
  IF p_conversation_id IS NULL OR p_conversation_id IN ('__autopilot_states__', '__autopilot_config__')
     OR p_state_patch IS NULL OR jsonb_typeof(p_state_patch) <> 'object'
     OR octet_length(p_state_patch::text) > 24000 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_projection_patch');
  END IF;

  SELECT COALESCE(ai_auto_respond, false) INTO v_enabled
    FROM public.instagram_conversations
   WHERE id = p_conversation_id
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  SELECT stage_completed_rules INTO v_root
    FROM public.instagram_conversations
   WHERE id = '__autopilot_states__'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'projection_row_not_found');
  END IF;

  IF v_root IS NULL OR jsonb_typeof(v_root) <> 'object' THEN v_root := '{}'::jsonb; END IF;
  v_states := CASE WHEN jsonb_typeof(v_root->'states') = 'object' THEN v_root->'states' ELSE '{}'::jsonb END;
  v_current := COALESCE(v_states->p_conversation_id, jsonb_build_object('conversationId', p_conversation_id));
  BEGIN
    v_current_at := NULLIF(v_current->>'stateUpdatedAt', '')::timestamptz;
    v_patch_at := NULLIF(p_state_patch->>'stateUpdatedAt', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_state_version');
  END;

  IF v_current_at IS NOT NULL AND v_patch_at IS NOT NULL AND v_patch_at < v_current_at THEN
    RETURN jsonb_build_object('success', true, 'applied', false, 'isEnabled', v_enabled, 'stateUpdatedAt', v_current->>'stateUpdatedAt');
  END IF;
  IF p_expected_state_updated_at IS NOT NULL AND v_current_at IS DISTINCT FROM p_expected_state_updated_at THEN
    RETURN jsonb_build_object('success', true, 'applied', false, 'isEnabled', v_enabled, 'stateUpdatedAt', v_current->>'stateUpdatedAt');
  END IF;

  v_next := v_current || (p_state_patch - 'isEnabled' - 'conversationId');
  v_next := jsonb_set(v_next, '{conversationId}', to_jsonb(p_conversation_id), true);
  v_next := jsonb_set(v_next, '{isEnabled}', to_jsonb(v_enabled), true);
  v_next := jsonb_set(v_next, '{stateUpdatedAt}', to_jsonb(clock_timestamp()), true);
  IF NOT v_enabled THEN
    v_next := jsonb_set(v_next, '{status}', '"disabled"'::jsonb, true);
  ELSIF v_next->>'status' = 'disabled' THEN
    v_next := jsonb_set(v_next, '{status}', '"idle"'::jsonb, true);
  END IF;

  v_states := jsonb_set(v_states, ARRAY[p_conversation_id], v_next, true);
  v_root := jsonb_set(v_root, '{states}', v_states, true);
  v_root := jsonb_set(v_root, '{updated_at}', to_jsonb(clock_timestamp()), true);
  UPDATE public.instagram_conversations
     SET stage_completed_rules = v_root,
         updated_at = clock_timestamp()
   WHERE id = '__autopilot_states__';

  RETURN jsonb_build_object('success', true, 'applied', true, 'isEnabled', v_enabled,
    'stateUpdatedAt', v_next->>'stateUpdatedAt');
END;
$$;

REVOKE ALL ON FUNCTION public.patch_autopilot_projection_state_atomic(text, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patch_autopilot_projection_state_atomic(text, jsonb, timestamptz) TO anon, authenticated, service_role;
