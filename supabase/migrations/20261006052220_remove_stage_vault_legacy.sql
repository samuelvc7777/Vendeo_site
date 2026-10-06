-- Remove definitivamente a associação legada etapa <-> pasta/checklist do Cofre.
-- O Cofre continua existindo como biblioteca independente e os áudios continuam
-- vinculados semanticamente por objective_id.

do $migration$
declare
  v_def text;
begin
  if to_regprocedure('public.patch_chat_progress_atomic(text,text,text[],text[],jsonb,boolean)') is not null then
    select pg_get_functiondef(
      'public.patch_chat_progress_atomic(text,text,text[],text[],jsonb,boolean)'::regprocedure
    ) into v_def;

    v_def := replace(
      v_def,
      ', p_completed_item_ids text[] DEFAULT NULL::text[]',
      ''
    );

    v_def := replace(
      v_def,
$legacy$
  if p_completed_item_ids is not null then
    v_chat_progress := jsonb_set(v_chat_progress, '{completedItemIds}', to_jsonb(p_completed_item_ids), true);
  end if;

$legacy$,
      ''
    );

    if position('p_completed_item_ids' in v_def) > 0
       or position('completedItemIds' in v_def) > 0
    then
      raise exception 'legacy item progress fragment still present after transformation';
    end if;

    execute v_def;
  elsif to_regprocedure('public.patch_chat_progress_atomic(text,text,text[],jsonb,boolean)') is null then
    raise exception 'patch_chat_progress_atomic base overload not found';
  end if;
end;
$migration$;

revoke all on function public.patch_chat_progress_atomic(text, text, text[], jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.patch_chat_progress_atomic(text, text, text[], jsonb, boolean)
  to service_role;

create or replace function public.patch_chat_progress_atomic(
  p_conversation_id text,
  p_progress_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage_id text;
  v_goals text[];
  v_obj_prog jsonb;
  v_is_conv boolean;
begin
  v_stage_id := p_progress_patch->>'currentStageId';

  if p_progress_patch ? 'completedGoalIds'
     and jsonb_typeof(p_progress_patch->'completedGoalIds') = 'array'
  then
    select coalesce(array_agg(x), array[]::text[])
      into v_goals
      from jsonb_array_elements_text(p_progress_patch->'completedGoalIds') t(x);
  end if;

  v_obj_prog := p_progress_patch->'objectiveProgress';

  if p_progress_patch ? 'isConverted' then
    v_is_conv := (p_progress_patch->>'isConverted')::boolean;
  end if;

  return public.patch_chat_progress_atomic(
    p_conversation_id,
    v_stage_id,
    v_goals,
    v_obj_prog,
    v_is_conv
  );
end;
$$;

revoke all on function public.patch_chat_progress_atomic(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.patch_chat_progress_atomic(text, jsonb)
  to service_role;

drop function if exists public.patch_chat_progress_atomic(
  text, text, text[], text[], jsonb, boolean
);

update public.instagram_conversations
set stage_completed_rules = jsonb_set(
  stage_completed_rules,
  '{chat_progress}',
  (stage_completed_rules->'chat_progress') - 'completedItemIds',
  true
)
where jsonb_typeof(stage_completed_rules) = 'object'
  and jsonb_typeof(stage_completed_rules->'chat_progress') = 'object'
  and (stage_completed_rules->'chat_progress') ? 'completedItemIds';
