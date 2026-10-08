DO $audit$
DECLARE v_id text; v_result jsonb; v_state text;
BEGIN
  BEGIN
    SELECT id INTO v_id FROM public.instagram_conversations WHERE channel='whatsapp2' LIMIT 1;
    UPDATE public.instagram_conversations SET ai_auto_respond=false,
      stage_completed_rules=jsonb_build_object('status','disabled','orchestration',jsonb_build_object('outbox',jsonb_build_object('audit-action',jsonb_build_object('status','pending','id','audit-action','actionIndex',0)))) WHERE id=v_id;
    v_result:=public.claim_outbox_entry(v_id,'audit-action','audit-worker');
    IF (v_result->>'success')::boolean THEN RAISE EXCEPTION 'AUDIT_DISABLED_CONVERSATION_CLAIMED'; END IF;
    FOREACH v_state IN ARRAY ARRAY['waiting_human','paused_guardrail','paused_handoff','cancelled','failed'] LOOP
      UPDATE public.instagram_conversations SET ai_auto_respond=true,
        stage_completed_rules=jsonb_set(stage_completed_rules,'{status}',to_jsonb(v_state)) WHERE id=v_id;
      v_result:=public.claim_outbox_entry(v_id,'audit-action','audit-worker');
      IF (v_result->>'success')::boolean THEN RAISE EXCEPTION 'AUDIT_PAUSED_CONVERSATION_CLAIMED: %',v_state; END IF;
    END LOOP;
    UPDATE public.instagram_conversations SET stage_completed_rules=jsonb_set(stage_completed_rules,'{status}','"idle"'::jsonb) WHERE id=v_id;
    v_result:=public.claim_outbox_entry(v_id,'audit-action','audit-worker');
    IF NOT (v_result->>'success')::boolean THEN RAISE EXCEPTION 'AUDIT_ACTIVE_CONVERSATION_BLOCKED'; END IF;
    v_result:=public.claim_outbox_entry(v_id,'audit-action','second-worker');
    IF (v_result->>'success')::boolean THEN RAISE EXCEPTION 'AUDIT_OUTBOX_DOUBLE_CLAIM'; END IF;
    RAISE EXCEPTION USING ERRCODE='A0001',MESSAGE='audit rollback';
  EXCEPTION WHEN SQLSTATE 'A0001' THEN NULL;
  END;
END;
$audit$;
