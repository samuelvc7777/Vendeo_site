-- Configuração do operador, sem alteração de schema ou progresso dos contatos.
-- Exceção restrita ao objetivo de áudio da etapa Rifa configurada em produção.
UPDATE public.chat_stages AS stage
SET goals = (
  SELECT jsonb_agg(
    CASE WHEN goal->>'id' = 'goal_1790861876963_d8oti'
      AND goal->>'actionType' = 'send_audio'
    THEN jsonb_set(goal, '{actionConfig}',
      coalesce(goal->'actionConfig', '{}'::jsonb) ||
      '{"maxStageTurns":4,"allowAudioTemporalMismatch":true}'::jsonb)
    ELSE goal END ORDER BY position
  )
  FROM jsonb_array_elements(stage.goals) WITH ORDINALITY AS items(goal, position)
), updated_at = now()
WHERE stage.id = 'stage_1790861775316_am5wy'
  AND stage.name = 'Rifa'
RETURNING id, name, goals;
