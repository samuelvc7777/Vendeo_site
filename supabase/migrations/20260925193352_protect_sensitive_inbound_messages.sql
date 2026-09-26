CREATE OR REPLACE FUNCTION public.mark_manual_review_inbounds_processed_atomic(
  p_conversation_id text,
  p_message_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rules jsonb;
  v_orchestration jsonb;
  v_ledger jsonb;
  v_message_id text;
  v_count integer := 0;
BEGIN
  IF p_conversation_id IS NULL OR length(trim(p_conversation_id)) = 0 THEN
    RAISE EXCEPTION 'conversation_id is required';
  END IF;

  SELECT COALESCE(stage_completed_rules, '{}'::jsonb)
    INTO v_rules
    FROM public.instagram_conversations
    WHERE id = p_conversation_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  v_orchestration := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_ledger := COALESCE(v_orchestration->'messageLedger', '{}'::jsonb);

  FOREACH v_message_id IN ARRAY COALESCE(p_message_ids, ARRAY[]::text[]) LOOP
    IF v_message_id IS NOT NULL AND length(trim(v_message_id)) > 0 THEN
      v_ledger := jsonb_set(v_ledger, ARRAY[v_message_id], '"processed"'::jsonb, true);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  v_orchestration := jsonb_set(v_orchestration, '{messageLedger}', v_ledger, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orchestration, true);

  UPDATE public.instagram_conversations
    SET stage_completed_rules = v_rules,
        updated_at = now()
    WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'processed_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_manual_review_inbounds_processed_atomic(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_manual_review_inbounds_processed_atomic(text, text[]) TO service_role;
