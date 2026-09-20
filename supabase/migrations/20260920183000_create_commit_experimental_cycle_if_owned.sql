-- ==============================================================================
-- Migration: 20260920183000_create_commit_experimental_cycle_if_owned.sql
-- Descrição: Função PL/pgSQL com SELECT ... FOR UPDATE para lock exclusivo de linha
--            e commit atômico condicional (Compare-And-Set / CAS) do ciclo experimental.
--            Garante que o estado oficial (stage_completed_rules + ContactMemory)
--            somente seja persistido se o ciclo ainda for o detentor exclusivo do lock
--            (active_cycle_token = correlationId) e nenhuma preempção foi solicitada.
-- ==============================================================================

CREATE OR REPLACE FUNCTION commit_experimental_cycle_if_owned(
  p_conversation_id text,
  p_cycle_token text,
  p_new_stage_completed_rules jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rules jsonb;
  v_active_token text;
  v_preempt_requested boolean;
  v_final_rules jsonb;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa para garantir isolamento ACID total
  SELECT stage_completed_rules INTO v_rules
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'committed', false,
      'reason', 'not_found'
    );
  END IF;

  v_active_token := v_rules->>'active_cycle_token';
  v_preempt_requested := COALESCE((v_rules->>'preempt_requested')::boolean, false);

  -- 2. Valida se o ciclo atual ainda detém a custódia exclusiva do lock
  IF v_active_token IS NULL OR v_active_token <> p_cycle_token THEN
    RETURN jsonb_build_object(
      'committed', false,
      'reason', 'lost_lock',
      'activeToken', v_active_token
    );
  END IF;

  -- 3. Valida se preempção foi solicitada no último instante
  IF v_preempt_requested IS TRUE THEN
    RETURN jsonb_build_object(
      'committed', false,
      'reason', 'preempted'
    );
  END IF;

  -- 4. Garante que active_cycle_token seja limpo no commit oficial e preempção limpa
  v_final_rules := jsonb_set(p_new_stage_completed_rules, '{active_cycle_token}', 'null'::jsonb);
  v_final_rules := jsonb_set(v_final_rules, '{preempt_requested}', 'false'::jsonb);

  -- 5. Atualiza atomicamente a linha bloqueada
  UPDATE instagram_conversations
  SET stage_completed_rules = v_final_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'committed', true,
    'reason', 'committed'
  );
END;
$$;
