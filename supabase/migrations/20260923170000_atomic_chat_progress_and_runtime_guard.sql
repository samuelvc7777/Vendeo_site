-- Migration: 20260923170000_atomic_chat_progress_and_runtime_guard.sql
-- Descrição: Elimina read-modify-write em stage_completed_rules, protege outbox/ledger/lock contra sobrescritas
--            acidentais do frontend/browser, adiciona RPCs atômicas de progresso e HUD control, e blinda claim_experimental_cycle.

-- 1. Normalização defensiva: assegura coluna id física virtual/armazenada para compatibilidade e corrige formato inválido
ALTER TABLE public.instagram_conversations ADD COLUMN IF NOT EXISTS id TEXT GENERATED ALWAYS AS (contact_id) STORED;
CREATE INDEX IF NOT EXISTS idx_instagram_conversations_id ON public.instagram_conversations (id);

UPDATE public.instagram_conversations
SET stage_completed_rules = '{}'::jsonb
WHERE stage_completed_rules IS NOT NULL AND jsonb_typeof(stage_completed_rules) <> 'object';

-- 2. Atualização de claim_experimental_cycle: blindagem contra "path element at position 1 is not an integer"
CREATE OR REPLACE FUNCTION public.claim_experimental_cycle(
  p_conversation_id text, p_cycle_token text, p_stale_seconds int DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_outbox jsonb;
  v_old_token text;
  v_active_at timestamptz;
  v_entry_key text;
  v_entry jsonb;
  v_msg_id text;
  v_claimed jsonb;
  v_possible_send boolean := false;
  v_released int := 0;
  v_uncertain int := 0;
  v_recovered boolean := false;
  v_record jsonb;
  v_retry_count int;
BEGIN
  SELECT stage_completed_rules INTO v_rules
    FROM public.instagram_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  -- Blindagem estrutural: garante que v_rules e v_orch são objetos JSONB
  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN
    v_rules := '{}'::jsonb;
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  IF jsonb_typeof(v_orch) <> 'object' THEN
    v_orch := '{}'::jsonb;
  END IF;

  -- Uma nova inbound após esgotamento inaugura outro lote de tentativas.
  IF v_orch->>'technicalRetryExhaustedAt' IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.instagram_messages m
    WHERE m.conversation_id = p_conversation_id AND m.is_mine IS FALSE
      AND m.created_at > (v_orch->>'technicalRetryExhaustedAt')::timestamptz
      AND COALESCE(v_orch->'messageLedger'->>m.id, 'pending') <> 'processed'
  ) THEN
    v_orch := jsonb_set(v_orch, '{technicalRetryCount}', '0'::jsonb);
    v_orch := jsonb_set(v_orch, '{technicalRetryExhaustedAt}', 'null'::jsonb);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
  END IF;

  IF COALESCE((v_orch->>'technicalRetryCount')::int, 0) >= 3
    AND NULLIF(v_rules->>'active_cycle_token', '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'retry_exhausted');
  END IF;

  v_old_token := v_rules->>'active_cycle_token';
  IF v_old_token IS NOT NULL AND v_old_token <> '' AND v_old_token <> p_cycle_token THEN
    BEGIN
      v_active_at := (v_rules->>'active_cycle_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_active_at := NULL;
    END;
    IF v_active_at IS NOT NULL AND now() - v_active_at <
      (greatest(COALESCE(p_stale_seconds, 300), 300) || ' seconds')::interval THEN
      RETURN jsonb_build_object('success', false, 'reason', 'active_lock', 'activeCycleToken', v_old_token);
    END IF;

    v_recovered := true;
    v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
    IF jsonb_typeof(v_orch) <> 'object' THEN v_orch := '{}'::jsonb; END IF;
    v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
    v_outbox := COALESCE(v_orch->'outbox', '{}'::jsonb);
    IF jsonb_typeof(v_ledger) <> 'object' OR jsonb_typeof(v_outbox) <> 'object' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'invalid_recovery_contract');
    END IF;

    FOR v_entry_key, v_entry IN SELECT * FROM jsonb_each(v_outbox) LOOP
      IF v_entry->>'cycleId' = v_old_token THEN
        IF v_entry->>'status' = 'sending' THEN
          v_entry := v_entry || jsonb_build_object(
            'status', 'dispatch_uncertain', 'isUncertain', true,
            'lastError', 'stale_cycle_recovery: envio iniciado sem confirmação');
          v_outbox := jsonb_set(v_outbox, ARRAY[v_entry_key], v_entry);
          v_uncertain := v_uncertain + 1;
        ELSIF v_entry->>'status' = 'dispatch_uncertain' OR COALESCE((v_entry->>'isUncertain')::boolean, false) THEN
          v_uncertain := v_uncertain + 1;
        END IF;
        IF v_entry->>'status' IN ('sent', 'sending', 'dispatch_uncertain')
          OR NULLIF(v_entry->>'providerMessageId', '') IS NOT NULL
          OR COALESCE((v_entry->>'isUncertain')::boolean, false) THEN
          v_possible_send := true;
        END IF;
      END IF;
    END LOOP;

    v_claimed := v_orch->'activeClaimedMessageIds';
    IF jsonb_typeof(v_claimed) = 'array' THEN
      FOR v_msg_id IN SELECT jsonb_array_elements_text(v_claimed) LOOP
        IF v_ledger->>v_msg_id = 'claimed' THEN
          v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], to_jsonb(CASE WHEN v_possible_send THEN 'processed' ELSE 'pending' END));
          IF NOT v_possible_send THEN v_released := v_released + 1; END IF;
        END IF;
      END LOOP;
    ELSE
      FOR v_msg_id IN SELECT key FROM jsonb_each_text(v_ledger) WHERE value = 'claimed' LOOP
        v_ledger := jsonb_set(v_ledger, ARRAY[v_msg_id], to_jsonb(CASE WHEN v_possible_send THEN 'processed' ELSE 'pending' END));
        IF NOT v_possible_send THEN v_released := v_released + 1; END IF;
      END LOOP;
    END IF;

    v_record := jsonb_build_object(
      'cycleId', v_old_token, 'conversationId', p_conversation_id,
      'status', 'failed', 'completedAt', now(),
      'trace', jsonb_build_array('cycle_marked_stale', 'cycle_recovery_started',
        CASE WHEN v_possible_send THEN 'dispatch_uncertain' ELSE 'pending_messages_released' END,
        'cycle_recovery_completed'));

    v_orch := jsonb_set(v_orch, '{recentCycles}',
      (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) FROM (
        SELECT value FROM jsonb_array_elements(
          jsonb_build_array(v_record) || CASE WHEN jsonb_typeof(v_orch->'recentCycles') = 'array'
            THEN v_orch->'recentCycles' ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS t(value, ord) WHERE ord <= 5
      ) AS recent));
    v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
    v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
    v_orch := jsonb_set(v_orch, '{activeClaimedMessageIds}', '[]'::jsonb);
    v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', '"failed"'::jsonb);
    v_orch := jsonb_set(v_orch, '{lastError}', to_jsonb('stale_agent_timeout'::text));
    v_retry_count := LEAST(3, COALESCE((v_orch->>'technicalRetryCount')::int, 0) + 1);
    v_orch := jsonb_set(v_orch, '{technicalRetryCount}', to_jsonb(v_retry_count));
    IF v_retry_count >= 3 THEN
      v_orch := jsonb_set(v_orch, '{technicalRetryExhaustedAt}', to_jsonb(now()::text));
    END IF;
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
    IF v_retry_count >= 3 THEN
      v_rules := jsonb_set(v_rules, '{active_cycle_token}', 'null'::jsonb);
      v_rules := jsonb_set(v_rules, '{active_cycle_at}', 'null'::jsonb);
      UPDATE public.instagram_conversations SET stage_completed_rules = v_rules WHERE id = p_conversation_id;
      RETURN jsonb_build_object('success', false, 'reason', 'retry_exhausted',
        'staleRecovered', true, 'previousCycleToken', v_old_token,
        'releasedMessageCount', v_released, 'uncertainMessageCount', v_uncertain);
    END IF;
  END IF;

  v_rules := jsonb_set(v_rules, '{active_cycle_token}', to_jsonb(p_cycle_token));
  v_rules := jsonb_set(v_rules, '{active_cycle_at}', to_jsonb(now()::text));
  UPDATE public.instagram_conversations SET stage_completed_rules = v_rules WHERE id = p_conversation_id;
  RETURN jsonb_build_object('success', true, 'reason', 'claimed',
    'activeCycleToken', p_cycle_token, 'staleRecovered', v_recovered,
    'previousCycleToken', CASE WHEN v_recovered THEN v_old_token ELSE NULL END,
    'releasedMessageCount', v_released, 'uncertainMessageCount', v_uncertain);
