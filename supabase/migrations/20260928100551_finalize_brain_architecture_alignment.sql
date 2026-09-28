-- Finaliza os gaps arquiteturais restantes do Brain.
-- 1) Mantém o início do lote de debounce separado do prazo móvel.
-- 2) Preserva o catálogo manual, removendo apenas duplicidade de profissão criada por migrações canônicas.

ALTER TABLE public.instagram_conversations
  ADD COLUMN IF NOT EXISTS ai_debounce_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_ai_debounce_started_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ai_debounce_until IS NULL THEN
    NEW.ai_debounce_started_at := NULL;
  ELSIF OLD.ai_debounce_until IS NULL THEN
    NEW.ai_debounce_started_at := COALESCE(NEW.ai_debounce_started_at, now());
  ELSIF NEW.ai_debounce_started_at IS NULL THEN
    NEW.ai_debounce_started_at := OLD.ai_debounce_started_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ai_debounce_started_at ON public.instagram_conversations;
CREATE TRIGGER trg_sync_ai_debounce_started_at
BEFORE UPDATE OF ai_debounce_until, ai_debounce_started_at
ON public.instagram_conversations
FOR EACH ROW
EXECUTE FUNCTION public.sync_ai_debounce_started_at();

UPDATE public.instagram_conversations
SET ai_debounce_started_at = now()
WHERE ai_debounce_until IS NOT NULL
  AND ai_debounce_started_at IS NULL;

UPDATE public.instagram_conversations
SET stage_completed_rules = jsonb_set(
  CASE WHEN jsonb_typeof(stage_completed_rules) = 'object' THEN stage_completed_rules ELSE '{}'::jsonb END,
  '{config,maxDebounceWindowMinutes}',
  '3'::jsonb,
  true
)
WHERE id = '__autopilot_config__'
  AND NOT (
    COALESCE(
      (CASE WHEN jsonb_typeof(stage_completed_rules) = 'object' THEN stage_completed_rules ELSE '{}'::jsonb END) #> '{config}',
      '{}'::jsonb
    ) ? 'maxDebounceWindowMinutes'
  );

DO $$
DECLARE
  v_legacy_ids text[];
  v_min_order integer;
BEGIN
  SELECT array_agg(goal->>'id'),
         min(COALESCE(NULLIF(goal->>'order', '')::integer, 0))
  INTO v_legacy_ids, v_min_order
  FROM public.chat_stages s
  CROSS JOIN LATERAL jsonb_array_elements(s.goals) AS configured(goal)
  WHERE s.id = 'stage_1_conexao'
    AND lower(COALESCE(goal->>'memoryField', '')) IN ('profession', 'occupation')
    AND goal->>'id' <> 'goal_job'
    AND COALESCE((goal->>'enabled')::boolean, true);

  IF COALESCE(array_length(v_legacy_ids, 1), 0) > 0 THEN
    UPDATE public.chat_stages AS stage
    SET goals = (
      SELECT jsonb_agg(
        CASE
          WHEN goal->>'id' = ANY(v_legacy_ids)
            THEN jsonb_set(goal, '{enabled}', 'false'::jsonb, true)
          WHEN goal->>'id' = 'goal_job'
            THEN jsonb_set(
              jsonb_set(goal, '{enabled}', 'true'::jsonb, true),
              '{order}', to_jsonb(COALESCE(v_min_order, NULLIF(goal->>'order', '')::integer, 0)), true
            )
          ELSE goal
        END
        ORDER BY ordinality
      )
      FROM jsonb_array_elements(stage.goals) WITH ORDINALITY AS configured(goal, ordinality)
    ),
    updated_at = now()
    WHERE stage.id = 'stage_1_conexao';

    UPDATE public.persona_audios
    SET objective_id = 'goal_job',
        updated_at = now()
    WHERE stage_id = 'stage_1_conexao'
      AND objective_id = ANY(v_legacy_ids);
  END IF;
END;
$$;
