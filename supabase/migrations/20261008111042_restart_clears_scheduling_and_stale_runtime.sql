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

  -- Serializa a reserva do gateway com o cancelamento de pendências antigas.
  perform 1 from public.whatsapp2_delivery_queue
   where conversation_id = p_conversation_id and status in ('pending','sending','uncertain')
   for update;

  -- Não reinicia se já existe envio em estado ambíguo/ativo.
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

  -- Uma saída ambígua no outbox também bloqueia o reset.
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
        array[v_outbox_item.key],
        v_outbox_item.value || jsonb_build_object(
          'status', 'cancelled',
          'cancelledAt', v_now::text,
          'cancelReason', 'operator_ai_restart'
        ),
        true
      );
    end if;
  end loop;

  v_orch := jsonb_set(v_orch, '{outbox}', v_outbox, true);

  -- Encerra o runtime antigo sem remover decisões, fatos ou IDs confirmados.
  update public.brain_turns
     set status = 'completed',
         completed_at = v_now,
         updated_at = v_now,
         version = version + 1,
         lease_expires_at = null,
         recovery_lease_token = null,
         recovery_lease_expires_at = null,
         runtime_metadata = coalesce(runtime_metadata, '{}'::jsonb) ||
           jsonb_build_object('administrativeClosure', true, 'closureReason', 'operator_ai_restart', 'closedAt', v_now)
   where conversation_id = p_conversation_id
     and status in ('collecting','brain_running','waiting_manual','brain_late','failed_technical');

  -- Pendências de delivery só podem ser canceladas antes de serem reservadas.
  update public.whatsapp2_delivery_queue q
     set status = 'failed', last_error = 'operator_ai_restart_cancelled_before_send',
         completed_at = v_now, updated_at = v_now
   where q.conversation_id = p_conversation_id and q.status = 'pending'
     and exists(select 1 from public.brain_decision_actions a
       where a.conversation_id = p_conversation_id and a.idempotency_key = q.id
         and a.status = 'cancelled');

    -- Limpa apenas runtime transitório do Brain.
  v_orch := v_orch
    - 'activeCycle'
    - 'lastError'
    - 'technicalRetryCount'
    - 'technicalRetryExhaustedAt'
    - 'lastProcessingStatus'
    - 'lastCorrelationId'
    - 'openai_session_id'
    - 'openai_session_kind'
    - 'persistent_session_version'
    - 'activeClaimedMessageIds'
    - 'preemptRequested'
    - 'manualRetryAttempt'
    - 'manualRetryCycleId'
    - 'manualRetryAuthorizedAt';

  v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', '"idle"'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{lastError}', 'null'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{restartRequestedAt}', to_jsonb(v_now::text), true);

  v_orch := v_orch || jsonb_build_object('technicalRetryCount', 0, 'activeClaimedMessageIds', '[]'::jsonb, 'preemptRequested', false);
  v_orch := jsonb_set(v_orch, '{recentCycles}', coalesce((
    select jsonb_agg(item) from jsonb_array_elements(
      case when jsonb_typeof(v_orch->'recentCycles')='array' then v_orch->'recentCycles' else '[]'::jsonb end
    ) item where coalesce(item->>'status','') not in ('failed','running')
  ), '[]'::jsonb), true);

  -- Reabre somente a última entrada realmente sem resposta.
  if v_latest_inbound_id is not null then
    v_orch := jsonb_set(
      v_orch,
      array['messageLedger', v_latest_inbound_id],
      '"pending"'::jsonb,
      true
    );

    begin
      v_latest_revision := (v_orch->'messageInboundRevisions'->>v_latest_inbound_id)::integer;
    exception when others then
      v_latest_revision := null;
    end;

    if v_latest_revision is not null then
      v_orch := jsonb_set(
        v_orch,
        '{activation_watermark,inboundRevision}',
        to_jsonb(greatest(v_latest_revision - 1, 0)),
        true
      );
    else
      v_orch := v_orch - 'activation_watermark';
    end if;


  end if;

  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
  v_rules := v_rules
    - 'active_cycle_token'
    - 'active_cycle_at'
    - 'cancel_current_cycle'
    - 'preempt_requested'
    - 'send_immediately'
    - 'pause_reason'
    - 'openai_session_id'
    - 'openai_session_kind'
    - 'persistent_session_version';

  -- Remove jobs velhos para a nova execução nascer limpa.
  delete from public.autopilot_inbound_jobs
   where conversation_id = p_conversation_id;

  -- Invalida a Conversation persistente antiga e os receipts técnicos.
  update public.openai_conversation_links
     set status = 'closed',
         bootstrap_status = 'pending',
         bootstrapped_at = null,
         bootstrap_message_count = 0,
         bootstrap_last_error = null,
         last_error = 'operator_ai_restart',
         updated_at = v_now
   where conversation_id = p_conversation_id;

  delete from public.openai_message_receipts
   where conversation_id = p_conversation_id;

  update public.instagram_conversations
     set stage_completed_rules = v_rules,
         ai_auto_respond = true,
         ai_debounce_started_at = null,
         ai_debounce_until = null,
         updated_at = v_now
   where id = p_conversation_id;

  insert into public.autopilot_chat_states (
    conversation_id,
    is_enabled,
    status,
    state,
    state_revision,
    state_updated_at,
    updated_at
  ) values (
    p_conversation_id,
    true,
    case when v_latest_inbound_id is null then 'idle' else 'starting' end,
    jsonb_build_object(
      'status', case when v_latest_inbound_id is null then 'idle' else 'starting' end,
      'restartRequestedAt', v_now::text,
      'restartReason', 'operator_ai_restart',
      'retryMessageId', v_latest_inbound_id
    ),
    1,
    v_now,
    v_now
  )
  on conflict (conversation_id) do update
     set is_enabled = true,
         status = excluded.status,
         state = (
           coalesce(public.autopilot_chat_states.state, '{}'::jsonb)
           - 'pauseReason'
           - 'scheduledResponseAt'
           - 'cycleId'
           - 'activity'
           - 'pendingAction'
           - 'pendingOutboundMessages'
           - 'manualResolution'
         ) || excluded.state || jsonb_build_object(
           'scheduledResponseAt', null, 'pendingAction', null,
           'pendingOutboundMessages', '[]'::jsonb, 'pauseReason', null,
           'pausedAt', null, 'cycleId', null, 'activity', null
         ),
         state_revision = public.autopilot_chat_states.state_revision + 1,
         state_updated_at = v_now,
         updated_at = v_now;

  return jsonb_build_object(
    'success', true,
    'conversationId', p_conversation_id,
    'retryMessageId', v_latest_inbound_id,
    'status', case when v_latest_inbound_id is null then 'idle' else 'starting' end,
    'rebuildOpenAiConversation', true
  );
end;
$function$
