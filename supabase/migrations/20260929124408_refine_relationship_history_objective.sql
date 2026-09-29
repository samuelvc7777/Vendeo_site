-- Refina goal_relationship para histórico amoroso, não status atual.
-- Também reabre a única conclusão conhecida baseada apenas em "estou solteiro".

update public.chat_stages
set goals = (
  select jsonb_agg(
    case
      when goal->>'id' = 'goal_relationship' then
        goal || jsonb_build_object(
          'title', 'Histórico de relacionamentos',
          'label', 'Histórico de relacionamentos',
          'description', 'Entrar no assunto de relacionamentos e descobrir se ele já namorou, nunca namorou, teve relacionamento sério, foi casado ou divorciado e, quando surgir naturalmente, duração ou experiência anterior. NÃO perguntar se está solteiro ou se tem alguém. Dizer apenas que está solteiro, sem ninguém ou que usa Tinder NÃO conclui este objetivo. Só concluir com evidência explícita sobre histórico/experiência de relacionamento.',
          'memoryField', 'relationship_history',
          'completionPolicy', 'fact_only'
        )
      else goal
    end
    order by ordinality
  )
  from jsonb_array_elements(coalesce(public.chat_stages.goals, '[]'::jsonb))
       with ordinality as items(goal, ordinality)
)
where id = 'stage_3_compatibilidade';

with target as (
  select id, stage_completed_rules
  from public.instagram_conversations
  where id = '28504815665812781'
)
update public.instagram_conversations c
set stage_completed_rules =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(c.stage_completed_rules, '{}'::jsonb),
              '{completed_goals}',
              coalesce((
                select jsonb_agg(v)
                from jsonb_array_elements(coalesce(c.stage_completed_rules->'completed_goals', '[]'::jsonb)) v
                where v <> to_jsonb('goal_relationship'::text)
              ), '[]'::jsonb),
              true
            ),
            '{objective_progress}',
            coalesce(c.stage_completed_rules->'objective_progress', '{}'::jsonb) - 'goal_relationship',
            true
          ),
          '{orchestration,completedGoalIds}',
          coalesce((
            select jsonb_agg(v)
            from jsonb_array_elements(coalesce(c.stage_completed_rules->'orchestration'->'completedGoalIds', '[]'::jsonb)) v
            where v <> to_jsonb('goal_relationship'::text)
          ), '[]'::jsonb),
          true
        ),
        '{orchestration,objectiveProgress}',
        coalesce(c.stage_completed_rules->'orchestration'->'objectiveProgress', '{}'::jsonb) - 'goal_relationship',
        true
      ),
      '{chat_progress,completedGoalIds}',
      coalesce((
        select jsonb_agg(v)
        from jsonb_array_elements(coalesce(c.stage_completed_rules->'chat_progress'->'completedGoalIds', '[]'::jsonb)) v
        where v <> to_jsonb('goal_relationship'::text)
      ), '[]'::jsonb),
      true
    ),
    '{chat_progress,objectiveProgress}',
    coalesce(c.stage_completed_rules->'chat_progress'->'objectiveProgress', '{}'::jsonb) - 'goal_relationship',
    true
  )
from target
where c.id = target.id;