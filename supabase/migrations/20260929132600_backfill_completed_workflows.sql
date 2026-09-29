-- Corrige conversas que já tinham concluído todos os objetivos obrigatórios
-- da última etapa antes da finalização automática existir.

with final_stage as (
  select id, goals
  from public.chat_stages
  order by stage_order desc
  limit 1
),
required_goals as (
  select f.id as stage_id,
         array_agg(goal->>'id') filter (where goal->>'id' is not null) as ids
  from final_stage f
  cross join lateral jsonb_array_elements(coalesce(f.goals, '[]'::jsonb)) goal
  where coalesce((goal->>'enabled')::boolean, true)
    and coalesce((goal->>'required')::boolean, true)
  group by f.id
),
eligible as (
  select c.id
  from public.instagram_conversations c
  join required_goals r on c.current_stage_id = r.stage_id
  where coalesce(c.is_converted, false) = false
    and coalesce(array_length(r.ids, 1), 0) > 0
    and r.ids <@ array(
      select jsonb_array_elements_text(
        coalesce(c.stage_completed_rules->'completed_goals', '[]'::jsonb)
      )
    )
)
update public.instagram_conversations c
set is_converted = true,
    ai_auto_respond = false,
    ai_debounce_until = null,
    stage_completed_rules =
      coalesce(c.stage_completed_rules, '{}'::jsonb)
      || jsonb_build_object(
        'status', 'completed',
        'workflow_finalized', true,
        'finalized_reason', 'all_required_objectives_completed',
        'finalized_at', coalesce(c.stage_completed_rules->>'finalized_at', clock_timestamp()::text),
        'chat_progress',
          coalesce(c.stage_completed_rules->'chat_progress', '{}'::jsonb)
          || jsonb_build_object(
            'isConverted', true,
            'updatedAt', clock_timestamp()
          ),
        'orchestration',
          coalesce(c.stage_completed_rules->'orchestration', '{}'::jsonb)
          || jsonb_build_object(
            'isConverted', true,
            'workflowFinalized', true,
            'workflowCompletedAt', clock_timestamp()
          )
      ),
    updated_at = clock_timestamp()
from eligible e
where c.id = e.id;

update public.autopilot_chat_states s
set is_enabled = false,
    status = 'disabled',
    state = jsonb_set(
      jsonb_set(
        coalesce(s.state, '{}'::jsonb),
        '{status}',
        '"disabled"'::jsonb,
        true
      ),
      '{workflowFinalized}',
      'true'::jsonb,
      true
    ),
    state_revision = s.state_revision + 1,
    state_updated_at = clock_timestamp(),
    updated_at = clock_timestamp()
where exists (
  select 1
  from public.instagram_conversations c
  where c.id = s.conversation_id
    and c.is_converted is true
    and coalesce(c.stage_completed_rules->>'workflow_finalized', 'false') = 'true'
);
