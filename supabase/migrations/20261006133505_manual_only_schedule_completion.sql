-- Cronogramas concluídos não iniciam mais o próximo automaticamente.
-- O cronograma atual fica concluído/pausado até uma troca manual explícita.
-- Se a IA estava ligada antes da conclusão, a troca manual restaura esse estado.

create or replace function public.enforce_manual_schedule_transition_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_schedule_status text := coalesce(old.stage_completed_rules->>'schedule_status', '');
  v_new_schedule_status text := coalesce(new.stage_completed_rules->>'schedule_status', '');
  v_resume_ai boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if v_new_schedule_status in ('ready_for_transition', 'completed_waiting_manual') then
    if v_old_schedule_status in ('ready_for_transition', 'completed_waiting_manual') then
      begin
        v_resume_ai := coalesce(
          (old.stage_completed_rules->>'schedule_resume_ai_after_manual_switch')::boolean,
          false
        );
      exception when others then
        v_resume_ai := false;
      end;
    else
      v_resume_ai := coalesce(new.ai_auto_respond, old.ai_auto_respond, false);
    end if;

    new.stage_completed_rules := jsonb_set(
      coalesce(new.stage_completed_rules, '{}'::jsonb),
      '{schedule_status}',
      '"completed_waiting_manual"'::jsonb,
      true
    );
    new.stage_completed_rules := jsonb_set(
      new.stage_completed_rules,
      '{status}',
      '"waiting_human"'::jsonb,
      true
    );
    new.stage_completed_rules := jsonb_set(
      new.stage_completed_rules,
      '{workflow_finalized}',
      'false'::jsonb,
      true
    );
    new.stage_completed_rules := jsonb_set(
      new.stage_completed_rules,
      '{finalized_reason}',
      '"schedule_completed_waiting_manual_switch"'::jsonb,
      true
    );
    new.stage_completed_rules := jsonb_set(
      new.stage_completed_rules,
      '{schedule_resume_ai_after_manual_switch}',
      to_jsonb(v_resume_ai),
      true
    );
    new.stage_completed_rules := jsonb_set(
      new.stage_completed_rules,
      '{pause_reason}',
      to_jsonb('Cronograma concluído. Escolha manualmente o próximo cronograma.'::text),
      true
    );

    new.ai_auto_respond := false;
    new.ai_debounce_started_at := null;
    new.ai_debounce_until := null;

    update public.conversation_schedule_runs
       set status = 'completed',
           completed_at = coalesce(completed_at, v_now),
           expires_at = null,
           updated_at = v_now
     where conversation_id = new.id
       and status = 'active';

    insert into public.autopilot_chat_states (
      conversation_id,
      is_enabled,
      status,
      state,
      state_revision,
      state_updated_at,
      updated_at
    ) values (
      new.id,
      false,
      'waiting_human',
      jsonb_build_object(
        'status', 'waiting_human',
        'pauseReason', 'Cronograma concluído. Escolha manualmente o próximo cronograma.',
        'currentScheduleId', new.stage_completed_rules->>'current_schedule_id',
        'scheduleCompletedWaitingManual', true
      ),
      1,
      v_now,
      v_now
    )
    on conflict (conversation_id) do update
       set is_enabled = false,
           status = 'waiting_human',
           state = coalesce(public.autopilot_chat_states.state, '{}'::jsonb)
             || jsonb_build_object(
                  'status', 'waiting_human',
                  'pauseReason', 'Cronograma concluído. Escolha manualmente o próximo cronograma.',
                  'currentScheduleId', new.stage_completed_rules->>'current_schedule_id',
                  'scheduleCompletedWaitingManual', true
                ),
           state_revision = public.autopilot_chat_states.state_revision + 1,
           state_updated_at = v_now,
           updated_at = v_now;

    return new;
  end if;

  if v_old_schedule_status in ('ready_for_transition', 'completed_waiting_manual')
     and v_new_schedule_status = 'active'
     and coalesce(new.stage_completed_rules->>'finalized_reason', '') = 'manual_schedule_switch'
  then
    begin
      v_resume_ai := coalesce(
        (old.stage_completed_rules->>'schedule_resume_ai_after_manual_switch')::boolean,
        false
      );
    exception when others then
      v_resume_ai := false;
    end;

    new.stage_completed_rules := new.stage_completed_rules
      - 'schedule_resume_ai_after_manual_switch'
      - 'pause_reason';

    if v_resume_ai then
      new.ai_auto_respond := true;
      new.ai_debounce_started_at := null;
      new.ai_debounce_until := null;

      insert into public.autopilot_chat_states (
        conversation_id,
        is_enabled,
        status,
        state,
        state_revision,
        state_updated_at,
        updated_at
      ) values (
        new.id,
        true,
        'idle',
        jsonb_build_object(
          'status', 'idle',
          'currentScheduleId', new.stage_completed_rules->>'current_schedule_id',
          'currentStageId', new.current_stage_id,
          'scheduleCompletedWaitingManual', false
        ),
        1,
        v_now,
        v_now
      )
      on conflict (conversation_id) do update
         set is_enabled = true,
             status = 'idle',
             state = (
               coalesce(public.autopilot_chat_states.state, '{}'::jsonb)
               || jsonb_build_object(
                    'status', 'idle',
                    'currentScheduleId', new.stage_completed_rules->>'current_schedule_id',
                    'currentStageId', new.current_stage_id,
                    'scheduleCompletedWaitingManual', false
                  )
             ) - 'pauseReason' - 'scheduledResponseAt',
             state_revision = public.autopilot_chat_states.state_revision + 1,
             state_updated_at = v_now,
             updated_at = v_now;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_manual_schedule_transition_policy
  on public.instagram_conversations;

create trigger trg_manual_schedule_transition_policy
before update of stage_completed_rules on public.instagram_conversations
for each row
execute function public.enforce_manual_schedule_transition_policy();

create or replace function public.advance_conversation_schedule_atomic(
  p_conversation_id text,
  p_expected_schedule_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'success', true,
    'advanced', false,
    'reason', 'manual_schedule_switch_required',
    'conversation_id', p_conversation_id,
    'schedule_id', p_expected_schedule_id
  );
end;
$$;

revoke all on function public.advance_conversation_schedule_atomic(text, text)
  from public, anon, authenticated;
grant execute on function public.advance_conversation_schedule_atomic(text, text)
  to service_role;

create or replace function public.process_conversation_schedule_ready_transitions_atomic(
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'success', true,
    'processed', 0,
    'advanced', 0,
    'conflicts', 0,
    'policy', 'manual_schedule_switch_only'
  );
end;
$$;

revoke all on function public.process_conversation_schedule_ready_transitions_atomic(integer)
  from public, anon, authenticated;
grant execute on function public.process_conversation_schedule_ready_transitions_atomic(integer)
  to service_role;
