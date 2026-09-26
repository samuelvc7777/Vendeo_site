-- stage_completed_rules is a JSON object that stores orchestration state.
-- The previous one-time normalization did not change the column default,
-- so newly-created conversations could still receive [] and break JSON paths.

ALTER TABLE public.instagram_conversations
  ALTER COLUMN stage_completed_rules SET DEFAULT '{}'::jsonb;

-- The affected production rows were empty arrays; normalize only that exact,
-- data-free legacy value. Preserve every non-empty value as-is.
UPDATE public.instagram_conversations
SET stage_completed_rules = '{}'::jsonb
WHERE stage_completed_rules = '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.normalize_stage_completed_rules_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(NEW.stage_completed_rules) IS DISTINCT FROM 'object' THEN
    NEW.stage_completed_rules := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_stage_completed_rules_before_insert
  ON public.instagram_conversations;

CREATE TRIGGER trg_normalize_stage_completed_rules_before_insert
  BEFORE INSERT ON public.instagram_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_stage_completed_rules_before_insert();
