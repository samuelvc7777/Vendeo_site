-- Persistência canônica do ciclo Brain. O JSON legado continua sendo lido para
-- compatibilidade durante a migração; novas decisões são gravadas nestas tabelas.

-- Fonte única da etapa atual. A coluna normalizada prevalece; os campos JSON
-- permanecem como projeções para clientes e workers legados.
COMMENT ON COLUMN public.instagram_conversations.current_stage_id IS
  'Fonte canônica da etapa atual da conversa. Valores em stage_completed_rules são projeções legadas.';

UPDATE public.instagram_conversations AS conversation
SET current_stage_id = COALESCE(
  conversation.stage_completed_rules->'orchestration'->>'currentStageId',
  conversation.stage_completed_rules->'chat_progress'->>'currentStageId',
  conversation.stage_completed_rules->>'current_stage_id'
)
WHERE conversation.current_stage_id IS NULL
  AND COALESCE(
    conversation.stage_completed_rules->'orchestration'->>'currentStageId',
    conversation.stage_completed_rules->'chat_progress'->>'currentStageId',
    conversation.stage_completed_rules->>'current_stage_id'
  ) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.chat_stages AS stage
    WHERE stage.id = COALESCE(
      conversation.stage_completed_rules->'orchestration'->>'currentStageId',
      conversation.stage_completed_rules->'chat_progress'->>'currentStageId',
      conversation.stage_completed_rules->>'current_stage_id'
    )
  );

ALTER TABLE public.persona_audios
  ADD COLUMN IF NOT EXISTS objective_id text NULL;

CREATE INDEX IF NOT EXISTS idx_persona_audios_objective_enabled
  ON public.persona_audios (objective_id, enabled, title);

CREATE TABLE IF NOT EXISTS public.brain_sessions (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'openai',
  provider_session_id text NOT NULL,
  context_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'closed', 'failed')),
  bootstrap_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_session_id)
);

