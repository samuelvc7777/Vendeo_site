-- Corrige o histórico de profissão que usava IDs gerados pela configuração
-- antiga. Mantém IDs e dados legados e espelha conclusões no objetivo oficial.
DO $$
DECLARE
  v_conversation record;
  v_legacy record;
  v_rules jsonb;
  v_orchestration jsonb;
  v_chat_progress jsonb;
  v_root_completed jsonb;
  v_root_camel_completed jsonb;
  v_orchestration_completed jsonb;
  v_chat_completed jsonb;
  v_root_progress jsonb;
  v_root_camel_progress jsonb;
  v_orchestration_progress jsonb;
  v_chat_progress_map jsonb;
  v_old_progress jsonb;
  v_canonical_progress jsonb;
  v_completed boolean;
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
    v_root_completed := CASE WHEN jsonb_typeof(v_rules->'completed_goals') = 'array' THEN v_rules->'completed_goals' ELSE '[]'::jsonb END;
    v_root_camel_completed := CASE WHEN jsonb_typeof(v_rules->'completedGoalIds') = 'array' THEN v_rules->'completedGoalIds' ELSE '[]'::jsonb END;
    v_orchestration_completed := CASE WHEN jsonb_typeof(v_orchestration->'completedGoalIds') = 'array' THEN v_orchestration->'completedGoalIds' ELSE '[]'::jsonb END;
    v_chat_completed := CASE WHEN jsonb_typeof(v_chat_progress->'completedGoalIds') = 'array' THEN v_chat_progress->'completedGoalIds' ELSE '[]'::jsonb END;
    v_root_progress := CASE WHEN jsonb_typeof(v_rules->'objective_progress') = 'object' THEN v_rules->'objective_progress' ELSE '{}'::jsonb END;
    v_root_camel_progress := CASE WHEN jsonb_typeof(v_rules->'objectiveProgress') = 'object' THEN v_rules->'objectiveProgress' ELSE '{}'::jsonb END;
    v_orchestration_progress := CASE WHEN jsonb_typeof(v_orchestration->'objectiveProgress') = 'object' THEN v_orchestration->'objectiveProgress' ELSE '{}'::jsonb END;
    v_chat_progress_map := CASE WHEN jsonb_typeof(v_chat_progress->'objectiveProgress') = 'object' THEN v_chat_progress->'objectiveProgress' ELSE '{}'::jsonb END;
    v_changed := false;

    FOR v_legacy IN
      SELECT goal->>'id' AS legacy_id
      FROM public.chat_stages AS stage
      CROSS JOIN LATERAL jsonb_array_elements(stage.goals) AS configured(goal)
      WHERE stage.id = 'stage_1_conexao'
        AND lower(COALESCE(goal->>'memoryField', '')) IN ('profession', 'occupation')
        AND goal->>'id' <> 'goal_job'
    LOOP
      v_old_progress := COALESCE(
        v_root_progress->v_legacy.legacy_id,
        v_root_camel_progress->v_legacy.legacy_id,
        v_orchestration_progress->v_legacy.legacy_id,
        v_chat_progress_map->v_legacy.legacy_id,
        '{}'::jsonb
      );
      v_completed := v_root_completed ? v_legacy.legacy_id
        OR v_root_camel_completed ? v_legacy.legacy_id
        OR v_orchestration_completed ? v_legacy.legacy_id
        OR v_chat_completed ? v_legacy.legacy_id
        OR v_old_progress->>'status' = 'completed';

      IF v_completed THEN
        v_changed := true;
        IF NOT (v_root_completed ? 'goal_job') THEN v_root_completed := v_root_completed || '["goal_job"]'::jsonb; END IF;
        IF NOT (v_root_camel_completed ? 'goal_job') THEN v_root_camel_completed := v_root_camel_completed || '["goal_job"]'::jsonb; END IF;
        IF NOT (v_orchestration_completed ? 'goal_job') THEN v_orchestration_completed := v_orchestration_completed || '["goal_job"]'::jsonb; END IF;
        IF NOT (v_chat_completed ? 'goal_job') THEN v_chat_completed := v_chat_completed || '["goal_job"]'::jsonb; END IF;

        v_canonical_progress := COALESCE(
          v_root_progress->'goal_job',
          v_root_camel_progress->'goal_job',
          v_orchestration_progress->'goal_job',
          v_chat_progress_map->'goal_job'
        );
        IF jsonb_typeof(v_canonical_progress) <> 'object' OR v_canonical_progress->>'status' <> 'completed' THEN
          v_canonical_progress := v_old_progress || jsonb_build_object(
            'conversationId', v_conversation.id,
            'stageId', 'stage_1_conexao',
            'objectiveId', 'goal_job',
            'status', 'completed'
          );
        END IF;
        v_root_progress := jsonb_set(v_root_progress, '{goal_job}', v_canonical_progress, true);
        v_root_camel_progress := jsonb_set(v_root_camel_progress, '{goal_job}', v_canonical_progress, true);
        v_orchestration_progress := jsonb_set(v_orchestration_progress, '{goal_job}', v_canonical_progress, true);
        v_chat_progress_map := jsonb_set(v_chat_progress_map, '{goal_job}', v_canonical_progress, true);
      END IF;
    END LOOP;

    IF v_changed THEN
      v_orchestration := jsonb_set(v_orchestration, '{completedGoalIds}', v_orchestration_completed, true);
      v_orchestration := jsonb_set(v_orchestration, '{objectiveProgress}', v_orchestration_progress, true);
      v_chat_progress := jsonb_set(v_chat_progress, '{completedGoalIds}', v_chat_completed, true);
      v_chat_progress := jsonb_set(v_chat_progress, '{objectiveProgress}', v_chat_progress_map, true);
      v_rules := jsonb_set(v_rules, '{completed_goals}', v_root_completed, true);
      v_rules := jsonb_set(v_rules, '{completedGoalIds}', v_root_camel_completed, true);
      v_rules := jsonb_set(v_rules, '{objective_progress}', v_root_progress, true);
      v_rules := jsonb_set(v_rules, '{objectiveProgress}', v_root_camel_progress, true);
      v_rules := jsonb_set(v_rules, '{chat_progress}', v_chat_progress, true);
      v_rules := jsonb_set(v_rules, '{orchestration}', v_orchestration, true);
      UPDATE public.instagram_conversations
      SET stage_completed_rules = v_rules
      WHERE id = v_conversation.id;
    END IF;
  END LOOP;
END;
$$;
