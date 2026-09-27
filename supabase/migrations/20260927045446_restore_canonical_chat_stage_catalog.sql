-- Restaura o último catálogo canônico versionado em
-- c5e2ef08:src/domain/entities/ChatStage.ts. Os registros configurados na
-- produção e seus IDs customizados são preservados; só são acrescentados
-- objetivos oficiais ausentes. Não remove etapas nem regrava objetivos existentes.
WITH canonical_stages(id, name, stage_order, color, icon, description, goals) AS (
  VALUES
    (
      'stage_1_conexao', 'Conexão Inicial', 0, '#3b82f6', 'message-circle',
      'Criar conforto, reciprocidade e um começo natural de conversa sem entrevista.',
      '[
        {"id":"goal_initial_reciprocity","stageId":"stage_1_conexao","title":"Reciprocidade inicial","label":"Reciprocidade inicial","description":"Reconhecer que a conversa deixou de ser apenas uma saudação e houve pelo menos uma troca minimamente recíproca entre os dois.","kind":"conversation_state","required":true,"enabled":true,"order":1},
        {"id":"goal_city","stageId":"stage_1_conexao","title":"Cidade","label":"Cidade","description":"Descobrir onde ele mora ou contexto geográfico","kind":"fact","required":true,"enabled":true,"order":2,"memoryEntity":"self","memoryField":"city"},
        {"id":"goal_job","stageId":"stage_1_conexao","title":"Profissão / trabalho","label":"Profissão / trabalho","description":"Descobrir profissão, ocupação ou trabalho atual","kind":"fact","required":true,"enabled":true,"order":3,"memoryEntity":"self","memoryField":"job"}
      ]'::jsonb
    ),
    (
      'stage_2_descoberta', 'Descoberta', 1, '#10b981', 'compass',
      'Conhecer organicamente quem o pretendente é no cotidiano, sua rotina, trabalho, gostos e contexto pessoal.',
      '[
        {"id":"goal_age","stageId":"stage_2_descoberta","title":"Idade","label":"Idade","description":"Descobrir a idade ou faixa etária","kind":"fact","required":true,"enabled":true,"order":1,"memoryEntity":"self","memoryField":"age"},
        {"id":"goal_routine","stageId":"stage_2_descoberta","title":"Rotina","label":"Rotina","description":"Conhecer alguma informação útil sobre como é o cotidiano dele (horário de trabalho, dia/noite, rotina corrida/tranquila, estudos, academia)","kind":"fact","required":true,"enabled":true,"order":2,"memoryEntity":"self","memoryField":"routine"},
        {"id":"goal_hobbies","stageId":"stage_2_descoberta","title":"Hobbies e interesses","label":"Hobbies e interesses","description":"Conhecer pelo menos um gosto, hobby ou atividade que ele realmente curta","kind":"fact","required":true,"enabled":true,"order":3,"memoryEntity":"self","memoryField":"hobbies"},
        {"id":"goal_social_style","stageId":"stage_2_descoberta","title":"Estilo de lazer / rolê","label":"Estilo de lazer / rolê","description":"Entender de forma natural que tipo de programa costuma gostar (caseiro, restaurante, bar, festa, viagem, natureza, passeios)","kind":"fact","required":true,"enabled":true,"order":4,"memoryEntity":"self","memoryField":"social_style"},
        {"id":"goal_discovery_depth","stageId":"stage_2_descoberta","title":"Contexto suficiente de descoberta","label":"Contexto suficiente de descoberta","description":"Reconhecer que já existe contexto pessoal suficiente (pelo menos 2 fatos duráveis de categorias distintas ou revelação mais rica acompanhada de reciprocidade) para avançar naturalmente para compatibilidade.","kind":"conversation_state","required":true,"enabled":true,"order":5}
      ]'::jsonb
    ),
    (
      'stage_3_compatibilidade', 'Compatibilidade', 2, '#8b5cf6', 'heart',
      'Entender valores, momento de vida, visão de relacionamento, família, planos e compatibilidade somente quando houver abertura natural.',
      '[
        {"id":"goal_relationship","stageId":"stage_3_compatibilidade","title":"Status de relacionamento","label":"Status de relacionamento","description":"Descobrir o status atual de relacionamento dele (solteiro, separado, divorciado, etc.). Não usar para filhos nem intenção.","kind":"fact","required":true,"enabled":true,"order":1,"memoryEntity":"self","memoryField":"relationship_status"},
        {"id":"goal_relationship_intent","stageId":"stage_3_compatibilidade","title":"O que procura atualmente","label":"O que procura atualmente","description":"Entender a intenção atual dele em relação a conhecer alguém (algo sério, conhecer sem pressa, relacionamento, não sabe ainda)","kind":"fact","required":true,"enabled":true,"order":2,"memoryEntity":"self","memoryField":"relationship_intent"},
        {"id":"goal_has_children","stageId":"stage_3_compatibilidade","title":"Tem filhos","label":"Tem filhos","description":"Registrar se ele possui ou não filhos (fato presente). Não misturar com desejo futuro de filhos.","kind":"fact","required":true,"enabled":true,"order":3,"memoryEntity":"self","memoryField":"has_children"},
        {"id":"goal_wants_children","stageId":"stage_3_compatibilidade","title":"Quer ter filhos","label":"Quer ter filhos","description":"Registrar a visão dele sobre ter filhos no futuro. Só concluir com evidência clara. Não inferir de ter filhos.","kind":"fact","required":true,"enabled":true,"order":4,"memoryEntity":"self","memoryField":"wants_children"},
        {"id":"goal_family_values","stageId":"stage_3_compatibilidade","title":"Família e valores","label":"Família e valores","description":"Conhecer algum aspecto relevante sobre como ele enxerga família, vínculo, respeito, estabilidade ou relações pessoais","kind":"fact","required":true,"enabled":true,"order":5,"memoryEntity":"self","memoryField":"family_values"},
        {"id":"goal_future_plans","stageId":"stage_3_compatibilidade","title":"Planos futuros","label":"Planos futuros","description":"Conhecer algum plano relevante de médio/longo prazo (carreira, moradia, viagens, família, projetos pessoais)","kind":"fact","required":true,"enabled":true,"order":6,"memoryEntity":"self","memoryField":"future_plans"},
        {"id":"goal_faith_values","stageId":"stage_3_compatibilidade","title":"Fé / espiritualidade","label":"Fé / espiritualidade","description":"Conhecer esse aspecto SOMENTE quando surgir naturalmente. Nunca forçar pergunta religiosa.","kind":"fact","required":true,"enabled":true,"order":7,"memoryEntity":"self","memoryField":"faith_values","allowedSubagents":["compatibilidade"],"primarySubagent":"compatibilidade"},
        {"id":"goal_values","stageId":"stage_3_compatibilidade","title":"Valores e Família (legado)","label":"Valores e Família (legado)","description":"Objetivo histórico: compartilhar visão sobre fé, Deus, família e princípios de vida.","kind":"fact","required":false,"enabled":false,"order":8,"memoryEntity":"self","memoryField":"values"}
      ]'::jsonb
    )
)
INSERT INTO public.chat_stages(id, name, stage_order, color, icon, description, goals)
SELECT id, name, stage_order, color, icon, description, goals
FROM canonical_stages
ON CONFLICT (id) DO UPDATE
SET name = COALESCE(NULLIF(public.chat_stages.name, ''), EXCLUDED.name),
    stage_order = EXCLUDED.stage_order,
    color = COALESCE(public.chat_stages.color, EXCLUDED.color),
    icon = COALESCE(public.chat_stages.icon, EXCLUDED.icon),
    description = COALESCE(NULLIF(public.chat_stages.description, ''), EXCLUDED.description),
    goals = CASE
      WHEN jsonb_typeof(public.chat_stages.goals) <> 'array' THEN EXCLUDED.goals
      ELSE (
        SELECT COALESCE(jsonb_agg(merged.goal ORDER BY merged.sort_order, merged.stable_order), '[]'::jsonb)
        FROM (
          SELECT existing_goal AS goal,
                 COALESCE(NULLIF(existing_goal->>'order', '')::integer, existing_ordinal::integer) AS sort_order,
                 existing_ordinal AS stable_order
          FROM jsonb_array_elements(public.chat_stages.goals) WITH ORDINALITY AS existing(existing_goal, existing_ordinal)

          UNION ALL

          SELECT jsonb_set(missing.goal, '{order}', to_jsonb(existing_bounds.max_order + missing.missing_order)),
                 existing_bounds.max_order + missing.missing_order,
                 100000 + missing.missing_order
          FROM (
            SELECT seed_goal AS goal,
                   row_number() OVER (ORDER BY COALESCE(NULLIF(seed_goal->>'order', '')::integer, seed_ordinal::integer), seed_ordinal)::integer AS missing_order
            FROM jsonb_array_elements(EXCLUDED.goals) WITH ORDINALITY AS seed(seed_goal, seed_ordinal)
            WHERE NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(public.chat_stages.goals) AS existing(existing_goal)
              WHERE existing_goal->>'id' = seed_goal->>'id'
            )
          ) AS missing
          CROSS JOIN LATERAL (
            SELECT COALESCE(MAX(NULLIF(existing_goal->>'order', '')::integer), -1)::integer AS max_order
            FROM jsonb_array_elements(public.chat_stages.goals) AS existing(existing_goal)
          ) AS existing_bounds
        ) AS merged
      )
    END,
    updated_at = now();

