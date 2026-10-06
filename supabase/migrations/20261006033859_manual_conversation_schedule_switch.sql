
create or replace function public.set_conversation_schedule_atomic(
  p_conversation_id text,
  p_schedule_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.instagram_conversations%rowtype;
  v_target_schedule public.conversation_schedules%rowtype;
  v_target_stage public.chat_stages%rowtype;
  v_active_run public.conversation_schedule_runs%rowtype;
  v_new_run public.conversation_schedule_runs%rowtype;
  v_rules jsonb;
  v_orch jsonb;
  v_chat_progress jsonb;
  v_now timestamptz := clock_timestamp();
begin
  select *
    into v_conv
    from public.instagram_conversations
   where id = p_conversation_id
      or contact_id = p_conversation_id
   limit 1
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  select *
    into v_target_schedule
    from public.conversation_schedules
   where id = p_schedule_id
     and is_active = true
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'schedule_not_found_or_inactive');
  end if;

  select *
    into v_target_stage
    from public.chat_stages
   where schedule_id = v_target_schedule.id
   order by stage_order asc, created_at asc, id asc
   limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'reason', 'schedule_has_no_stage',
      'schedule_id', v_target_schedule.id
    );
  end if;

  select *
    into v_active_run
    from public.conversation_schedule_runs
   where conversation_id = v_conv.id
     and status = 'active'
   order by started_at desc, created_at desc
   limit 1
   for update;

  if found and v_active_run.schedule_id = v_target_schedule.id then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'reason', 'schedule_already_active',
      'schedule_id', v_target_schedule.id,
      'schedule_name', v_target_schedule.name,
      'run_id', v_active_run.id,
      'stage_id', coalesce(v_active_run.current_stage_id, v_conv.current_stage_id)
    );
  end if;

  if found then
    update public.conversation_schedule_runs
       set status = 'cancelled',
           completed_at = v_now,
           updated_at = v_now
     where id = v_active_run.id;
  end if;

  insert into public.conversation_schedule_runs (
    conversation_id,
    schedule_id,
    status,
    started_at,
    expires_at,
    current_stage_id
  ) values (
    v_conv.id,
    v_target_schedule.id,
    'active',
    v_now,
    case
      when v_target_schedule.duration_minutes is null then null
      else v_now + make_interval(mins => v_target_schedule.duration_minutes)
    end,
    v_target_stage.id
  )
  returning * into v_new_run;

  v_rules := case
    when jsonb_typeof(v_conv.stage_completed_rules) = 'object'
      then v_conv.stage_completed_rules
    else '{}'::jsonb
  end;

  v_orch := case
    when jsonb_typeof(v_rules->'orchestration') = 'object'
      then v_rules->'orchestration'
    else '{}'::jsonb
  end;

  v_chat_progress := case
    when jsonb_typeof(v_rules->'chat_progress') = 'object'
      then v_rules->'chat_progress'
    else '{}'::jsonb
  end;

  -- Troca manual inicia o cronograma escolhido do zero, sem apagar memória nem conversão.
  v_orch := jsonb_set(v_orch, '{currentStageId}', to_jsonb(v_target_stage.id), true);
  v_orch := jsonb_set(v_orch, '{currentPhase}', to_jsonb(v_target_stage.id), true);
  v_orch := jsonb_set(v_orch, '{completedGoalIds}', '[]'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{objectiveProgress}', '{}'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{workflowFinalized}', 'false'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{workflowCompletedAt}', 'null'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{lastError}', 'null'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{isConverted}', to_jsonb(coalesce(v_conv.is_converted, false)), true);

  v_chat_progress := jsonb_set(v_chat_progress, '{currentStageId}', to_jsonb(v_target_stage.id), true);
  v_chat_progress := jsonb_set(v_chat_progress, '{completedGoalIds}', '[]'::jsonb, true);
  v_chat_progress := jsonb_set(v_chat_progress, '{completedItemIds}', '[]'::jsonb, true);
  v_chat_progress := jsonb_set(v_chat_progress, '{objectiveProgress}', '{}'::jsonb, true);
  v_chat_progress := jsonb_set(v_chat_progress, '{isConverted}', to_jsonb(coalesce(v_conv.is_converted, false)), true);
  v_chat_progress := jsonb_set(v_chat_progress, '{updatedAt}', to_jsonb(v_now::text), true);

  v_rules := jsonb_set(v_rules, '{status}', '"active"'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{current_stage_id}', to_jsonb(v_target_stage.id), true);
  v_rules := jsonb_set(v_rules, '{completed_goals}', '[]'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{objective_progress}', '{}'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{workflow_finalized}', 'false'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{finalized_at}', 'null'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{finalized_reason}', '"manual_schedule_switch"'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{current_schedule_id}', to_jsonb(v_target_schedule.id), true);
  v_rules := jsonb_set(v_rules, '{current_schedule_run_id}', to_jsonb(v_new_run.id::text), true);
  v_rules := jsonb_set(v_rules, '{schedule_status}', '"active"'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{schedule_completed_at}', 'null'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{schedule_manual_switched_at}', to_jsonb(v_now::text), true);
  v_rules := jsonb_set(
    v_rules,
    '{schedule_manual_switched_from}',
    case
      when v_active_run.id is null then 'null'::jsonb
      else to_jsonb(v_active_run.schedule_id)
    end,
    true
  );
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
  v_rules := jsonb_set(v_rules, '{chat_progress}', v_chat_progress, true);

  update public.instagram_conversations
     set current_stage_id = v_target_stage.id,
         stage_completed_rules = v_rules,
         ai_debounce_started_at = null,
         ai_debounce_until = null,
         updated_at = v_now
   where id = v_conv.id;

  update public.autopilot_chat_states
     set status = case when is_enabled then 'idle' else status end,
         state = (coalesce(state, '{}'::jsonb)
           || jsonb_build_object(
                'currentScheduleId', v_target_schedule.id,
                'currentStageId', v_target_stage.id,
                'manualScheduleSwitchAt', v_now
              )) - 'scheduledResponseAt',
         state_revision = state_revision + 1,
         state_updated_at = v_now,
         updated_at = v_now
   where conversation_id = v_conv.id;

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'conversation_id', v_conv.id,
    'previous_schedule_id', case when v_active_run.id is null then null else v_active_run.schedule_id end,
    'schedule_id', v_target_schedule.id,
    'schedule_name', v_target_schedule.name,
    'run_id', v_new_run.id,
    'stage_id', v_target_stage.id,
    'stage_name', v_target_stage.name,
    'started_at', v_new_run.started_at,
    'expires_at', v_new_run.expires_at
  );
end;
$$;

revoke all on function public.set_conversation_schedule_atomic(text, text)
  from public, anon, authenticated;
grant execute on function public.set_conversation_schedule_atomic(text, text)
  to service_role;
