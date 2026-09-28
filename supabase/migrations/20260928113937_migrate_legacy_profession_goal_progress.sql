DO $$
DECLARE
  r record;
  v_rules jsonb;
  v_arr jsonb;
  v_old_progress jsonb;
  v_new_progress jsonb;
  v_progress_obj jsonb;
  v_orch jsonb;
  v_old_id constant text := 'goal_1790089821922_2wamf';
  v_new_id constant text := 'goal_job';
BEGIN
  FOR r IN
    SELECT id, stage_completed_rules
    FROM public.instagram_conversations
    WHERE (stage_completed_rules->'completed_goals') ? v_old_id
       OR (stage_completed_rules#>'{orchestration,completedGoalIds}') ? v_old_id
       OR stage_completed_rules#>ARRAY['objective_progress', v_old_id] IS NOT NULL
       OR stage_completed_rules#>ARRAY['orchestration','objectiveProgress', v_old_id] IS NOT NULL
  LOOP
    v_rules := CASE
      WHEN jsonb_typeof(r.stage_completed_rules) = 'object' THEN r.stage_completed_rules
      ELSE '{}'::jsonb
    END;

    IF jsonb_typeof(v_rules->'completed_goals') = 'array' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(mapped) ORDER BY first_ord), '[]'::jsonb)
      INTO v_arr
      FROM (
        SELECT CASE WHEN value = v_old_id THEN v_new_id ELSE value END AS mapped,
               min(ord) AS first_ord
        FROM jsonb_array_elements_text(v_rules->'completed_goals') WITH ORDINALITY AS e(value, ord)
        GROUP BY CASE WHEN value = v_old_id THEN v_new_id ELSE value END
      ) dedup;
      v_rules := jsonb_set(v_rules, '{completed_goals}', v_arr, true);
    END IF;

    v_orch := CASE
      WHEN jsonb_typeof(v_rules->'orchestration') = 'object' THEN v_rules->'orchestration'
      ELSE '{}'::jsonb
    END;

    IF jsonb_typeof(v_orch->'completedGoalIds') = 'array' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(mapped) ORDER BY first_ord), '[]'::jsonb)
      INTO v_arr
      FROM (
        SELECT CASE WHEN value = v_old_id THEN v_new_id ELSE value END AS mapped,
               min(ord) AS first_ord
        FROM jsonb_array_elements_text(v_orch->'completedGoalIds') WITH ORDINALITY AS e(value, ord)
        GROUP BY CASE WHEN value = v_old_id THEN v_new_id ELSE value END
      ) dedup;
      v_orch := jsonb_set(v_orch, '{completedGoalIds}', v_arr, true);
    END IF;

    v_progress_obj := CASE
      WHEN jsonb_typeof(v_rules->'objective_progress') = 'object' THEN v_rules->'objective_progress'
      ELSE '{}'::jsonb
    END;
    v_old_progress := v_progress_obj->v_old_id;
    v_new_progress := v_progress_obj->v_new_id;
    IF v_old_progress IS NOT NULL THEN
      IF v_new_progress IS NULL
         OR (
           COALESCE(v_old_progress->>'status','') = 'completed'
           AND COALESCE(v_new_progress->>'status','') <> 'completed'
         ) THEN
        v_old_progress := jsonb_set(v_old_progress, '{objectiveId}', to_jsonb(v_new_id), true);
        v_progress_obj := jsonb_set(v_progress_obj, ARRAY[v_new_id], v_old_progress, true);
      END IF;
      v_progress_obj := v_progress_obj - v_old_id;
      v_rules := jsonb_set(v_rules, '{objective_progress}', v_progress_obj, true);
    END IF;
    v_progress_obj := CASE
      WHEN jsonb_typeof(v_orch->'objectiveProgress') = 'object' THEN v_orch->'objectiveProgress'
      ELSE '{}'::jsonb
    END;
    v_old_progress := v_progress_obj->v_old_id;
    v_new_progress := v_progress_obj->v_new_id;
    IF v_old_progress IS NOT NULL THEN
      IF v_new_progress IS NULL
         OR (
           COALESCE(v_old_progress->>'status','') = 'completed'
           AND COALESCE(v_new_progress->>'status','') <> 'completed'
         ) THEN
        v_old_progress := jsonb_set(v_old_progress, '{objectiveId}', to_jsonb(v_new_id), true);
        v_progress_obj := jsonb_set(v_progress_obj, ARRAY[v_new_id], v_old_progress, true);
      END IF;
      v_progress_obj := v_progress_obj - v_old_id;
      v_orch := jsonb_set(v_orch, '{objectiveProgress}', v_progress_obj, true);
    END IF;

    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

    UPDATE public.instagram_conversations
    SET stage_completed_rules = v_rules
    WHERE id = r.id;
  END LOOP;
END;
$$;
