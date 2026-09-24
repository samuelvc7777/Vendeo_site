-- Corrige replays do webhook: o mesmo message_id nunca pode avançar
-- inboundRevision mais de uma vez nem rearmar o Brain.
CREATE OR REPLACE FUNCTION record_inbound_message_atomic(
  p_conversation_id text,
  p_message_id text,
  p_contact_id text,
  p_sender_id text,
  p_text text,
  p_timestamp text,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL,
  p_reply_to_message_id text DEFAULT NULL,
  p_audio_transcript text DEFAULT NULL,
  p_audio_transcription_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_orch jsonb;
  v_current_rev int;
  v_new_rev int;
  v_ledger jsonb;
  v_msg_revs jsonb;
  v_existing_msg_rev int;
  v_auto_respond boolean;
  v_is_restricted boolean;
  v_watermark jsonb;
  v_watermark_rev int;
  v_eligible_after_activation boolean;
  v_message_already_exists boolean := false;
BEGIN
  -- Serializa admissão inbound com ativação/preempção da conversa.
  SELECT stage_completed_rules, COALESCE(ai_auto_respond, false), COALESCE(is_restricted, false)
  INTO v_rules, v_auto_respond, v_is_restricted
  FROM instagram_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'conversation_not_found',
      'conversation_exists', false,
      'eligible_after_activation', false
    );
  END IF;

  -- Verifica replay ANTES do upsert. O lock da conversa torna esta checagem
  -- determinística entre webhooks concorrentes da mesma conversa.
  SELECT EXISTS(
    SELECT 1 FROM instagram_messages WHERE id = p_message_id
  ) INTO v_message_already_exists;

  -- Mantém metadados/transcrição atualizáveis mesmo quando o provider reenvia
  -- o mesmo evento, sem transformar esse replay em uma nova inbound lógica.
  INSERT INTO instagram_messages (
    id, conversation_id, contact_id, sender_id, text, timestamp,
    is_mine, status, media_url, media_type, reply_to_message_id,
    direction, audio_transcript, audio_transcribed_at, audio_transcription_error,
    created_at
  ) VALUES (
    p_message_id, p_conversation_id, p_contact_id, p_sender_id, p_text, p_timestamp,
    false, 'delivered', p_media_url, p_media_type, p_reply_to_message_id,
    'inbound', p_audio_transcript, CASE WHEN p_audio_transcript IS NOT NULL THEN NOW() ELSE NULL END, p_audio_transcription_error,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    text = EXCLUDED.text,
    audio_transcript = COALESCE(EXCLUDED.audio_transcript, instagram_messages.audio_transcript),
    audio_transcription_error = EXCLUDED.audio_transcription_error,
    media_url = COALESCE(EXCLUDED.media_url, instagram_messages.media_url),
    media_type = COALESCE(EXCLUDED.media_type, instagram_messages.media_type),
    reply_to_message_id = COALESCE(EXCLUDED.reply_to_message_id, instagram_messages.reply_to_message_id);

  v_rules := COALESCE(v_rules, '{}'::jsonb);
  v_orch := COALESCE(v_rules->'orchestration', '{}'::jsonb);
  v_current_rev := COALESCE((v_orch->>'inboundRevision')::int, 0);
  v_msg_revs := COALESCE(v_orch->'messageInboundRevisions', '{}'::jsonb);
  v_watermark := v_orch->'activation_watermark';

  IF v_watermark IS NOT NULL AND (v_watermark ? 'inboundRevision') THEN
    v_watermark_rev := (v_watermark->>'inboundRevision')::int;
  ELSE
    v_watermark_rev := NULL;
  END IF;

  IF v_message_already_exists THEN
    BEGIN
      v_existing_msg_rev := NULLIF(v_msg_revs->>p_message_id, '')::int;
    EXCEPTION WHEN OTHERS THEN
      v_existing_msg_rev := NULL;
    END;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'inbound_revision', v_current_rev,
      'message_inbound_revision', v_existing_msg_rev,
      'ai_auto_respond', v_auto_respond,
      'is_restricted', v_is_restricted,
      'watermark_revision', v_watermark_rev,
      'eligible_after_activation', false
    );
  END IF;

  v_new_rev := v_current_rev + 1;

  v_orch := jsonb_set(v_orch, '{inboundRevision}', to_jsonb(v_new_rev));
  v_msg_revs := jsonb_set(v_msg_revs, ARRAY[p_message_id], to_jsonb(v_new_rev), true);
  v_orch := jsonb_set(v_orch, '{messageInboundRevisions}', v_msg_revs);

  v_ledger := COALESCE(v_orch->'messageLedger', '{}'::jsonb);
  v_ledger := jsonb_set(v_ledger, ARRAY[p_message_id], '"pending"'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger);

  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch);

  UPDATE instagram_conversations
  SET stage_completed_rules = v_rules
  WHERE id = p_conversation_id;

  v_eligible_after_activation := (
    v_auto_respond AND
    NOT v_is_restricted AND
    (v_watermark_rev IS NULL OR v_new_rev > v_watermark_rev)
  );

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'inbound_revision', v_new_rev,
    'message_inbound_revision', v_new_rev,
    'ai_auto_respond', v_auto_respond,
    'is_restricted', v_is_restricted,
    'watermark_revision', v_watermark_rev,
    'eligible_after_activation', v_eligible_after_activation
  );
END;
$$;

REVOKE ALL ON FUNCTION record_inbound_message_atomic(text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inbound_message_atomic(text, text, text, text, text, text, text, text, text, text, text) TO service_role, authenticated, anon;