END;
$$;

-- 3. Nova RPC: patch_chat_progress_atomic
-- Permite que o frontend atualize pontualmente dados de progresso e etapa
-- SEM substituir stage_completed_rules inteiro e preservando outbox, ledger e lock.
CREATE OR REPLACE FUNCTION public.patch_chat_progress_atomic(
  p_conversation_id text,
  p_current_stage_id text DEFAULT NULL,
  p_completed_goal_ids text[] DEFAULT NULL,
  p_completed_item_ids text[] DEFAULT NULL,
  p_objective_progress jsonb DEFAULT NULL,
  p_is_converted boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv_id text;
  v_rules jsonb;
  v_orch jsonb;
  v_chat_progress jsonb;
  v_now text := now()::text;
BEGIN
  -- Busca a conversa sob lock exclusivo FOR UPDATE (aceita id ou contact_id)
  SELECT id, stage_completed_rules INTO v_conv_id, v_rules
    FROM public.instagram_conversations
    WHERE id = p_conversation_id OR contact_id = p_conversation_id
    LIMIT 1
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN
    v_rules := '{}'::jsonb;
  END IF;

  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  IF jsonb_typeof(v_orch) <> 'object' THEN v_orch := '{}'::jsonb; END IF;

  v_chat_progress := COALESCE(v_rules->'chat_progress', '{}'::jsonb);
  IF jsonb_typeof(v_chat_progress) <> 'object' THEN v_chat_progress := '{}'::jsonb; END IF;

  -- 1. Atualização pontual de currentStageId
  IF p_current_stage_id IS NOT NULL AND btrim(p_current_stage_id) <> '' THEN
    v_rules := jsonb_set(v_rules, '{current_stage_id}', to_jsonb(p_current_stage_id));
    v_chat_progress := jsonb_set(v_chat_progress, '{currentStageId}', to_jsonb(p_current_stage_id));
    v_orch := jsonb_set(v_orch, '{currentStageId}', to_jsonb(p_current_stage_id));
  END IF;

  -- 2. Atualização pontual de completedGoalIds
  IF p_completed_goal_ids IS NOT NULL THEN
    v_rules := jsonb_set(v_rules, '{completed_goals}', to_jsonb(p_completed_goal_ids));
    v_chat_progress := jsonb_set(v_chat_progress, '{completedGoalIds}', to_jsonb(p_completed_goal_ids));
    v_orch := jsonb_set(v_orch, '{completedGoalIds}', to_jsonb(p_completed_goal_ids));
  END IF;

  -- 3. Atualização pontual de completedItemIds (checklist legado do cofre)
  IF p_completed_item_ids IS NOT NULL THEN
    v_chat_progress := jsonb_set(v_chat_progress, '{completedItemIds}', to_jsonb(p_completed_item_ids));
  END IF;

  -- 4. Atualização pontual de objectiveProgress
  IF p_objective_progress IS NOT NULL THEN
    IF jsonb_typeof(p_objective_progress) = 'object' THEN
      v_rules := jsonb_set(v_rules, '{objective_progress}', p_objective_progress);
      v_chat_progress := jsonb_set(v_chat_progress, '{objectiveProgress}', p_objective_progress);
      v_orch := jsonb_set(v_orch, '{objectiveProgress}', p_objective_progress);
    END IF;
  END IF;

  -- 5. Atualização pontual de isConverted
  IF p_is_converted IS NOT NULL THEN
    v_chat_progress := jsonb_set(v_chat_progress, '{isConverted}', to_jsonb(p_is_converted));
    v_orch := jsonb_set(v_orch, '{isConverted}', to_jsonb(p_is_converted));
  END IF;

  -- Atualiza timestamps de progresso
  v_chat_progress := jsonb_set(v_chat_progress, '{updatedAt}', to_jsonb(v_now));
  v_rules := jsonb_set(v_rules, '{chat_progress}', v_chat_progress);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  -- IMPORTANTE: Os campos operacionais críticos (active_cycle_token, active_cycle_at,
  -- preempt_requested, orchestration.outbox, orchestration.messageLedger, etc.)
  -- permanecem 100% INTACTOS e NUNCA são tocados por esta função.

  UPDATE public.instagram_conversations
  SET stage_completed_rules = v_rules,
      current_stage_id = COALESCE(p_current_stage_id, current_stage_id),
      updated_at = now()
  WHERE id = v_conv_id;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'progress_patched',
    'conversationId', v_conv_id,
    'currentStageId', COALESCE(p_current_stage_id, v_rules->>'current_stage_id'),
    'updatedAt', v_now
  );
