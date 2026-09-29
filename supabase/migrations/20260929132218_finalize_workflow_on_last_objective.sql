-- Finaliza a conversa atomicamente quando o último objetivo obrigatório
-- da última etapa é concluído pelo Brain.
-- A resposta/outbox já persistida continua entregável, mas nenhuma nova inferência
-- automática é permitida após o commit final.

create or replace function public.commit_experimental_cycle_if_owned(
  p_conversation_id text,
  p_cycle_token text,
  p_new_stage_completed_rules jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
  v_active_token text;
  v_preempt_requested boolean;
  v_final_rules jsonb;
  v_next_stage_id text;
  v_workflow_finalized boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  select stage_completed_rules, current_stage_id
    into v_rules, v_next_stage_id
    from public.instagram_conversations
   where id = p_conversation_id
   for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'not_found');
  end if;

  v_rules := case when jsonb_typeof(v_rules) = 'object' then v_rules else '{}'::jsonb end;
  v_active_token := v_rules->>'active_cycle_token';
  v_preempt_requested := coalesce((v_rules->>'preempt_requested')::boolean, false);

  if v_active_token is null or v_active_token <> p_cycle_token then
    return jsonb_build_object('committed', false, 'reason', 'lost_lock', 'activeToken', v_active_token);
  end if;
  if v_preempt_requested is true then
    return jsonb_build_object('committed', false, 'reason', 'preempted');
  end if;

  v_final_rules := jsonb_set(coalesce(p_new_stage_completed_rules, '{}'::jsonb), '{active_cycle_token}', 'null'::jsonb);
  v_final_rules := jsonb_set(v_final_rules, '{preempt_requested}', 'false'::jsonb);
  v_next_stage_id := coalesce(v_final_rules->'orchestration'->>'currentStageId', v_next_stage_id);

  begin
    v_workflow_finalized :=
      coalesce((v_final_rules->>'workflow_finalized')::boolean, false)
      or coalesce((v_final_rules->'chat_progress'->>'isConverted')::boolean, false);
  exception when others then
    v_workflow_finalized := false;
  end;

  update public.instagram_conversations
     set stage_completed_rules = v_final_rules,
         current_stage_id = v_next_stage_id,
         ai_auto_respond = case when v_workflow_finalized then false else ai_auto_respond end,
         ai_debounce_until = case when v_workflow_finalized then null else ai_debounce_until end,
         is_converted = case when v_workflow_finalized then true else is_converted end,
         updated_at = v_now
   where id = p_conversation_id;

  if v_workflow_finalized then
    insert into public.autopilot_chat_states (
      conversation_id,
      is_enabled,
      status,
      state,
      state_revision,
      state_updated_at,
      updated_at
    )
    values (
      p_conversation_id,
      false,
      'disabled',
      jsonb_build_object(
        'status', 'disabled',
        'workflowFinalized', true,
        'finalizedAt', coalesce(v_final_rules->>'finalized_at', v_now::text)
      ),
      1,
      v_now,
      v_now
    )
    on conflict (conversation_id) do update
       set is_enabled = false,
           status = 'disabled',
           state = jsonb_set(
             jsonb_set(
               coalesce(public.autopilot_chat_states.state, '{}'::jsonb),
               '{status}',
               '"disabled"'::jsonb,
               true
             ),
             '{workflowFinalized}',
             'true'::jsonb,
             true
           ),
           state_revision = public.autopilot_chat_states.state_revision + 1,
           state_updated_at = v_now,
           updated_at = v_now;
  end if;

  return jsonb_build_object(
    'committed', true,
    'reason', 'committed',
    'workflowFinalized', v_workflow_finalized
  );
end;
$$;

revoke all on function public.commit_experimental_cycle_if_owned(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_experimental_cycle_if_owned(text, text, jsonb)
  to service_role;
