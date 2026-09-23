-- ==============================================================================
-- Migration: 20260920190000_create_request_experimental_cycle_preemption.sql
-- Descrição: Função PL/pgSQL com SELECT ... FOR UPDATE para sinalização de
--            preempção atômica no PostgreSQL.
--            Garante que a chegada de uma nova mensagem faça um PATCH pontual
--            e transacional no JSON atual (inboundRevision + 1, preempt_requested = true,
--            messageLedger[p_message_id] = "pending") sem depender de snapshots
--            antigos lidos em JavaScript, eliminando qualquer risco de TOCTOU
--            ou perda de dados recém-commitados (ContactMemory, completed_goals, etc).
-- ==============================================================================

CREATE OR REPLACE FUNCTION request_experimental_cycle_preemption(
  p_conversation_id text,
  p_message_id text DEFAULT NULL,
  p_debounce_until timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_active_token text;
  v_current_rev int;
  v_new_rev int;
  v_ledger jsonb;
  v_debounce_target timestamptz;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para garantir isolamento ACID total
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'conversation_not_found'
    );
  END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_active_token := v_rules->>'active_cycle_token';

  -- 2. Lê e prepara o bloco orchestration
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_current_rev := COALESCE((v_orch->>'inboundRevision')::int, 0);
  v_new_rev := v_current_rev + 1;

  -- 3. Atualiza atomicamente a revisão e as flags de preempção no JSON atual
  v_orch := jsonb_set(v_orch, '{inboundRevision}', to_jsonb(v_new_rev));
  v_orch := jsonb_set(v_orch, '{preemptRequested}', 'true'::jsonb);
  v_rules := jsonb_set(v_rules, '{preempt_requested}', 'true'::jsonb);

  -- 4. Se p_message_id fornecido, marca no messageLedger como pending
  IF p_message_id IS NOT NULL AND btrim(p_message_id) <> '' THEN
    v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
    v_ledger := jsonb_set(v_ledger, ARRAY[p_message_id], '"pending"'::jsonb, true);
    v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);
  END IF;

  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  -- 5. Define timestamp de debounce (padrão 2.5s caso não informado)
  v_debounce_target := COALESCE(p_debounce_until, NOW() + INTERVAL '2.5 seconds');
  v_rules := jsonb_set(v_rules, '{ai_debounce_until}', to_jsonb(to_char(v_debounce_target, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));

  -- 6. Atualização atômica na tabela preservando todos os demais campos da conversa
  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules,
      ai_auto_respond = true,
      ai_debounce_until = v_debounce_target
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'inboundRevision', v_new_rev,
    'activeCycleToken', v_active_token
  );
END;
$$;
