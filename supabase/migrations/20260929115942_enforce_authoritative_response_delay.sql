-- Gate autoritativo do tempo de resposta do AutoPilot.
-- Nenhum ciclo automático pode iniciar antes do quiet period configurado,
-- mesmo quando ai_debounce_until estiver nulo ou uma rota de ingestão não o agendar.

create or replace function public.enforce_autopilot_response_delay_atomic(
  p_conversation_id text,
  p_quiet_seconds integer,
  p_max_window_seconds integer,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
  v_orch jsonb;
  v_quiet_seconds integer := greatest(coalesce(p_quiet_seconds, 0), 0);
  v_max_seconds integer := greatest(coalesce(p_max_window_seconds, p_quiet_seconds, 0), greatest(coalesce(p_quiet_seconds, 0), 0));
  v_watermark_rev bigint;
  v_first_pending timestamptz;
  v_last_pending timestamptz;
  v_desired_at timestamptz;
  v_cap_at timestamptz;
  v_scheduled_at timestamptz;
begin
  select c.stage_completed_rules
    into v_rules
    from public.instagram_conversations c
   where c.id = p_conversation_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  v_rules := case when jsonb_typeof(v_rules) = 'object' then v_rules else '{}'::jsonb end;
  v_orch := case
    when jsonb_typeof(v_rules->'orchestration') = 'object' then v_rules->'orchestration'
    else '{}'::jsonb
  end;

  begin
    if coalesce(v_orch->'activation_watermark'->>'inboundRevision', '') ~ '^[0-9]+$' then
      v_watermark_rev := (v_orch->'activation_watermark'->>'inboundRevision')::bigint;
    end if;
  exception when others then
    v_watermark_rev := null;
  end;

  select min(m.created_at), max(m.created_at)
    into v_first_pending, v_last_pending
    from public.instagram_messages m
   where m.conversation_id = p_conversation_id
     and m.is_mine is false
     and m.created_at >= p_now - interval '48 hours'
     and coalesce(v_orch->'messageLedger'->>m.id, 'pending') <> 'processed'
     and coalesce(v_orch->>'lastProcessedMessageId', '') <> m.id
     and (
       v_watermark_rev is null
       or (
         coalesce(v_orch->'messageInboundRevisions'->>m.id, '') ~ '^[0-9]+$'
         and (v_orch->'messageInboundRevisions'->>m.id)::bigint > v_watermark_rev
       )
     );
  if v_first_pending is null or v_last_pending is null or v_quiet_seconds = 0 then
    return jsonb_build_object(
      'success', true,
      'due_now', true,
      'reason', case when v_quiet_seconds = 0 then 'delay_disabled' else 'no_pending_inbound' end
    );
  end if;

  v_desired_at := v_last_pending + make_interval(secs => v_quiet_seconds);
  v_cap_at := v_first_pending + make_interval(secs => v_max_seconds);
  v_scheduled_at := least(v_desired_at, v_cap_at);

  if v_scheduled_at > p_now then
    update public.instagram_conversations
       set ai_debounce_started_at = v_first_pending,
           ai_debounce_until = v_scheduled_at
     where id = p_conversation_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'due_now', v_scheduled_at <= p_now,
    'scheduled_at', v_scheduled_at,
    'first_pending_at', v_first_pending,
    'last_pending_at', v_last_pending,
    'quiet_seconds', v_quiet_seconds,
    'max_window_seconds', v_max_seconds,
    'capped', v_desired_at > v_cap_at
  );
end;
$$;
revoke all on function public.enforce_autopilot_response_delay_atomic(text, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.enforce_autopilot_response_delay_atomic(text, integer, integer, timestamptz)
  to service_role;