END;
$$;

-- Sobrecarga conveniente que aceita payload JSONB direto do frontend/Supabase client
CREATE OR REPLACE FUNCTION public.patch_chat_progress_atomic(
  p_conversation_id text,
  p_progress_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage_id text;
  v_goals text[];
  v_items text[];
  v_obj_prog jsonb;
  v_is_conv boolean;
BEGIN
  v_stage_id := p_progress_patch->>'currentStageId';
  IF p_progress_patch ? 'completedGoalIds' AND jsonb_typeof(p_progress_patch->'completedGoalIds') = 'array' THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_goals FROM jsonb_array_elements_text(p_progress_patch->'completedGoalIds') t(x);
  END IF;
  IF p_progress_patch ? 'completedItemIds' AND jsonb_typeof(p_progress_patch->'completedItemIds') = 'array' THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_items FROM jsonb_array_elements_text(p_progress_patch->'completedItemIds') t(x);
  END IF;
  v_obj_prog := p_progress_patch->'objectiveProgress';
  IF p_progress_patch ? 'isConverted' THEN
    v_is_conv := (p_progress_patch->>'isConverted')::boolean;
  END IF;

  RETURN public.patch_chat_progress_atomic(
    p_conversation_id,
    v_stage_id,
    v_goals,
    v_items,
    v_obj_prog,
    v_is_conv
  );
END;
$$;

-- 4. Nova RPC: authorize_send_now_atomic
-- Autoriza atomicamente o clique em "Enviar agora" sob lock exclusivo,
-- verificando o ciclo ativo real e impedindo que o estado crítico seja corrompido.
CREATE OR REPLACE FUNCTION public.authorize_send_now_atomic(
  p_conversation_id text,
  p_new_cycle_token text,
  p_stale_seconds int DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
  v_auto_respond boolean;
  v_old_token text;
  v_active_at timestamptz;
BEGIN
  SELECT stage_completed_rules, ai_auto_respond
    INTO v_rules, v_auto_respond
    FROM public.instagram_conversations
    WHERE id = p_conversation_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'result', 'conversation_not_found', 'reason', 'conversation_not_found');
  END IF;

  IF v_auto_respond IS FALSE THEN
    RETURN jsonb_build_object('success', false, 'result', 'disabled', 'status', 'disabled', 'reason', 'autopilot_disabled');
  END IF;

  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN
    v_rules := '{}'::jsonb;
  END IF;

  -- Verifica o lock ativo real (Autoridade no PostgreSQL, não no HUD)
  v_old_token := v_rules->>'active_cycle_token';
  IF v_old_token IS NOT NULL AND v_old_token <> '' THEN
    BEGIN
      v_active_at := (v_rules->>'active_cycle_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_active_at := NULL;
    END;

    -- Se o ciclo ativo estiver rodando dentro do período de concessão (< 300s)
    IF v_active_at IS NOT NULL AND now() - v_active_at < (greatest(COALESCE(p_stale_seconds, 300), 300) || ' seconds')::interval THEN
      RETURN jsonb_build_object(
        'success', true,
        'result', 'already_processing',
        'activeCycleToken', v_old_token,
        'cycleId', v_old_token,
        'reason', 'active_cycle_running'
      );
    END IF;
  END IF;

  -- Se não há ciclo ativo recente, limpa o debounce e marca envio imediato pontualmente
  v_rules := jsonb_set(v_rules, '{send_immediately}', 'true'::jsonb);
  IF v_rules ? 'cancel_current_cycle' THEN
    v_rules := v_rules - 'cancel_current_cycle';
  END IF;

  UPDATE public.instagram_conversations
  SET ai_debounce_until = NULL,
      stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'result', 'authorized',
    'cycleToken', p_new_cycle_token
  );
END;
$$;

-- 5. Novas RPCs para HUD Control atômico (evita SELECT -> spread -> UPDATE no backend)
CREATE OR REPLACE FUNCTION public.patch_autopilot_hold_edit_atomic(
  p_conversation_id text,
  p_is_editing boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
BEGIN
  SELECT stage_completed_rules INTO v_rules
    FROM public.instagram_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;
  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN v_rules := '{}'::jsonb; END IF;

  v_rules := jsonb_set(v_rules, '{editing_in_progress}', to_jsonb(p_is_editing));
  UPDATE public.instagram_conversations SET stage_completed_rules = v_rules WHERE id = p_conversation_id;
  RETURN jsonb_build_object('success', true, 'editing_in_progress', p_is_editing);
END;
$$;

CREATE OR REPLACE FUNCTION public.patch_autopilot_edit_preview_atomic(
  p_conversation_id text,
  p_edited_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
BEGIN
  SELECT stage_completed_rules INTO v_rules
    FROM public.instagram_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;
  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN v_rules := '{}'::jsonb; END IF;

  v_rules := jsonb_set(v_rules, '{edited_balloon_text}', to_jsonb(p_edited_text));
  v_rules := jsonb_set(v_rules, '{editing_in_progress}', 'false'::jsonb);
  UPDATE public.instagram_conversations SET stage_completed_rules = v_rules WHERE id = p_conversation_id;
  RETURN jsonb_build_object('success', true, 'edited_balloon_text', p_edited_text);
END;
$$;

CREATE OR REPLACE FUNCTION public.patch_autopilot_pause_atomic(
  p_conversation_id text,
  p_paused boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
BEGIN
  SELECT stage_completed_rules INTO v_rules
    FROM public.instagram_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;
  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN v_rules := '{}'::jsonb; END IF;

  IF p_paused THEN
    v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'true'::jsonb);
    v_rules := jsonb_set(v_rules, '{status}', '"paused_manual"'::jsonb);
    UPDATE public.instagram_conversations
    SET ai_auto_respond = false,
        ai_debounce_until = NULL,
        stage_completed_rules = v_rules
    WHERE id = p_conversation_id;
  ELSE
    IF v_rules ? 'cancel_current_cycle' THEN v_rules := v_rules - 'cancel_current_cycle'; END IF;
    IF v_rules->>'status' = 'paused_manual' THEN v_rules := v_rules - 'status'; END IF;
    UPDATE public.instagram_conversations
    SET ai_auto_respond = true,
        stage_completed_rules = v_rules
    WHERE id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'paused', p_paused);
END;
$$;

-- 6. Trigger Guard Defensivo no PostgreSQL
-- Impede que updates diretos de browser (roles anon/authenticated) apaguem ou corrompam
-- os campos operacionais críticos de stage_completed_rules.
CREATE OR REPLACE FUNCTION public.guard_stage_completed_rules_integrity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_old_orch jsonb;
  v_new_orch jsonb;
BEGIN
  -- Se o valor não foi alterado, permite normalmente
  IF NEW.stage_completed_rules IS NOT DISTINCT FROM OLD.stage_completed_rules THEN
    RETURN NEW;
  END IF;

  -- Se for chamada originada por cliente anon ou authenticated diretamente no Supabase REST ou via JWT de cliente
  IF (
    current_user IN ('anon', 'authenticated')
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') IN ('anon', 'authenticated')
  ) AND OLD.stage_completed_rules IS NOT NULL THEN
    IF jsonb_typeof(OLD.stage_completed_rules) = 'object' THEN
      -- Garante que NEW.stage_completed_rules é objeto
      IF NEW.stage_completed_rules IS NULL OR jsonb_typeof(NEW.stage_completed_rules) <> 'object' THEN
        NEW.stage_completed_rules := OLD.stage_completed_rules;
        RETURN NEW;
      END IF;

      -- Preserva active_cycle_token se existia no OLD
      IF OLD.stage_completed_rules ? 'active_cycle_token' AND (OLD.stage_completed_rules->>'active_cycle_token') IS NOT NULL THEN
        NEW.stage_completed_rules := jsonb_set(
          NEW.stage_completed_rules,
          '{active_cycle_token}',
          OLD.stage_completed_rules->'active_cycle_token'
        );
      END IF;

      -- Preserva active_cycle_at se existia no OLD
      IF OLD.stage_completed_rules ? 'active_cycle_at' AND (OLD.stage_completed_rules->>'active_cycle_at') IS NOT NULL THEN
        NEW.stage_completed_rules := jsonb_set(
          NEW.stage_completed_rules,
          '{active_cycle_at}',
          OLD.stage_completed_rules->'active_cycle_at'
        );
      END IF;

      -- Preserva preempt_requested se existia no OLD
      IF OLD.stage_completed_rules ? 'preempt_requested' THEN
        NEW.stage_completed_rules := jsonb_set(
          NEW.stage_completed_rules,
          '{preempt_requested}',
          OLD.stage_completed_rules->'preempt_requested'
        );
      END IF;

      -- Preserva toda a estrutura interna de orchestration (outbox, messageLedger, etc.)
      v_old_orch := OLD.stage_completed_rules->'orchestration';
      IF jsonb_typeof(v_old_orch) = 'object' THEN
        v_new_orch := COALESCE(NEW.stage_completed_rules->'orchestration', '{}'::jsonb);
        IF jsonb_typeof(v_new_orch) <> 'object' THEN v_new_orch := '{}'::jsonb; END IF;

        -- Preserva outbox
        IF v_old_orch ? 'outbox' THEN
          v_new_orch := jsonb_set(v_new_orch, '{outbox}', v_old_orch->'outbox');
        END IF;

        -- Preserva messageLedger
        IF v_old_orch ? 'messageLedger' THEN
          v_new_orch := jsonb_set(v_new_orch, '{messageLedger}', v_old_orch->'messageLedger');
        END IF;

        -- Preserva activeClaimedMessageIds
        IF v_old_orch ? 'activeClaimedMessageIds' THEN
          v_new_orch := jsonb_set(v_new_orch, '{activeClaimedMessageIds}', v_old_orch->'activeClaimedMessageIds');
        END IF;

        -- Preserva activeCycle
        IF v_old_orch ? 'activeCycle' THEN
          v_new_orch := jsonb_set(v_new_orch, '{activeCycle}', v_old_orch->'activeCycle');
        END IF;

        -- Preserva recentCycles
        IF v_old_orch ? 'recentCycles' THEN
          v_new_orch := jsonb_set(v_new_orch, '{recentCycles}', v_old_orch->'recentCycles');
        END IF;

        -- Preserva retry counters
        IF v_old_orch ? 'technicalRetryCount' THEN
          v_new_orch := jsonb_set(v_new_orch, '{technicalRetryCount}', v_old_orch->'technicalRetryCount');
        END IF;
        IF v_old_orch ? 'technicalRetryExhaustedAt' THEN
          v_new_orch := jsonb_set(v_new_orch, '{technicalRetryExhaustedAt}', v_old_orch->'technicalRetryExhaustedAt');
        END IF;

        NEW.stage_completed_rules := jsonb_set(NEW.stage_completed_rules, '{orchestration}', v_new_orch);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_stage_completed_rules_integrity ON public.instagram_conversations;
CREATE TRIGGER trg_guard_stage_completed_rules_integrity
  BEFORE UPDATE ON public.instagram_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_stage_completed_rules_integrity();

-- 7. Permissões de execução para as RPCs SECURITY DEFINER
REVOKE ALL ON FUNCTION public.patch_chat_progress_atomic(text, text, text[], text[], jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patch_chat_progress_atomic(text, text, text[], text[], jsonb, boolean) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.patch_chat_progress_atomic(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patch_chat_progress_atomic(text, jsonb) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.authorize_send_now_atomic(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_send_now_atomic(text, text, integer) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.patch_autopilot_hold_edit_atomic(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patch_autopilot_hold_edit_atomic(text, boolean) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.patch_autopilot_edit_preview_atomic(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patch_autopilot_edit_preview_atomic(text, text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean) TO anon, authenticated, service_role;

-- Registro na tabela de migrations
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260923170000')
ON CONFLICT (version) DO NOTHING;
