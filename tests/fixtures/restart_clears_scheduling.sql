DO $audit$
DECLARE v_id text; v_turn text; v_result jsonb; v_state jsonb; v_action text; v_queue text; v_before text;
BEGIN
  BEGIN
    SELECT c.id INTO v_id FROM public.instagram_conversations c
    WHERE c.id='wa2:account-553284039466:553298289724@c.us'
      AND NOT EXISTS(SELECT 1 FROM public.brain_decision_actions a WHERE a.conversation_id=c.id AND a.status IN('sending','dispatch_uncertain'))
      AND NOT EXISTS(SELECT 1 FROM public.whatsapp2_delivery_queue q WHERE q.conversation_id=c.id AND q.status IN('sending','uncertain'));
    IF v_id IS NULL THEN RAISE EXCEPTION 'NO_SAFE_RESET_FIXTURE'; END IF;
    SELECT id INTO v_turn FROM public.brain_turns WHERE conversation_id=v_id AND status='completed' LIMIT 1;
    UPDATE public.brain_turns SET status='brain_running',updated_at=now()-interval '10 minutes',lease_expires_at=NULL,recovery_lease_expires_at=NULL WHERE id=v_turn;
    UPDATE public.instagram_conversations SET stage_completed_rules=jsonb_build_object('orchestration',jsonb_build_object('recentCycles',jsonb_build_array(jsonb_build_object('status','failed')),'technicalRetryCount',3,'preemptRequested',true,'activeClaimedMessageIds',jsonb_build_array('old-message'))) WHERE id=v_id;
    UPDATE public.autopilot_chat_states SET state=state||jsonb_build_object('scheduledResponseAt',now()+interval '1 hour','pendingOutboundMessages',jsonb_build_array(jsonb_build_object('content','old-unsent')),'pendingAction',jsonb_build_object('text','old-pending'),'pauseReason','old-error','activity',jsonb_build_object('phase','failed')) WHERE conversation_id=v_id;
    SELECT a.id,q.id INTO v_action,v_queue FROM public.brain_decision_actions a JOIN public.whatsapp2_delivery_queue q ON q.id=a.idempotency_key AND q.conversation_id=a.conversation_id WHERE a.conversation_id=v_id AND a.status='sent' AND q.status='sent' LIMIT 1;
    UPDATE public.brain_decision_actions SET status='pending',provider_message_id=NULL WHERE id=v_action;
    UPDATE public.whatsapp2_delivery_queue SET status='pending',provider_message_id=NULL WHERE id=v_queue;
    v_result:=public.restart_autopilot_runtime_atomic(v_id);
    IF v_result->>'success'<>'true' THEN RAISE EXCEPTION 'RESET_REJECTED: %',v_result->>'reason'; END IF;
    SELECT state INTO v_state FROM public.autopilot_chat_states WHERE conversation_id=v_id;
    IF v_state->>'scheduledResponseAt' IS NOT NULL OR v_state->>'pendingAction' IS NOT NULL OR coalesce(v_state->'pendingOutboundMessages','[]')<>'[]'::jsonb THEN RAISE EXCEPTION 'RESET_LEFT_SCHEDULED_MESSAGES'; END IF;
    IF v_state->>'pauseReason' IS NOT NULL OR v_state->'activity'->>'phase'='failed' THEN RAISE EXCEPTION 'RESET_LEFT_ERROR_PROJECTION'; END IF;
    IF EXISTS(SELECT 1 FROM public.brain_turns WHERE id=v_turn AND status='brain_running') THEN RAISE EXCEPTION 'RESET_LEFT_OLD_RUNNING_TURN'; END IF;
    IF (SELECT status FROM public.brain_decision_actions WHERE id=v_action)<>'cancelled' OR (SELECT status FROM public.whatsapp2_delivery_queue WHERE id=v_queue)<>'failed' THEN RAISE EXCEPTION 'RESET_LEFT_PENDING_DELIVERY'; END IF;
    UPDATE public.whatsapp2_delivery_queue SET status='sending' WHERE id=v_queue;
    SELECT md5(stage_completed_rules::text) INTO v_before FROM public.instagram_conversations WHERE id=v_id;
    v_result:=public.restart_autopilot_runtime_atomic(v_id);
    IF v_result->>'success'='true' THEN RAISE EXCEPTION 'RESET_IGNORED_INFLIGHT_DELIVERY'; END IF;
    IF (SELECT md5(stage_completed_rules::text) FROM public.instagram_conversations WHERE id=v_id)<>v_before THEN RAISE EXCEPTION 'RESET_PARTIALLY_APPLIED_WHILE_BLOCKED'; END IF;
    UPDATE public.whatsapp2_delivery_queue SET status='failed' WHERE id=v_queue;
    UPDATE public.brain_decision_actions SET status='dispatch_uncertain' WHERE id=v_action;
    v_result:=public.restart_autopilot_runtime_atomic(v_id);
    IF v_result->>'success'='true' THEN RAISE EXCEPTION 'RESET_IGNORED_UNCERTAIN_ACTION'; END IF;
    RAISE EXCEPTION USING ERRCODE='A0001',MESSAGE='audit rollback';
  EXCEPTION WHEN SQLSTATE 'A0001' THEN NULL;
  END;
END;
$audit$;
