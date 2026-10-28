-- Autoridades distintas: operador mantém patch_chat_progress_atomic; automação usa
-- somente ações persistidas e confirmadas. Nenhuma regra do checklist manual muda.
create table public.delivery_objective_receipts (
  action_id text primary key,
  conversation_id text not null,
  stage_id text not null,
  objective_id text not null,
  provider_message_id text not null,
  completed_at timestamptz not null default now()
);
alter table public.delivery_objective_receipts enable row level security;
revoke all on public.delivery_objective_receipts from public, anon, authenticated;
grant select, insert on public.delivery_objective_receipts to service_role;

create or replace function public.complete_delivery_objective_atomic(
  p_conversation_id text, p_action_id text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_conv public.instagram_conversations%rowtype;
  v_action public.brain_decision_actions%rowtype;
  v_decision public.brain_decisions%rowtype;
  v_goal jsonb;
  v_goals jsonb;
  v_rules jsonb;
  v_progress jsonb;
  v_completed jsonb;
  v_objective_id text;
  v_asset_id text;
  v_asset_objective_id text;
  v_asset_enabled boolean;
  v_stage_id text;
  v_result jsonb;
begin
  -- Mesmo lock usado pelo commit semântico e pelo salvamento manual.
  select * into v_conv from instagram_conversations where id = p_conversation_id for update;
  if not found then return jsonb_build_object('success', false, 'reason', 'conversation_not_found'); end if;
  select * into v_action from brain_decision_actions
    where id = p_action_id and conversation_id = p_conversation_id;
  if not found or v_action.status <> 'sent' or coalesce(btrim(v_action.provider_message_id), '') = '' then
    return jsonb_build_object('success', false, 'reason', 'delivery_not_confirmed');
  end if;
  -- Recibos sobrevivem à reabertura manual: repetir o evento não desfaz a escolha humana.
  if exists (select 1 from delivery_objective_receipts where action_id = p_action_id) then
    return jsonb_build_object('success', true, 'reason', 'already_processed');
  end if;
  select * into v_decision from brain_decisions
    where id = v_action.decision_id and conversation_id = p_conversation_id;
  if not found then return jsonb_build_object('success', false, 'reason', 'decision_not_found'); end if;
  v_stage_id := v_decision.payload->'semanticState'->>'expectedCurrentStageId';
  if coalesce(v_stage_id, '') = '' or v_stage_id is distinct from v_conv.current_stage_id then
    return jsonb_build_object('success', false, 'reason', 'delivery_stage_changed');
  end if;
  if not exists (select 1 from conversation_schedule_runs
    where id::text = v_action.payload->>'scheduleRunId' and conversation_id = p_conversation_id and status = 'active') then
    return jsonb_build_object('success', false, 'reason', 'delivery_schedule_changed');
  end if;
  select goals into v_goals from chat_stages where id = v_stage_id;
  if jsonb_typeof(v_goals) = 'array' and jsonb_array_length(v_goals) = 1 and jsonb_typeof(v_goals->0) = 'array' then
    v_goals := v_goals->0;
  end if;
  v_objective_id := v_action.payload->>'objectiveId';
  select goal into v_goal from jsonb_array_elements(coalesce(v_goals, '[]'::jsonb)) goal
    where goal->>'id' = v_objective_id and coalesce(goal->>'enabled', 'true') <> 'false';
  if v_goal is null or v_goal->>'kind' is distinct from 'action'
    or v_goal->>'completionPolicy' is distinct from 'delivery_confirmed' then
    return jsonb_build_object('success', false, 'reason', 'delivery_objective_invalid');
  end if;
  if v_goal->>'actionType' = 'send_audio' and v_action.action_type = 'audio' then
    v_asset_id := v_action.payload->>'audioId';
    select objective_id, enabled into v_asset_objective_id, v_asset_enabled from persona_audios where id = v_asset_id;
  elsif v_goal->>'actionType' = 'send_image' and v_action.action_type = 'image' then
    v_asset_id := v_action.payload->>'imageId';
    -- A main ainda não exige o catálogo de fotos. Ausência da tabela falha de forma fechada.
    if to_regclass('public.persona_images') is null then
      return jsonb_build_object('success', false, 'reason', 'image_catalog_unavailable');
    end if;
    execute 'select objective_id, enabled from public.persona_images where id = $1'
      into v_asset_objective_id, v_asset_enabled using v_asset_id;
  else
    return jsonb_build_object('success', false, 'reason', 'delivery_action_type_mismatch');
  end if;
  if coalesce(v_asset_id, '') = '' or v_asset_enabled is distinct from true
    or v_asset_objective_id is distinct from v_objective_id then
    return jsonb_build_object('success', false, 'reason', 'delivery_asset_mismatch');
  end if;
  v_rules := coalesce(v_conv.stage_completed_rules, '{}'::jsonb);
  v_completed := coalesce(v_rules->'completed_goals', v_rules->'orchestration'->'completedGoalIds', '[]'::jsonb);
  v_progress := coalesce(v_rules->'objective_progress', v_rules->'orchestration'->'objectiveProgress', '{}'::jsonb);
  insert into delivery_objective_receipts(action_id, conversation_id, stage_id, objective_id, provider_message_id)
    values(p_action_id, p_conversation_id, v_stage_id, v_objective_id, v_action.provider_message_id);
  if v_completed ? v_objective_id or v_progress->v_objective_id->>'status' = 'completed' then
    return jsonb_build_object('success', true, 'reason', 'already_completed');
  end if;
  v_completed := v_completed || jsonb_build_array(v_objective_id);
  v_progress := v_progress || jsonb_build_object(v_objective_id, jsonb_build_object(
    'conversationId', p_conversation_id, 'stageId', v_stage_id, 'objectiveId', v_objective_id,
    'status', 'completed', 'value', null, 'source', 'delivery_confirmed',
    'deliveryActionId', p_action_id, 'providerMessageId', v_action.provider_message_id, 'completedAt', now()));
  -- Preserva finalização e espelhos existentes; merge feito com estado atual sob lock.
  v_result := patch_chat_progress_atomic(p_conversation_id, jsonb_build_object(
    'currentStageId', v_stage_id, 'completedGoalIds', v_completed, 'objectiveProgress', v_progress));
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'delivery objective progress persistence failed';
  end if;
  return jsonb_build_object('success', true, 'reason', 'delivery_confirmed');
end;
$$;
revoke all on function public.complete_delivery_objective_atomic(text, text) from public, anon, authenticated;
grant execute on function public.complete_delivery_objective_atomic(text, text) to service_role;

-- Defesa na persistência automática. Mantém a verdade atual de cada objetivo de
-- entrega, inclusive conclusões/reaberturas manuais e confirmações concorrentes.
create or replace function public.guard_brain_delivery_progress(p_state jsonb, p_rules jsonb, p_stage_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_goal jsonb;
  v_id text;
  v_completed jsonb := coalesce(p_rules->'completed_goals', p_rules->'orchestration'->'completedGoalIds', '[]'::jsonb);
  v_progress jsonb := coalesce(p_rules->'objective_progress', p_rules->'orchestration'->'objectiveProgress', '{}'::jsonb);
  v_next_completed jsonb := coalesce(p_state->'completedGoalIds', '[]'::jsonb);
  v_next_progress jsonb := coalesce(p_state->'objectiveProgress', '{}'::jsonb);
  v_stage record;
begin
  for v_stage in select id, goals, is_required from chat_stages loop
    for v_goal in select value from jsonb_array_elements(case
      when jsonb_typeof(v_stage.goals) <> 'array' then '[]'::jsonb
      when jsonb_array_length(v_stage.goals) = 1 and jsonb_typeof(v_stage.goals->0) = 'array' then v_stage.goals->0
      else coalesce(v_stage.goals, '[]'::jsonb) end) loop
      if v_goal->>'completionPolicy' is distinct from 'delivery_confirmed' then continue; end if;
      v_id := v_goal->>'id';
      if coalesce(v_id, '') = '' then continue; end if;
      if not (v_completed ? v_id or coalesce(v_progress->v_id->>'status', '') = 'completed')
        and (v_next_completed ? v_id or coalesce(v_next_progress->v_id->>'status', '') = 'completed') then
        raise exception 'delivery_confirmation_required: %', v_id;
      end if;
      -- Não aceitar nem mesmo source/deliveryActionId inventados pela IA.
      select coalesce(jsonb_agg(value), '[]'::jsonb) into v_next_completed
        from jsonb_array_elements(v_next_completed) where value <> to_jsonb(v_id);
      v_next_progress := v_next_progress - v_id;
      if v_completed ? v_id then v_next_completed := v_next_completed || jsonb_build_array(v_id); end if;
      if v_progress ? v_id then v_next_progress := v_next_progress || jsonb_build_object(v_id, v_progress->v_id); end if;
      if v_stage.id = p_stage_id and coalesce(v_stage.is_required, true)
        and coalesce(v_goal->>'enabled', 'true') <> 'false' and coalesce(v_goal->>'required', 'true') <> 'false'
        and p_state->>'currentStageId' is distinct from p_stage_id
        and not (v_completed ? v_id or coalesce(v_progress->v_id->>'status', '') = 'completed') then
        raise exception 'delivery_stage_transition_blocked: %', v_id;
      end if;
    end loop;
  end loop;
  return p_state || jsonb_build_object('completedGoalIds', v_next_completed, 'objectiveProgress', v_next_progress);
end;
$$;
revoke all on function public.guard_brain_delivery_progress(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.guard_brain_delivery_progress(jsonb, jsonb, text) to service_role;

-- Insere a guarda no commit existente, depois do lock e dos CAS; preserva todas
-- as demais validações da função instalada e aborta se o contrato mudou.
do $migration$
declare v_definition text; v_anchor text := '    v_orchestration := COALESCE(v_rules->''orchestration'', ''{}''::jsonb);';
begin
  select pg_get_functiondef('public.persist_brain_decision_with_outbox(jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure)
    into v_definition;
  if strpos(v_definition, v_anchor) = 0 then raise exception 'semantic commit guard insertion point missing'; end if;
  v_definition := replace(v_definition, v_anchor,
    '    v_semantic_state := public.guard_brain_delivery_progress(v_semantic_state, v_rules, v_current_stage_id);' || chr(10) || v_anchor);
  execute v_definition;
end;
$migration$;


create or replace function public.guard_brain_delivery_rules(p_next jsonb, p_existing jsonb, p_stage_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_state jsonb;
begin
  v_state := guard_brain_delivery_progress(jsonb_build_object(
    'currentStageId', coalesce(p_next->'orchestration'->>'currentStageId', p_stage_id),
    'completedGoalIds', coalesce(p_next->'completed_goals', p_next->'orchestration'->'completedGoalIds', '[]'::jsonb),
    'objectiveProgress', coalesce(p_next->'objective_progress', p_next->'orchestration'->'objectiveProgress', '{}'::jsonb)
  ), p_existing, p_stage_id);
  p_next := p_next || jsonb_build_object('completed_goals', v_state->'completedGoalIds', 'objective_progress', v_state->'objectiveProgress');
  p_next := jsonb_set(p_next, '{orchestration}', coalesce(p_next->'orchestration', '{}'::jsonb) ||
    jsonb_build_object('completedGoalIds', v_state->'completedGoalIds', 'objectiveProgress', v_state->'objectiveProgress'));
  if p_next ? 'chat_progress' then
    p_next := jsonb_set(p_next, '{chat_progress}', p_next->'chat_progress' ||
      jsonb_build_object('completedGoalIds', v_state->'completedGoalIds', 'objectiveProgress', v_state->'objectiveProgress'));
  end if;
  return p_next;
end;
$$;
revoke all on function public.guard_brain_delivery_rules(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.guard_brain_delivery_rules(jsonb, jsonb, text) to service_role;

do $migration$
declare v_definition text;
  v_anchor text := '  v_final_rules := jsonb_set(coalesce(p_new_stage_completed_rules, ''{}''::jsonb), ''{active_cycle_token}'', ''null''::jsonb);';
begin
  select pg_get_functiondef('public.commit_experimental_cycle_if_owned(text,text,jsonb)'::regprocedure) into v_definition;
  if strpos(v_definition, v_anchor) = 0 then raise exception 'final cycle guard insertion point missing'; end if;
  v_definition := replace(v_definition, v_anchor,
    '  p_new_stage_completed_rules := public.guard_brain_delivery_rules(p_new_stage_completed_rules, v_rules, v_next_stage_id);' || chr(10) || v_anchor);
  execute v_definition;
end;
$migration$;
;
