DO $audit$
DECLARE
  v_conv text;
  v_id text := '__automation_audit_' || gen_random_uuid()::text;
  v_account text := '__audit_' || gen_random_uuid()::text;
  v_result jsonb;
  v_count integer;
BEGIN
  BEGIN
    SELECT id INTO v_conv FROM public.instagram_conversations WHERE channel = 'whatsapp2' LIMIT 1;
    IF v_conv IS NULL THEN RAISE EXCEPTION 'AUDIT_NO_FIXTURE_CONVERSATION'; END IF;
    INSERT INTO public.whatsapp2_delivery_queue(id,conversation_id,gateway_account_id,recipient_id,kind,text_content,status,claimed_by,claimed_at,attempts,provider_message_id)
    VALUES(v_id,v_conv,v_account,'audit@c.us','text','AUDIT_NO_SEND','sent','audit-worker',clock_timestamp(),1,'audit-provider');
    v_result := public.complete_whatsapp2_delivery(v_id,'audit-worker',false,NULL,'simulated persistence failure',false);
    IF (SELECT status FROM public.whatsapp2_delivery_queue WHERE id=v_id) <> 'sent' THEN
      RAISE EXCEPTION 'AUDIT_CONFIRMATION_DOWNGRADED';
    END IF;
    UPDATE public.whatsapp2_delivery_queue SET status='sending',provider_message_id=NULL WHERE id=v_id;
    v_result := public.complete_whatsapp2_delivery(v_id,'audit-worker',true,NULL,NULL,false);
    IF (SELECT status FROM public.whatsapp2_delivery_queue WHERE id=v_id) <> 'uncertain' THEN
      RAISE EXCEPTION 'AUDIT_SUCCESS_WITHOUT_PROVIDER';
    END IF;
    UPDATE public.whatsapp2_delivery_queue SET status='sending',claimed_at=clock_timestamp()-interval '10 minutes' WHERE id=v_id;
    SELECT count(*) INTO v_count FROM public.claim_whatsapp2_delivery_batch('audit-worker',1,90,v_account);
    IF v_count <> 0 THEN RAISE EXCEPTION 'AUDIT_STALE_DUPLICATION'; END IF;
    IF (SELECT status FROM public.whatsapp2_delivery_queue WHERE id=v_id) <> 'uncertain' THEN
      RAISE EXCEPTION 'AUDIT_STALE_NOT_QUARANTINED';
    END IF;
    UPDATE public.whatsapp2_delivery_queue SET status='pending',claimed_by=NULL,claimed_at=NULL WHERE id=v_id;
    SELECT count(*) INTO v_count FROM public.claim_whatsapp2_delivery_batch('audit-worker',1,90,v_account);
    IF v_count <> 1 THEN RAISE EXCEPTION 'AUDIT_PENDING_NOT_CLAIMED'; END IF;
    SELECT count(*) INTO v_count FROM public.claim_whatsapp2_delivery_batch('other-worker',1,90,v_account);
    IF v_count <> 0 THEN RAISE EXCEPTION 'AUDIT_ACTIVE_DOUBLE_CLAIM'; END IF;
    RAISE EXCEPTION USING ERRCODE='A0001',MESSAGE='audit rollback';
  EXCEPTION WHEN SQLSTATE 'A0001' THEN NULL;
  END;
END;
$audit$;
