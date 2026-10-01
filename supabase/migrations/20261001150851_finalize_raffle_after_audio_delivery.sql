-- Finaliza o workflow imediatamente após a entrega confirmada do objetivo final de rifa.
-- A projeção do Brain já chama patch_chat_progress_atomic somente depois que a ação está "sent".
-- Aqui o banco transforma essa conclusão delivery_confirmed em finalização canônica do chat.

update public.chat_stages s
set goals = (
  select jsonb_agg(
    case
      when goal->>'id' = 'goal_1790861876963_d8oti' then
        jsonb_set(
          goal,
          '{actionConfig}',
          coalesce(goal->'actionConfig', '{}'::jsonb)
            || jsonb_build_object('finalizeWorkflowOnCompletion', true),
          true
        )
      else goal
    end
    order by ord
  )
  from jsonb_array_elements(s.goals) with ordinality as g(goal, ord)
)
where s.id = 'stage_1790861775316_am5wy'
  and jsonb_typeof(s.goals) = 'array';

create or replace function public.patch_chat_progress_atomic(
  p_conversation_id text,
  p_current_stage_id text default null,
  p_completed_goal_ids text[] default null,
  p_completed_item_ids text[] default null,
  p_objective_progress jsonb default null,
  p_is_converted boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv_id text;
  v_rules jsonb;
  v_orch jsonb;
  v_chat_progress jsonb;
  v_current_stage_id text;
  v_effective_stage_id text;
  v_stage_order integer;
  v_max_stage_order integer;
  v_stage_goals jsonb;
  v_auto_finalize boolean := false;
  v_now_ts timestamptz := clock_timestamp();
  v_now text := v_now_ts::text;
begin
  select id, stage_completed_rules, current_stage_id
    into v_conv_id, v_rules, v_current_stage_id
    from public.instagram_conversations
   where id = p_conversation_id or contact_id = p_conversation_id
   limit 1
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  if v_rules is null or jsonb_typeof(v_rules) <> 'object' then
    v_rules := '{}'::jsonb;
  end if;

  v_orch := coalesce(v_rules->'orchestration', '{}'::jsonb);
  if jsonb_typeof(v_orch) <> 'object' then v_orch := '{}'::jsonb; end if;

  v_chat_progress := coalesce(v_rules->'chat_progress', '{}'::jsonb);
  if jsonb_typeof(v_chat_progress) <> 'object' then v_chat_progress := '{}'::jsonb; end if;

  if p_current_stage_id is not null and btrim(p_current_stage_id) <> '' then
    v_rules := jsonb_set(v_rules, '{current_stage_id}', to_jsonb(p_current_stage_id));
    v_chat_progress := jsonb_set(v_chat_progress, '{currentStageId}', to_jsonb(p_current_stage_id));
    v_orch := jsonb_set(v_orch, '{currentStageId}', to_jsonb(p_current_stage_id));
  end if;

  if p_completed_goal_ids is not null then
    v_rules := jsonb_set(v_rules, '{completed_goals}', to_jsonb(p_completed_goal_ids));
    v_chat_progress := jsonb_set(v_chat_progress, '{completedGoalIds}', to_jsonb(p_completed_goal_ids));
    v_orch := jsonb_set(v_orch, '{completedGoalIds}', to_jsonb(p_completed_goal_ids));
  end if;

  if p_completed_item_ids is not null then
    v_chat_progress := jsonb_set(v_chat_progress, '{completedItemIds}', to_jsonb(p_completed_item_ids));
  end if;

  if p_objective_progress is not null and jsonb_typeof(p_objective_progress) = 'object' then
    v_rules := jsonb_set(v_rules, '{objective_progress}', p_objective_progress);
    v_chat_progress := jsonb_set(v_chat_progress, '{objectiveProgress}', p_objective_progress);
    v_orch := jsonb_set(v_orch, '{objectiveProgress}', p_objective_progress);
  end if;

  if p_is_converted is not null then
    v_chat_progress := jsonb_set(v_chat_progress, '{isConverted}', to_jsonb(p_is_converted));
    v_orch := jsonb_set(v_orch, '{isConverted}', to_jsonb(p_is_converted));
  end if;

  v_effective_stage_id := coalesce(nullif(btrim(p_current_stage_id), ''), v_current_stage_id);

  select s.stage_order, s.goals
    into v_stage_order, v_stage_goals
    from public.chat_stages s
   where s.id = v_effective_stage_id
   limit 1;

  select max(stage_order) into v_max_stage_order from public.chat_stages;

  if p_is_converted is distinct from false
     and v_stage_order is not null
     and v_stage_order = v_max_stage_order
     and jsonb_typeof(v_stage_goals) = 'array'
  then
    select
      not exists (
        select 1
          from jsonb_array_elements(v_stage_goals) as g(goal)
         where coalesce(g.goal->>'enabled', 'true') <> 'false'
           and coalesce(g.goal->>'required', 'true') <> 'false'
           and (
             coalesce(g.goal->'actionConfig'->>'finalizeWorkflowOnCompletion', 'true') = 'false'
             or not (
               exists (
                 select 1
                   from jsonb_array_elements_text(
                     case
                       when jsonb_typeof(v_rules->'completed_goals') = 'array'
                         then v_rules->'completed_goals'
                       else '[]'::jsonb
                     end
                   ) as cg(goal_id)
                  where cg.goal_id = g.goal->>'id'
               )
               or coalesce(v_rules->'objective_progress'->(g.goal->>'id')->>'status', '') = 'completed'
             )
           )
      )
      and exists (
        select 1
          from jsonb_array_elements(v_stage_goals) as g(goal)
         where coalesce(g.goal->>'enabled', 'true') <> 'false'
           and coalesce(g.goal->>'required', 'true') <> 'false'
           and coalesce(g.goal->>'completionPolicy', '') = 'delivery_confirmed'
           and coalesce(v_rules->'objective_progress'->(g.goal->>'id')->>'status', '') = 'completed'
           and coalesce(v_rules->'objective_progress'->(g.goal->>'id')->>'source', '') = 'delivery_confirmed'
      )
      into v_auto_finalize;
  end if;

  if v_auto_finalize then
    v_chat_progress := jsonb_set(v_chat_progress, '{isConverted}', 'true'::jsonb);
    v_chat_progress := jsonb_set(v_chat_progress, '{updatedAt}', to_jsonb(v_now));
    v_orch := jsonb_set(v_orch, '{isConverted}', 'true'::jsonb);
    v_orch := jsonb_set(v_orch, '{workflowFinalized}', 'true'::jsonb);
    v_orch := jsonb_set(v_orch, '{workflowCompletedAt}', to_jsonb(v_now));
    v_rules := jsonb_set(v_rules, '{status}', '"completed"'::jsonb);
    v_rules := jsonb_set(v_rules, '{workflow_finalized}', 'true'::jsonb);
    v_rules := jsonb_set(v_rules, '{finalized_at}', to_jsonb(v_now));
    v_rules := jsonb_set(v_rules, '{finalized_reason}', '"all_required_objectives_completed"'::jsonb);
  end if;

  v_chat_progress := jsonb_set(v_chat_progress, '{updatedAt}', to_jsonb(v_now));
  v_rules := jsonb_set(v_rules, '{chat_progress}', v_chat_progress);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  update public.instagram_conversations
     set stage_completed_rules = v_rules,
         current_stage_id = coalesce(nullif(btrim(p_current_stage_id), ''), current_stage_id),
         ai_auto_respond = case when v_auto_finalize then false else ai_auto_respond end,
         ai_debounce_until = case when v_auto_finalize then null else ai_debounce_until end,
         is_converted = case when v_auto_finalize then true else is_converted end,
         updated_at = v_now_ts
   where id = v_conv_id;

  if v_auto_finalize then
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
      v_conv_id,
      false,
      'disabled',
      jsonb_build_object(
        'status', 'disabled',
        'workflowFinalized', true,
        'finalizedAt', v_now
      ),
      1,
      v_now_ts,
      v_now_ts
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
           state_updated_at = v_now_ts,
           updated_at = v_now_ts;
  end if;

  return jsonb_build_object(
    'success', true,
    'reason', case when v_auto_finalize then 'progress_patched_and_workflow_finalized' else 'progress_patched' end,
    'conversationId', v_conv_id,
    'currentStageId', v_effective_stage_id,
    'workflowFinalized', v_auto_finalize,
    'updatedAt', v_now
  );
end;
$$;

revoke execute on function public.patch_chat_progress_atomic(
  text, text, text[], text[], jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.patch_chat_progress_atomic(
  text, text, text[], text[], jsonb, boolean
) to service_role;