-- IDs gerados de profissão/idade/hobbies são mantidos, mas deixam de ser
-- objetivos ativos após a migração para os IDs canônicos.
UPDATE public.chat_stages AS stage
SET goals = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN lower(COALESCE(goal->>'memoryField', '')) IN ('age', 'hobbies', 'profession', 'occupation')
        AND goal->>'id' <> CASE lower(COALESCE(goal->>'memoryField', ''))
          WHEN 'age' THEN 'goal_age'
          WHEN 'hobbies' THEN 'goal_hobbies'
          ELSE 'goal_job'
        END
      THEN jsonb_set(goal, '{enabled}', 'false'::jsonb, true)
      WHEN goal->>'id' = 'goal_children'
      THEN jsonb_set(goal, '{enabled}', 'false'::jsonb, true)
      ELSE goal
    END
    ORDER BY ordinality
  ), '[]'::jsonb)
  FROM jsonb_array_elements(stage.goals) WITH ORDINALITY AS configured(goal, ordinality)
)
WHERE stage.id = 'stage_1_conexao';

UPDATE public.chat_stages AS stage
SET goals = (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN goal->>'id' = 'goal_children'
      THEN jsonb_set(goal, '{enabled}', 'false'::jsonb, true)
      ELSE goal
    END
    ORDER BY ordinality
  ), '[]'::jsonb)
  FROM jsonb_array_elements(stage.goals) WITH ORDINALITY AS configured(goal, ordinality)
)
WHERE stage.id = 'stage_3_compatibilidade';