CREATE INDEX IF NOT EXISTS idx_brain_sessions_conversation_active
  ON public.brain_sessions (conversation_id, updated_at DESC)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.brain_turns (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.brain_sessions(id) ON DELETE CASCADE,
  provider_turn_id text,
  status text NOT NULL DEFAULT 'collecting' CHECK (status IN (
    'collecting', 'brain_running', 'waiting_manual', 'brain_late',
    'decision_persisted', 'executing', 'completed', 'failed_technical'
  )),
  inbound_message_ids text[] NOT NULL DEFAULT '{}'::text[],
  version integer NOT NULL DEFAULT 1,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_turns_conversation_updated
  ON public.brain_turns (conversation_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_turns_provider_turn
  ON public.brain_turns (session_id, provider_turn_id)
  WHERE provider_turn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.brain_decisions (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.brain_sessions(id) ON DELETE CASCADE,
  turn_id text NOT NULL REFERENCES public.brain_turns(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  decision_type text NOT NULL CHECK (decision_type IN (
    'respond', 'wait', 'manual_resolution', 'request_audio_candidates', 'revise_pending'
  )),
  objective_updates jsonb NOT NULL DEFAULT '[]'::jsonb,
  stage_transition jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (turn_id, version)
);

CREATE TABLE IF NOT EXISTS public.brain_decision_actions (
  id text PRIMARY KEY,
  decision_id text NOT NULL REFERENCES public.brain_decisions(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  action_index integer NOT NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'waiting_delay', 'sending', 'sent', 'cancelled',
    'failed_retryable', 'failed_confirmed', 'dispatch_uncertain'
  )),
  not_before timestamptz,
  delivery_mode text CHECK (delivery_mode IS NULL OR delivery_mode IN ('provider', 'manual')),
  idempotency_key text NOT NULL UNIQUE,
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, action_index)
);

CREATE INDEX IF NOT EXISTS idx_brain_actions_dispatch
  ON public.brain_decision_actions (conversation_id, status, not_before, action_index);

CREATE TABLE IF NOT EXISTS public.brain_turn_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  session_id text REFERENCES public.brain_sessions(id) ON DELETE SET NULL,
  turn_id text REFERENCES public.brain_turns(id) ON DELETE SET NULL,
  decision_id text REFERENCES public.brain_decisions(id) ON DELETE SET NULL,
  action_id text REFERENCES public.brain_decision_actions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  human_message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_turn_events_conversation_created
  ON public.brain_turn_events (conversation_id, created_at DESC, id DESC);

ALTER TABLE public.brain_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_decision_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_turn_events ENABLE ROW LEVEL SECURITY;

-- Dados de eventos podem conter conteúdo de conversas e não têm uma relação
-- de propriedade de usuário nesta tabela. A leitura passa pelo endpoint do
-- backend; não exponha todas as conversas para qualquer usuário autenticado.
DROP POLICY IF EXISTS brain_turn_events_authenticated_read ON public.brain_turn_events;

REVOKE ALL ON public.brain_sessions, public.brain_turns, public.brain_decisions,
  public.brain_decision_actions FROM anon, authenticated;
REVOKE ALL ON public.brain_turn_events FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.brain_sessions, public.brain_turns, public.brain_decisions,
  public.brain_decision_actions TO service_role;
GRANT SELECT, INSERT ON public.brain_turn_events TO service_role;

DO $$
DECLARE
  v_event_sequence regclass := pg_get_serial_sequence('public.brain_turn_events', 'id')::regclass;
BEGIN
  IF v_event_sequence IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_event_sequence);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_brain_decision(
  p_session jsonb,
  p_turn jsonb,
  p_decision jsonb,
  p_actions jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_action jsonb;
  v_cancel_id text;
  v_previous_decision_id text;
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_item record;
  v_cancel_found boolean;
BEGIN
  IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_actions must be an array';
  END IF;
  IF p_session->>'id' IS NULL OR p_turn->>'id' IS NULL OR p_decision->>'id' IS NULL THEN
    RAISE EXCEPTION 'session, turn and decision ids are required';
  END IF;
  IF p_session->>'conversation_id' IS DISTINCT FROM p_turn->>'conversation_id'
     OR p_session->>'conversation_id' IS DISTINCT FROM p_decision->>'conversation_id'
     OR p_turn->>'session_id' IS DISTINCT FROM p_session->>'id'
     OR p_decision->>'session_id' IS DISTINCT FROM p_session->>'id'
     OR p_decision->>'turn_id' IS DISTINCT FROM p_turn->>'id' THEN
    RAISE EXCEPTION 'brain decision ownership references do not match';
  END IF;

  IF jsonb_typeof(COALESCE(p_decision->'payload'->'pendingActionResolution'->'cancelActionIds', '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'pendingActionResolution.cancelActionIds must be an array';
  END IF;
  IF jsonb_array_length(COALESCE(p_decision->'payload'->'pendingActionResolution'->'cancelActionIds', '[]'::jsonb)) > 0 THEN
    SELECT stage_completed_rules INTO v_rules
    FROM public.instagram_conversations
    WHERE id = p_decision->>'conversation_id'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found while revising pending actions'; END IF;
    v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
    v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);
    FOR v_cancel_id IN
      SELECT jsonb_array_elements_text(p_decision->'payload'->'pendingActionResolution'->'cancelActionIds')
    LOOP
      UPDATE public.brain_decision_actions
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_cancel_id
        AND conversation_id = p_decision->>'conversation_id'
        AND status IN ('pending', 'waiting_delay')
      RETURNING decision_id INTO v_previous_decision_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'pending action % is no longer safely cancellable', v_cancel_id; END IF;
      v_cancel_found := false;
      FOR v_item IN SELECT key, value FROM jsonb_each(v_outbox) LOOP
        IF v_item.value->'payload'->>'brainActionId' = v_cancel_id THEN
          IF v_item.value->>'status' NOT IN ('pending', 'waiting_delay') THEN
            RAISE EXCEPTION 'outbox action % is no longer pending', v_cancel_id;
          END IF;
          v_outbox := jsonb_set(v_outbox, ARRAY[v_item.key], v_item.value || jsonb_build_object('status', 'cancelled'), true);
          v_cancel_found := true;
          EXIT;
        END IF;
      END LOOP;
      IF NOT v_cancel_found THEN RAISE EXCEPTION 'outbox action % not found', v_cancel_id; END IF;
      INSERT INTO public.brain_turn_events (
        conversation_id, decision_id, action_id, event_type, status, human_message, metadata
      ) VALUES (
        p_decision->>'conversation_id', v_previous_decision_id, v_cancel_id,
        'action_cancelled', 'cancelled', 'Brain cancelou uma ação ainda não enviada após revisar novas mensagens.',
        jsonb_build_object('revisedByDecisionId', p_decision->>'id')
      );
    END LOOP;
    UPDATE public.brain_turns AS old_turn
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE old_turn.id IN (
      SELECT DISTINCT old_decision.turn_id
      FROM public.brain_decisions AS old_decision
      JOIN public.brain_decision_actions AS old_action ON old_action.decision_id = old_decision.id
      WHERE old_action.id IN (
        SELECT jsonb_array_elements_text(p_decision->'payload'->'pendingActionResolution'->'cancelActionIds')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.brain_decision_actions AS remaining_action
      WHERE remaining_action.decision_id IN (
        SELECT old_decision.id FROM public.brain_decisions AS old_decision WHERE old_decision.turn_id = old_turn.id
      )
      AND remaining_action.status NOT IN ('sent', 'cancelled')
    );
    v_orch := jsonb_set(v_orch, '{outbox}', v_outbox, true);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
    UPDATE public.instagram_conversations SET stage_completed_rules = v_rules
    WHERE id = p_decision->>'conversation_id';
  END IF;

  INSERT INTO public.brain_sessions (
    id, conversation_id, provider, provider_session_id, context_version,
    status, bootstrap_context, updated_at
  ) VALUES (
    p_session->>'id', p_session->>'conversation_id',
    COALESCE(p_session->>'provider', 'openai'),
    p_session->>'provider_session_id',
    COALESCE(NULLIF(p_session->>'context_version', '')::integer, 1),
    COALESCE(p_session->>'status', 'active'),
    COALESCE(p_session->'bootstrap_context', '{}'::jsonb), now()
  ) ON CONFLICT (id) DO UPDATE SET
    provider_session_id = EXCLUDED.provider_session_id,
    status = EXCLUDED.status,
    updated_at = now();

  INSERT INTO public.brain_turns (
    id, conversation_id, session_id, provider_turn_id, status,
    inbound_message_ids, version, lease_expires_at, updated_at
  ) VALUES (
    p_turn->>'id', p_turn->>'conversation_id', p_turn->>'session_id',
    p_turn->>'provider_turn_id', COALESCE(p_turn->>'status', 'decision_persisted'),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_turn->'inbound_message_ids', '[]'::jsonb))),
    COALESCE(NULLIF(p_turn->>'version', '')::integer, 1),
    NULLIF(p_turn->>'lease_expires_at', '')::timestamptz, now()
  ) ON CONFLICT (id) DO UPDATE SET
    provider_turn_id = COALESCE(EXCLUDED.provider_turn_id, public.brain_turns.provider_turn_id),
    status = EXCLUDED.status,
    inbound_message_ids = EXCLUDED.inbound_message_ids,
    version = EXCLUDED.version,
    lease_expires_at = EXCLUDED.lease_expires_at,
    updated_at = now();

  INSERT INTO public.brain_decisions (
    id, conversation_id, session_id, turn_id, version, decision_type,
    objective_updates, stage_transition, payload
  ) VALUES (
    p_decision->>'id', p_decision->>'conversation_id', p_decision->>'session_id',
    p_decision->>'turn_id', COALESCE(NULLIF(p_decision->>'version', '')::integer, 1),
    p_decision->>'decision_type',
    COALESCE(p_decision->'objective_updates', '[]'::jsonb),
    p_decision->'stage_transition', COALESCE(p_decision->'payload', '{}'::jsonb)
  ) ON CONFLICT (id) DO NOTHING;

  FOR v_action IN SELECT value FROM jsonb_array_elements(p_actions)
  LOOP
    INSERT INTO public.brain_decision_actions (
      id, decision_id, conversation_id, action_index, action_type, payload,
      status, not_before, idempotency_key
    ) VALUES (
      v_action->>'id', p_decision->>'id', p_decision->>'conversation_id',
      (v_action->>'action_index')::integer, v_action->>'action_type',
      COALESCE(v_action->'payload', '{}'::jsonb),
      COALESCE(v_action->>'status', 'pending'),
      NULLIF(v_action->>'not_before', '')::timestamptz,
      v_action->>'idempotency_key'
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  INSERT INTO public.brain_turn_events (
    conversation_id, session_id, turn_id, decision_id, event_type,
    status, human_message, metadata
  ) VALUES (
    p_decision->>'conversation_id', p_decision->>'session_id',
    p_decision->>'turn_id', p_decision->>'id',
    CASE WHEN p_decision->>'decision_type' = 'manual_resolution' THEN 'manual_resolution_required' ELSE 'decision_persisted' END,
    CASE WHEN p_decision->>'decision_type' = 'manual_resolution' THEN 'waiting_manual' ELSE 'decision_persisted' END,
    CASE
      WHEN p_decision->>'decision_type' = 'manual_resolution'
        THEN 'Brain precisa saber: ' || COALESCE(p_decision->'payload'->'manualResolution'->>'question', 'informação adicional')
      ELSE 'Decisão do Brain persistida antes do envio.'
    END,
    jsonb_build_object('version', COALESCE(NULLIF(p_decision->>'version', '')::integer, 1),
      'action_count', jsonb_array_length(p_actions))
  );

  RETURN jsonb_build_object('success', true, 'decision_id', p_decision->>'id');
END;
$$;

REVOKE ALL ON FUNCTION public.persist_brain_decision(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_brain_decision(jsonb, jsonb, jsonb, jsonb) TO service_role;

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
BEGIN
  PERFORM public.persist_brain_decision(p_session, p_turn, p_decision, p_actions);
  IF jsonb_typeof(p_outbox_entries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_outbox_entries must be an array';
  END IF;
  IF jsonb_array_length(p_outbox_entries) > 0 THEN
    SELECT public.persist_durable_outbox_batch(
      p_decision->>'conversation_id',
      p_turn->>'id',
      p_outbox_entries
    ) INTO v_outbox_result;
    IF COALESCE((v_outbox_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'durable outbox persistence failed: %', COALESCE(v_outbox_result->>'reason', 'unknown');
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'decision_id', p_decision->>'id',
    'outbox_count', jsonb_array_length(p_outbox_entries)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_brain_decision_with_outbox(jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_brain_decision_with_outbox(jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;

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
  -- A resposta manual retoma o atendimento como uma única operação: reabre o lote,
  -- remove a pausa que aguardava o operador e volta a habilitar novos inbound.
  v_rules := v_rules - 'cancel_current_cycle' - 'pause_reason';
  IF v_rules->>'status' = 'paused_manual' THEN
    v_rules := v_rules - 'status';
  END IF;
  UPDATE public.instagram_conversations
  SET stage_completed_rules = v_rules,
      ai_auto_respond = true,
      ai_debounce_until = NULL
  WHERE id = p_conversation_id;

  UPDATE public.brain_turns SET status = 'brain_running', completed_at = NULL, updated_at = now()
  WHERE id = p_turn_id;

  IF p_save_for_future THEN
    IF COALESCE(p_memory_key, '') = '' THEN RAISE EXCEPTION 'memory key required when saving manual resolution'; END IF;
    INSERT INTO public.persona_memory (persona_id, category, key, value, source_type, confidence, aliases)
    VALUES ('larissa', 'manual_resolution', p_memory_key,
      jsonb_build_object('fact', btrim(p_answer), 'question', v_question), 'generated', 1.0,
      ARRAY[v_question]::text[])
    ON CONFLICT (persona_id, key) DO UPDATE SET
      value = EXCLUDED.value, category = EXCLUDED.category, aliases = EXCLUDED.aliases,
      source_type = EXCLUDED.source_type, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  INSERT INTO public.brain_turn_events (
    conversation_id, session_id, turn_id, event_type, status, human_message, metadata
  ) VALUES (
    p_conversation_id, v_turn.session_id, p_turn_id, 'manual_resolution_received', 'brain_running',
    'Operador respondeu à solicitação do Brain; o turno foi retomado.',
    jsonb_build_object('saved_for_future_sessions', p_save_for_future)
  );

  RETURN jsonb_build_object(
    'success', true, 'session_id', v_session.provider_session_id,
    'question', v_question, 'context', COALESCE(v_context, ''),
    'inbound_message_ids', to_jsonb(v_turn.inbound_message_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_brain_manual_resolution(text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_brain_manual_resolution(text, text, text, boolean, text) TO service_role;

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
BEGIN
  SELECT stage_completed_rules INTO v_rules
  FROM public.instagram_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found'); END IF;
  SELECT * INTO v_action
  FROM public.brain_decision_actions
  WHERE id = p_action_id AND conversation_id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_action.status, '') <> 'failed_confirmed' THEN
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
  IF v_entry IS NULL THEN RETURN jsonb_build_object('success', false, 'reason', 'outbox_action_not_found'); END IF;
  IF v_entry->>'status' IN ('sent', 'sending', 'dispatch_uncertain') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'action_not_safely_retryable');
  END IF;
  IF v_entry->>'status' <> 'failed' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'outbox_not_confirmed_failed');
  END IF;

  v_entry := v_entry || jsonb_build_object(
    'status', 'pending', 'notBefore', now(), 'deliveryMode', 'manual',
    'isUncertain', false, 'lastError', NULL
  );
  v_outbox := jsonb_set(v_outbox, ARRAY[v_key], v_entry, true);
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
  UPDATE public.instagram_conversations SET stage_completed_rules = v_rules WHERE id = p_conversation_id;
  UPDATE public.brain_decision_actions SET status = 'pending', delivery_mode = 'manual', updated_at = now()
  WHERE id = p_action_id;
  INSERT INTO public.brain_turn_events (
    conversation_id, turn_id, decision_id, action_id, event_type, status, human_message, metadata
  )
  SELECT p_conversation_id, turn_id, decision_id, p_action_id, 'manual_delivery_authorized', 'pending',
    'Operador autorizou o envio da ação após falha confirmada.', jsonb_build_object('deliveryMode', 'manual')
  FROM public.brain_decisions WHERE id = v_action.decision_id;
  RETURN jsonb_build_object('success', true, 'entry', v_entry, 'outbox_key', v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_brain_action_manual_retry(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_brain_action_manual_retry(text, text) TO service_role;

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
BEGIN
  SELECT stage_completed_rules INTO v_rules
  FROM public.instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found'); END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_active_cycle := v_rules->>'active_cycle_token';
  IF v_active_cycle IS NOT NULL AND p_cycle_id IS DISTINCT FROM v_active_cycle THEN
    RETURN jsonb_build_object('success', false, 'reason', 'brain_review_in_progress');
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_each(COALESCE(v_orch->'messageLedger', '{}'::jsonb)) AS ledger(message_id, message_status)
    WHERE ledger.message_status = '"pending"'::jsonb
  ) INTO v_has_pending_inbound;
  IF v_has_pending_inbound THEN
    RETURN jsonb_build_object('success', false, 'reason', 'pending_inbound_requires_brain_review');
  END IF;

  RETURN public.claim_outbox_entry(p_conversation_id, p_outbox_id, p_claim_token);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_outbox_entry_brain_safe(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_entry_brain_safe(text, text, text, text) TO service_role;

-- A conclusão do ciclo mantém sincronizada a projeção JSON com a coluna
-- canônica current_stage_id dentro do mesmo CAS/lock de conversa.
CREATE OR REPLACE FUNCTION public.commit_experimental_cycle_if_owned(
  p_conversation_id text,
  p_cycle_token text,
  p_new_stage_completed_rules jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_active_token text;
  v_preempt_requested boolean;
  v_final_rules jsonb;
  v_next_stage_id text;
BEGIN
  SELECT stage_completed_rules, current_stage_id INTO v_rules, v_next_stage_id
  FROM public.instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('committed', false, 'reason', 'not_found'); END IF;

  v_active_token := v_rules->>'active_cycle_token';
  v_preempt_requested := COALESCE((v_rules->>'preempt_requested')::boolean, false);
  IF v_active_token IS NULL OR v_active_token <> p_cycle_token THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'lost_lock', 'activeToken', v_active_token);
  END IF;
  IF v_preempt_requested IS TRUE THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'preempted');
  END IF;

  v_final_rules := jsonb_set(p_new_stage_completed_rules, '{active_cycle_token}', 'null'::jsonb);
  v_final_rules := jsonb_set(v_final_rules, '{preempt_requested}', 'false'::jsonb);
  v_next_stage_id := COALESCE(v_final_rules->'orchestration'->>'currentStageId', v_next_stage_id);
  UPDATE public.instagram_conversations
  SET stage_completed_rules = v_final_rules,
      current_stage_id = v_next_stage_id
  WHERE id = p_conversation_id;
  RETURN jsonb_build_object('committed', true, 'reason', 'committed');
END;
$$;

REVOKE ALL ON FUNCTION public.commit_experimental_cycle_if_owned(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_experimental_cycle_if_owned(text, text, jsonb) TO service_role;
