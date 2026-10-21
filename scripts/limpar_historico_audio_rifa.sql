-- Script para limpar o histórico de entrega do áudio "Oferecendo a rifa"
-- Isso tornará o áudio elegível novamente para envio nas conversas.

DO $$
DECLARE
    v_audio_id UUID;
    v_audio_title TEXT := 'Oferecendo a rifa';
BEGIN
    -- 1. Encontrar o ID do áudio pelo título
    SELECT id INTO v_audio_id
    FROM persona_audios
    WHERE title = v_audio_title
    LIMIT 1;

    IF v_audio_id IS NULL THEN
        RAISE NOTICE 'Áudio com título "%" não encontrado.', v_audio_title;
        RETURN;
    END IF;

    RAISE NOTICE 'Encontrado áudio ID: %', v_audio_id;

    -- 2. Limpar tabela audio_delivery_history
    DELETE FROM audio_delivery_history
    WHERE audio_id = v_audio_id;
    
    RAISE NOTICE 'Registros removidos de audio_delivery_history.';

    -- 3. Limpar JSONB stage_completed_rules em instagram_conversations
    -- Remove o áudio do array audio_delivery_history dentro do JSONB
    UPDATE instagram_conversations
    SET stage_completed_rules = jsonb_set(
        stage_completed_rules,
        '{audio_delivery_history}',
        (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(stage_completed_rules->'audio_delivery_history') AS elem
            WHERE (elem->>'audioId')::UUID != v_audio_id 
              AND (elem->>'id')::UUID != v_audio_id
        )
    )
    WHERE stage_completed_rules ? 'audio_delivery_history'
      AND (
          stage_completed_rules->'audio_delivery_history' @> jsonb_build_array(jsonb_build_object('audioId', v_audio_id))
          OR stage_completed_rules->'audio_delivery_history' @> jsonb_build_array(jsonb_build_object('id', v_audio_id))
      );

    -- Remove o áudio do array orchestration.deliveredAudios dentro do JSONB
    UPDATE instagram_conversations
    SET stage_completed_rules = jsonb_set(
        stage_completed_rules,
        '{orchestration,deliveredAudios}',
        (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(stage_completed_rules->'orchestration'->'deliveredAudios') AS elem
            WHERE elem::TEXT != to_json(v_audio_id)::TEXT
              AND (elem->>'id')::TEXT != to_json(v_audio_id)::TEXT
        )
    )
    WHERE stage_completed_rules ? 'orchestration'
      AND stage_completed_rules->'orchestration' ? 'deliveredAudios'
      AND (
          stage_completed_rules->'orchestration'->'deliveredAudios' @> to_json(v_audio_id)::jsonb
          OR stage_completed_rules->'orchestration'->'deliveredAudios' @> jsonb_build_array(jsonb_build_object('id', v_audio_id))
      );

    RAISE NOTICE 'Histórico limpo com sucesso. O áudio "%" está elegível novamente.', v_audio_title;
END $$;