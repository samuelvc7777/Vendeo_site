-- CORREÇÃO DEFINITIVA NO RESTART:
-- 1. Limpa pendingOutboundMessages na tabela autopilot_chat_states para sumir com balões 'Aguardando...' residuais
-- 2. Remove v_latest_inbound_id do messageLedger para que o Brain não considere a mensagem duplicada/já processada
-- 3. Reseta lastProcessedMessageId na orquestração

CREATE OR REPLACE FUNCTION public.restart_autopilot_runtime_atomic(p_conversation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_rules jsonb;
  v_orch jsonb;
  v_outbox jsonb;
  v_outbox_item record;
  v_latest_inbound_id text;
  v_latest_inbound_at timestamptz;
  v_latest_outbound_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_blocked boolean := false;
  v_schedule_status text;
  v_cleaned_count integer := 0;
begin
  -- 1. Carregar regras da conversa com lock
  select stage_completed_rules into v_rules
  from public.instagram_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  if v_rules is null or jsonb_typeof(v_rules) <> 'object' then
    v_rules := '{}'::jsonb;
  end if;

  -- Verificar bloqueio de cronograma manual
  v_schedule_status := coalesce(v_rules->>'schedule_status', '');
  if v_schedule_status = 'completed_waiting_manual' then
    return jsonb_build_object('success', false, 'reason', 'schedule_completed_waiting_manual');
  end if;

  -- === AUTO-HEAL: Limpar resíduos ANTES de verificar bloqueios ===
  
  -- A. Limpar brain_decision_actions
  UPDATE public.brain_decision_actions
  SET status = 'cancelled', updated_at = v_now
  WHERE conversation_id = p_conversation_id
    AND status IN ('sending', 'dispatch_uncertain');
  GET DIAGNOSTICS v_cleaned_count = ROW_COUNT;

  -- B. Limpar whatsapp2_delivery_queue
  UPDATE public.whatsapp2_delivery_queue
  SET status = 'failed', completed_at = v_now, updated_at = v_now
  WHERE conversation_id = p_conversation_id
    AND status IN ('sending', 'uncertain');
  GET DIAGNOSTICS v_cleaned_count = v_cleaned_count + ROW_COUNT;

  -- C. Limpar orchestration.outbox no JSONB
  v_orch := case when jsonb_typeof(v_rules->'orchestration') = 'object' then v_rules->'orchestration' else '{}'::jsonb end;
  v_outbox := case when jsonb_typeof(v_orch->'outbox') = 'object' then v_orch->'outbox' else '{}'::jsonb end;

  FOR v_outbox_item IN SELECT key, value FROM jsonb_each(v_outbox) LOOP
    IF coalesce(v_outbox_item.value->>'status', '') IN ('sending', 'uncertain', 'dispatch_uncertain', 'pending') THEN
      v_outbox := jsonb_set(v_outbox, ARRAY[v_outbox_item.key, 'status'], '"failed"'::jsonb);
      v_cleaned_count := v_cleaned_count + 1;
    END IF;
  END LOOP;

  IF v_cleaned_count > 0 THEN
    v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
    UPDATE public.instagram_conversations SET stage_completed_rules = v_rules, updated_at = v_now WHERE id = p_conversation_id;
  END IF;

  -- === VERIFICAÇÕES DE SEGURANÇA (pós-limpeza) ===
  
  perform 1 from public.whatsapp2_delivery_queue 
  where conversation_id = p_conversation_id and status in ('pending','sending','uncertain') 
  for update;

  select exists(select 1 from public.brain_decision_actions a where a.conversation_id = p_conversation_id and a.status in ('sending', 'dispatch_uncertain')) into v_blocked;
  if v_blocked then return jsonb_build_object('success', false, 'reason', 'delivery_in_flight'); end if;

  select exists(select 1 from public.whatsapp2_delivery_queue q where q.conversation_id = p_conversation_id and q.status in ('sending', 'uncertain')) into v_blocked;
  if v_blocked then return jsonb_build_object('success', false, 'reason', 'whatsapp_delivery_uncertain'); end if;

  for v_outbox_item in select key, value from jsonb_each(v_outbox) loop
    if coalesce(v_outbox_item.value->>'status', '') in ('sending', 'uncertain', 'dispatch_uncertain') then
      return jsonb_build_object('success', false, 'reason', 'outbox_delivery_uncertain', 'outboxKey', v_outbox_item.key);
    end if;
  end loop;

  -- === LÓGICA DE REINÍCIO ===

  -- Buscar última mensagem inbound sem resposta
  select m.id, coalesce(m.timestamp, m.created_at) into v_latest_inbound_id, v_latest_inbound_at
  from public.instagram_messages m
  where m.conversation_id = p_conversation_id 
    and coalesce(m.is_mine, false) = false 
    and coalesce(m.sender_id, '') <> 'me'
  order by coalesce(m.timestamp, m.created_at) desc, m.created_at desc, m.id desc limit 1;

  select max(coalesce(m.timestamp, m.created_at)) into v_latest_outbound_at
  from public.instagram_messages m
  where m.conversation_id = p_conversation_id 
    and (coalesce(m.is_mine, false) = true or coalesce(m.sender_id, '') = 'me');

  if v_latest_inbound_id is not null and v_latest_outbound_at is not null and v_latest_inbound_at <= v_latest_outbound_at then
    v_latest_inbound_id := null;
  end if;

  -- Cancelar ações pendentes restantes
  update public.brain_decision_actions set status = 'cancelled', updated_at = v_now
  where conversation_id = p_conversation_id and status in ('pending', 'waiting_delay', 'failed_retryable');

  for v_outbox_item in select key, value from jsonb_each(v_outbox) loop
    if coalesce(v_outbox_item.value->>'status', '') in ('pending', 'waiting_delay', 'failed_retryable') then
      v_outbox := jsonb_set(v_outbox, ARRAY[v_outbox_item.key, 'status'], '"cancelled"'::jsonb);
    end if;
  end loop;

  -- Se houver mensagem para reprocessar, desbloquear o ledger e o lastProcessedMessageId
  if v_latest_inbound_id is not null then
    if jsonb_typeof(v_orch->'messageLedger') = 'object' then
      v_orch := jsonb_set(v_orch, '{messageLedger}', (v_orch->'messageLedger') - v_latest_inbound_id);
    end if;
    v_orch := v_orch || jsonb_build_object('lastProcessedMessageId', null);
  end if;

  -- Persistir estado final limpo em instagram_conversations
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
  v_rules := jsonb_set(v_rules, '{active_cycle_token}', 'null'::jsonb);
  v_rules := jsonb_set(v_rules, '{status}', '"idle"'::jsonb);

  update public.instagram_conversations set stage_completed_rules = v_rules, updated_at = v_now where id = p_conversation_id;

  -- Limpar pendingOutboundMessages na tabela autopilot_chat_states
  update public.autopilot_chat_states
  set state = jsonb_set(case when jsonb_typeof(state) = 'object' then state else '{}'::jsonb end, '{pendingOutboundMessages}', '[]'::jsonb),
      updated_at = v_now
  where conversation_id = p_conversation_id;

  return jsonb_build_object('success', true, 'retryMessageId', v_latest_inbound_id, 'autoHealedCount', v_cleaned_count);
end;
$function$;

REVOKE ALL ON FUNCTION public.restart_autopilot_runtime_atomic(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restart_autopilot_runtime_atomic(text) TO service_role;
