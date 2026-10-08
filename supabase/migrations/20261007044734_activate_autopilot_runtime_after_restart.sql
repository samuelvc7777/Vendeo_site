-- Reativa somente o estado operacional depois de um reinício explícito.
-- Preserva activation_watermark para que a inbound reaberta pelo restart RPC
-- continue elegível quando o worker processar a fila.
create or replace function public.activate_autopilot_runtime_after_restart_atomic(
  p_conversation_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
  v_ai_auto_respond boolean;
  v_previous_status text;
  v_updated_at timestamptz;
begin
  select stage_completed_rules, coalesce(ai_auto_respond, false)
    into v_rules, v_ai_auto_respond
    from public.instagram_conversations
    where id = p_conversation_id
    for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  if not v_ai_auto_respond then
    return jsonb_build_object('success', false, 'reason', 'autopilot_disabled');
  end if;

  v_rules := case
    when jsonb_typeof(v_rules) = 'object' then v_rules
    else '{}'::jsonb
  end;
  v_previous_status := coalesce(v_rules->>'status', '');

  if v_previous_status in (
    'paused_manual',
    'paused_handoff',
    'paused_guardrail',
    'waiting_human',
    'disabled',
    'cancelled'
  ) then
    v_rules := jsonb_set(v_rules, '{status}', '"active"'::jsonb, true);
  end if;

  update public.instagram_conversations
     set stage_completed_rules = v_rules,
         updated_at = clock_timestamp()
   where id = p_conversation_id
   returning updated_at into v_updated_at;

  return jsonb_build_object(
    'success', true,
    'conversationId', p_conversation_id,
    'previousStatus', v_previous_status,
    'status', coalesce(v_rules->>'status', ''),
    'updatedAt', v_updated_at
  );
end;
$$;

revoke all on function public.activate_autopilot_runtime_after_restart_atomic(text)
  from public, anon, authenticated;
grant execute on function public.activate_autopilot_runtime_after_restart_atomic(text)
  to service_role;
