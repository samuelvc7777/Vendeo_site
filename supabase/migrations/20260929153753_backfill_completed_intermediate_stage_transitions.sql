-- Repara conversas que concluíram todos os objetivos obrigatórios de uma etapa
-- intermediária antes do Brain passar a declarar a transição explicitamente.
-- Runtime futuro continua exigindo decisão explícita do Brain; este arquivo é apenas backfill.

with ordered_stages as (
  select
    id,
    goals,
    lead(id) over (order by stage_order asc) as next_stage_id
  from public.chat_stages
),
eligible as (
  select
    c.id as conversation_id,
    s.next_stage_id
  from public.instagram_conversations c
  join ordered_stages s on s.id = c.current_stage_id
  where s.next_stage_id is not null
    and coalesce(c.is_converted, false) = false
    and exists (
      select 1
      from jsonb_array_elements(coalesce(s.goals, '[]'::jsonb)) goal
      where coalesce((goal->>'enabled')::boolean, true)
        and coalesce((goal->>'required')::boolean, true)
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(s.goals, '[]'::jsonb)) goal
      where coalesce((goal->>'enabled')::boolean, true)
        and coalesce((goal->>'required')::boolean, true)
        and not (
          (goal->>'id') = any (
            array(
              select jsonb_array_elements_text(
                coalesce(c.stage_completed_rules->'completed_goals', '[]'::jsonb)
              )
            )
          )
          or coalesce(c.stage_completed_rules->'objective_progress'->(goal->>'id')->>'status' = 'completed', false)
          or coalesce(c.stage_completed_rules->'orchestration'->'objectiveProgress'->(goal->>'id')->>'status' = 'completed', false)
        )
    )
)
update public.instagram_conversations c
set current_stage_id = e.next_stage_id,
    stage_completed_rules =
      jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(c.stage_completed_rules, '{}'::jsonb),
            '{orchestration,currentStageId}',
            to_jsonb(e.next_stage_id),
            true
          ),
          '{orchestration,currentPhase}',
          to_jsonb(e.next_stage_id),
          true
        ),
        '{chat_progress,currentStageId}',
        to_jsonb(e.next_stage_id),
        true
      ),
    updated_at = clock_timestamp()
from eligible e
where c.id = e.conversation_id;
