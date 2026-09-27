-- Mescla intenções de pergunta somente quando a action outbound correspondente
-- foi confirmada como sent. sourceMessageId torna a projeção repetível.
CREATE OR REPLACE FUNCTION public.record_brain_delivered_question_intents(
  p_conversation_id text,
  p_intents jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orchestration jsonb;
  v_existing jsonb;
  v_item jsonb;
  v_source_id text;
  v_added integer := 0;
BEGIN
  IF jsonb_typeof(p_intents) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_intents must be an array';
  END IF;

  SELECT stage_completed_rules INTO v_rules
  FROM public.instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'conversation_not_found'); END IF;

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orchestration := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_existing := CASE WHEN jsonb_typeof(v_orchestration->'recentQuestionIntents') = 'array'
    THEN v_orchestration->'recentQuestionIntents' ELSE '[]'::jsonb END;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_intents)
  LOOP
    v_source_id := NULLIF(v_item->>'sourceMessageId', '');
    IF v_source_id IS NULL OR COALESCE(v_item->>'intentKey', '') = '' THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_existing) AS q(value)
      WHERE q.value->>'sourceMessageId' = v_source_id
    ) THEN
      v_existing := v_existing || jsonb_build_array(v_item);
      v_added := v_added + 1;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(value ORDER BY ord), '[]'::jsonb) INTO v_existing
  FROM jsonb_array_elements(v_existing) WITH ORDINALITY AS q(value, ord)
  WHERE ord > GREATEST(jsonb_array_length(v_existing) - 10, 0);
  v_orchestration := jsonb_set(v_orchestration, '{recentQuestionIntents}', v_existing, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orchestration, true);
  UPDATE public.instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'added', v_added);
END;
$$;

REVOKE ALL ON FUNCTION public.record_brain_delivered_question_intents(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_brain_delivered_question_intents(text, jsonb) TO service_role;
