-- MIGRATION DO REPOSITÓRIO — NÃO APLICADA NESTA TAREFA.
-- Compatibilidade do banco com o código pré-refatoração (4cbf582d).
-- Não executar diretamente em produção.
-- Não faz rollback de dados, não remove migrations e não altera a Edge Function.

-- O código antigo envia p_reason, mas o banco remoto só possui a função de dois
-- argumentos. Mantemos a assinatura existente e adicionamos a sobrecarga usada
-- pela Edge Function, sem default parameter ambíguo.
CREATE OR REPLACE FUNCTION public.patch_autopilot_pause_atomic(
  p_conversation_id text,
  p_paused boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
BEGIN
  SELECT stage_completed_rules
    INTO v_rules
    FROM public.instagram_conversations
   WHERE id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  END IF;

  v_rules := CASE
    WHEN v_rules IS NULL OR jsonb_typeof(v_rules) <> 'object' THEN '{}'::jsonb
    ELSE v_rules
  END;

  IF p_paused THEN
    v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'true'::jsonb);
    v_rules := jsonb_set(v_rules, '{status}', '"paused_manual"'::jsonb);
    IF p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN
      v_rules := jsonb_set(v_rules, '{pause_reason}', to_jsonb(p_reason));
    END IF;

    UPDATE public.instagram_conversations
       SET ai_auto_respond = false,
           ai_debounce_until = NULL,
           stage_completed_rules = v_rules
     WHERE id = p_conversation_id;
  ELSE
    v_rules := v_rules - 'cancel_current_cycle' - 'pause_reason';
    IF v_rules->>'status' = 'paused_manual' THEN
      v_rules := v_rules - 'status';
    END IF;

    UPDATE public.instagram_conversations
       SET ai_auto_respond = true,
           stage_completed_rules = v_rules
     WHERE id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'paused', p_paused,
    'reason', p_reason
  );
END;
$$;

-- A Edge Function usa service_role. Não reabrir anon/authenticated sem decisão
-- explícita de segurança para a chamada direta feita pelo browser.
REVOKE ALL ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean, text) TO service_role;