-- Transfere conclusões antigas de objetivos de idade/hobbies, já configurados
-- na etapa 1 com IDs gerados, para os IDs canônicos usados pela etapa 2.
-- O progresso antigo e a evidência original continuam preservados.
DO $$
DECLARE
  v_conversation record;
  v_alias record;
  v_rules jsonb;
  v_orchestration jsonb;
  v_chat_progress jsonb;
  v_completed jsonb;
  v_orchestration_completed jsonb;
  v_chat_completed jsonb;
  v_progress jsonb;
  v_orchestration_progress jsonb;
  v_chat_progress_map jsonb;
  v_old_progress jsonb;
  v_target_progress jsonb;
  v_was_completed boolean;
  v_changed boolean;
BEGIN
  FOR v_conversation IN
    SELECT id, stage_completed_rules
    FROM public.instagram_conversations
    WHERE jsonb_typeof(stage_completed_rules) = 'object'
  LOOP
    v_rules := v_conversation.stage_completed_rules;
    v_orchestration := CASE WHEN jsonb_typeof(v_rules->'orchestration') = 'object' THEN v_rules->'orchestration' ELSE '{}'::jsonb END;
    v_chat_progress := CASE WHEN jsonb_typeof(v_rules->'chat_progress') = 'object' THEN v_rules->'chat_progress' ELSE '{}'::jsonb END;
    v_completed := CASE WHEN jsonb_typeof(v_rules->'completed_goals') = 'array' THEN v_rules->'completed_goals' ELSE '[]'::jsonb END;
    v_orchestration_completed := CASE WHEN jsonb_typeof(v_orchestration->'completedGoalIds') = 'array' THEN v_orchestration->'completedGoalIds' ELSE '[]'::jsonb END;
    v_chat_completed := CASE WHEN jsonb_typeof(v_chat_progress->'completedGoalIds') = 'array' THEN v_chat_progress->'completedGoalIds' ELSE '[]'::jsonb END;
    v_progress := CASE WHEN jsonb_typeof(v_rules->'objective_progress') = 'object' THEN v_rules->'objective_progress' ELSE '{}'::jsonb END;
    v_orchestration_progress := CASE WHEN jsonb_typeof(v_orchestration->'objectiveProgress') = 'object' THEN v_orchestration->'objectiveProgress' ELSE '{}'::jsonb END;
    v_chat_progress_map := CASE WHEN jsonb_typeof(v_chat_progress->'objectiveProgress') = 'object' THEN v_chat_progress->'objectiveProgress' ELSE '{}'::jsonb END;
    v_changed := false;

    FOR v_alias IN
      SELECT legacy_goal->>'id' AS legacy_id,
             canonical_goal->>'id' AS canonical_id,
             canonical_stage.id AS canonical_stage_id
      FROM public.chat_stages AS legacy_stage
      CROSS JOIN LATERAL jsonb_array_elements(legacy_stage.goals) AS legacy(legacy_goal)
      JOIN public.chat_stages AS canonical_stage
        ON canonical_stage.id = CASE lower(COALESCE(legacy_goal->>'memoryField', ''))
          WHEN 'age' THEN 'stage_2_descoberta'
          WHEN 'hobbies' THEN 'stage_2_descoberta'
          WHEN 'profession' THEN 'stage_1_conexao'
          WHEN 'occupation' THEN 'stage_1_conexao'
          ELSE NULL
        END
      CROSS JOIN LATERAL jsonb_array_elements(canonical_stage.goals) AS canonical(canonical_goal)
      WHERE legacy_stage.id = 'stage_1_conexao'
        AND lower(COALESCE(legacy_goal->>'memoryField', '')) IN ('age', 'hobbies')
        AND (
          lower(COALESCE(legacy_goal->>'memoryField', '')) = lower(COALESCE(canonical_goal->>'memoryField', ''))
          OR (lower(COALESCE(legacy_goal->>'memoryField', '')) IN ('profession', 'occupation') AND canonical_goal->>'id' = 'goal_job')
        )
        AND legacy_goal->>'id' <> canonical_goal->>'id'
    LOOP
      v_old_progress := COALESCE(
        v_progress->v_alias.legacy_id,
        v_orchestration_progress->v_alias.legacy_id,
        v_chat_progress_map->v_alias.legacy_id,
        '{}'::jsonb
      );
      v_was_completed := v_completed ? v_alias.legacy_id
        OR v_orchestration_completed ? v_alias.legacy_id
        OR v_chat_completed ? v_alias.legacy_id
        OR v_old_progress->>'status' = 'completed';

      IF v_was_completed THEN
        IF NOT (v_completed ? v_alias.canonical_id) THEN v_completed := v_completed || jsonb_build_array(v_alias.canonical_id); END IF;
        IF NOT (v_orchestration_completed ? v_alias.canonical_id) THEN v_orchestration_completed := v_orchestration_completed || jsonb_build_array(v_alias.canonical_id); END IF;
        IF NOT (v_chat_completed ? v_alias.canonical_id) THEN v_chat_completed := v_chat_completed || jsonb_build_array(v_alias.canonical_id); END IF;

        v_target_progress := COALESCE(
          v_progress->v_alias.canonical_id,
          v_orchestration_progress->v_alias.canonical_id,
          v_chat_progress_map->v_alias.canonical_id
        );
        IF jsonb_typeof(v_target_progress) <> 'object' OR v_target_progress->>'status' <> 'completed' THEN
          v_target_progress := v_old_progress || jsonb_build_object(
            'conversationId', v_conversation.id,
            'stageId', v_alias.canonical_stage_id,
            'objectiveId', v_alias.canonical_id,
            'status', 'completed'
          );
        END IF;
        v_progress := jsonb_set(v_progress, ARRAY[v_alias.canonical_id], v_target_progress, true);
        v_orchestration_progress := jsonb_set(v_orchestration_progress, ARRAY[v_alias.canonical_id], v_target_progress, true);
        v_chat_progress_map := jsonb_set(v_chat_progress_map, ARRAY[v_alias.canonical_id], v_target_progress, true);
        v_changed := true;
      END IF;
    END LOOP;

    IF v_changed THEN
      v_orchestration := jsonb_set(v_orchestration, '{completedGoalIds}', v_orchestration_completed, true);
      v_orchestration := jsonb_set(v_orchestration, '{objectiveProgress}', v_orchestration_progress, true);
      v_chat_progress := jsonb_set(v_chat_progress, '{completedGoalIds}', v_chat_completed, true);
      v_chat_progress := jsonb_set(v_chat_progress, '{objectiveProgress}', v_chat_progress_map, true);
      v_rules := jsonb_set(v_rules, '{completed_goals}', v_completed, true);
      v_rules := jsonb_set(v_rules, '{objective_progress}', v_progress, true);
      v_rules := jsonb_set(v_rules, '{chat_progress}', v_chat_progress, true);
      v_rules := jsonb_set(v_rules, '{orchestration}', v_orchestration, true);
      UPDATE public.instagram_conversations
      SET stage_completed_rules = v_rules
      WHERE id = v_conversation.id;
    END IF;
  END LOOP;
END;
$$;
