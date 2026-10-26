-- Auto-heal: limpa resíduos de entrega travada antes de bloquear o restart
-- Isso resolve o erro 409 "Existe uma entrega em andamento ou ambígua" causado por
-- reconexões do Cloudflare/WhatsApp que deixam itens órfãos em status sending/uncertain

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
  v_latest_revision integer;
  v_now timestamptz := clock_timestamp();
  v_blocked boolean := false;
  v_schedule_status text;
  v_cleaned_count integer := 0;
begin
  select stage_completed_rules
    into v_rules
    from public.instagram_conversations
    where id = p_conversation_id
    for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'reason', 'conversation_not_found'
    );
  end if;

  if v_rules is null or jsonb_typeof(v_rules) <> 'object' then
    v_rules := '{}'::jsonb;
  end if;

  v_schedule_status := coalesce(v_rules->>'schedule_status', '');
  if v_schedule_status = 'completed_waiting_manual' then
    return jsonb_build_object(
      'success', false,
      'reason', 'schedule_completed_waiting_manual'
    );
  end if;

  -- === AUTO-HEAL: Limpar resíduos de entrega travada ANTES de verificar bloqueios ===
  
  -- 1. Limpar brain_decision_actions com status sending/dispatch_uncertain
  -- (itens órfãos de workers que morreram durante reconexão)
  UPDATE public.brain_decision_actions
     SET status = 'cancelled',
         updated_at = v_now
   WHERE conversation_id = p_conversation_id
     AND status IN ('sending', 'dispatch_uncertain');
  
  GET DIAGNOSTICS v_cleaned_count = ROW_COUNT;
  IF v_cleaned_count > 0 THEN
    RAISE NOTICE '[Auto-Heal] Limpadas % ações do Brain travadas', v_cleaned_count;
  END IF;

  -- 2. Limpar whatsapp2_delivery_queue com status sending/uncertain
  -- (mensagens que ficaram presas na fila durante a queda de conexão)
  UPDATE public.whatsapp2_delivery_queue
     SET status = 'failed',
         last_error = 'auto_healed_on_restart',
         completed_at = v_now,
         updated_at = v_now
   WHERE conversation_id = p_conversation_id
     AND status IN ('sending', 'uncertain');
  
  GET DIAGNOSTICS v_cleaned_count = ROW_COUNT;
  IF v_cleaned_count > 0 THEN
    RAISE NOTICE '[Auto-Heal] Limpados % itens da fila de entrega travados', v_cleaned_count;
  END IF;

  -- 3. Limpar orchestration.outbox no JSONB stage_completed_rules
  -- (resíduos de outbox interno que bloqueiam o restart)
  v_orch := case
    when jsonb_typeof(v_rules->'orchestration') = 'object'
      then v_rules->'orchestration'
    else '{}'::jsonb
  end;

  v_outbox := case
    when jsonb_typeof(v_orch->'outbox') = 'object'
      then v_orch->'outbox'
    else '{}'::jsonb
  end;

  -- Verificar se há itens sujos no outbox e limpá-los
  FOR v_outbox_item IN
    SELECT key, value
    FROM jsonb_each(v_outbox)
  LOOP
    IF coalesce(v_outbox_item.value->>'status', '') IN ('sending', 'uncertain', 'dispatch_uncertain', 'pending') THEN
      -- Marcar como failed para permitir o restart
      v_outbox := jsonb_set(
        v_outbox,
        ARRAY[v_outbox_item.key, 'status'],
        '"failed"'::jsonb
      );
      v_outbox := jsonb_set(
        v_outbox,
        ARRAY[v_outbox_item.key, 'lastError'],
        '"auto_healed_on_restart"'::jsonb
      );
      v_cleaned_count := v_cleaned_count + 1;
    END IF;
  END LOOP;

  IF v_cleaned_count > 0 THEN
    -- Atualizar o JSONB com o outbox limpo
    v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);
    
    UPDATE public.instagram_conversations
       SET stage_completed_rules = v_rules,
           updated_at = v_now
     WHERE id = p_conversation_id;
    
    RAISE NOTICE '[Auto-Heal] Limpados % itens do outbox JSONB', v_cleaned_count;
  END IF;

  -- === FIM DO AUTO-HEAL ===

  -- Serializa a reserva do gateway com o cancelamento de pendências antigas.
  perform 1 from public.whatsapp2_delivery_queue
   where conversation_id = p_conversation_id and status in ('pending','sending','uncertain')
   for update;

  -- Agora verifica se ainda há bloqueios (deveria estar limpo após auto-heal)
  select exists(
    select 1
    from public.brain_decision_actions a
    where a.conversation_id = p_conversation_id
      and a.status in ('sending', 'dispatch_uncertain')
  ) into v_blocked;

  if v_blocked then
    return jsonb_build_object(
      'success', false,
      'reason', 'delivery_in_flight'
    );
  end if;

  select exists(
    select 1
    from public.whatsapp2_delivery_queue q
    where q.conversation_id = p_conversation_id
      and q.status in ('sending', 'uncertain')
  ) into v_blocked;

  if v_blocked then
    return jsonb_build_object(
      'success', false,
      'reason', 'whatsapp_delivery_uncertain'
    );
  end if;

  -- Verificação final do outbox JSONB (já deveria estar limpo)
  for v_outbox_item in
    select key, value
    from jsonb_each(v_outbox)
  loop
    if coalesce(v_outbox_item.value->>'status', '') in ('sending', 'uncertain', 'dispatch_uncertain') then
      return jsonb_build_object(
        'success', false,
        'reason', 'outbox_delivery_uncertain',
        'outboxKey', v_outbox_item.key
      );
    end if;
  end loop;

  -- Última entrada canônica do cliente.
  select
    m.id,
    coalesce(m.timestamp, m.created_at)
  into
    v_latest_inbound_id,
    v_latest_inbound_at
  from public.instagram_messages m
  where m.conversation_id = p_conversation_id
    and coalesce(m.is_mine, false) = false
    and coalesce(m.sender_id, '') <> 'me'
  order by coalesce(m.timestamp, m.created_at) desc, m.created_at desc, m.id desc
  limit 1;

  -- Última saída canônica confirmada.
  select max(coalesce(m.timestamp, m.created_at))
    into v_latest_outbound_at
  from public.instagram_messages m
  where m.conversation_id = p_conversation_id
    and (
      coalesce(m.is_mine, false) = true
      or coalesce(m.sender_id, '') = 'me'
    );

  if v_latest_inbound_id is not null
     and v_latest_outbound_at is not null
     and v_latest_inbound_at <= v_latest_outbound_at
  then
    v_latest_inbound_id := null;
  end if;

  -- Cancela apenas ações que comprovadamente ainda não foram enviadas.
  update public.brain_decision_actions
     set status = 'cancelled',
         updated_at = v_now
   where conversation_id = p_conversation_id
     and status in ('pending', 'waiting_delay', 'failed_retryable');

  -- Marca como canceladas também as cópias antigas do outbox JSON.
  for v_outbox_item in
    select key, value
    from jsonb_each(v_outbox)
  loop
    if coalesce(v_outbox_item.value->>'status', '') in ('pending', 'waiting_delay', 'failed_retryable') then
      v_outbox := jsonb_set(
        v_outbox,
        ARRAY[v_outbox_item.key, 'status'],
        '"cancelled"'::jsonb
      );
    end if;
  end loop;

  -- Persistir outbox atualizado
  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  -- Limpar active_cycle_token e resetar status para idle
  v_rules := jsonb_set(v_rules, '{active_cycle_token}', 'null'::jsonb);
  v_rules := jsonb_set(v_rules, '{status}', '"idle"'::jsonb);

  update public.instagram_conversations
     set stage_completed_rules = v_rules,
         updated_at = v_now
   where id = p_conversation_id;

  return jsonb_build_object(
    'success', true,
    'retryMessageId', v_latest_inbound_id,
    'autoHealedCount', v_cleaned_count
  );
end;
$function$;

-- Manter permissões existentes
REVOKE ALL ON FUNCTION public.restart_autopilot_runtime_atomic(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restart_autopilot_runtime_atomic(text) TO service_role;