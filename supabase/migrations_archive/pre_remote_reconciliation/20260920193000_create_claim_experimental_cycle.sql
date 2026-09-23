-- ==============================================================================
-- Migration: 20260920193000_create_claim_experimental_cycle.sql
-- Descrição: Função PL/pgSQL com SELECT ... FOR UPDATE para aquisição atômica
--            de lock exclusivo de ciclo no modo experimental.
--            Elimina condição de corrida na aquisição inicial onde múltiplos workers
--            podiam assumir a mesma conversa simultaneamente.
-- ==============================================================================

CREATE OR REPLACE FUNCTION claim_experimental_cycle(
  p_conversation_id text,
  p_cycle_token text,
  p_stale_seconds int DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_active_token text;
  v_active_at text;
  v_active_at_ts timestamptz;
  v_is_stale boolean := false;
  v_now text := to_jsonb(now())::text;
BEGIN
  -- 1. Lock exclusivo a nível de linha da conversa
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
  v_active_at := v_rules->>'active_cycle_at';

  -- 2. Avalia se há lock ativo de outro ciclo
  IF v_active_token IS NOT NULL AND v_active_token <> '' AND v_active_token <> p_cycle_token THEN
    IF v_active_at IS NOT NULL THEN
      BEGIN
        v_active_at_ts := v_active_at::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_active_at_ts := now() - interval '1 hour';
      END;

      IF (now() - v_active_at_ts) >= (p_stale_seconds || ' seconds')::interval THEN
        v_is_stale := true;
      END IF;
    ELSE
      v_is_stale := true;
    END IF;

    -- Se lock ativo e NÃO expirado: rejeita atomicamente
    IF NOT v_is_stale THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'active_lock',
        'activeCycleToken', v_active_token
      );
    END IF;
  END IF;

  -- 3. Assume o lock atomicamente preservando integralmente todo o restante do JSON
  v_rules := jsonb_set(v_rules, '{active_cycle_token}', to_jsonb(p_cycle_token));
  v_rules := jsonb_set(v_rules, '{active_cycle_at}', to_jsonb(now()::text));

  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'claimed',
    'activeCycleToken', p_cycle_token
  );
END;
$$;
