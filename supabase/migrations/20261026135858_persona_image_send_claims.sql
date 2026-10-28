CREATE TABLE IF NOT EXISTS public.persona_image_send_claims (
  conversation_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  delivery_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'sent', 'uncertain')),
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, image_id)
);
ALTER TABLE public.persona_image_send_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.persona_image_send_claims FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_image_send_claims TO service_role;

CREATE OR REPLACE FUNCTION public.claim_persona_image_send(p_conversation_id TEXT, p_image_id TEXT, p_delivery_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing public.persona_image_send_claims%ROWTYPE;
  image public.persona_images%ROWTYPE;
  local_time TEXT := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');
  inserted_count INTEGER;
BEGIN
  IF coalesce(p_conversation_id, '') = '' OR coalesce(p_image_id, '') = '' OR coalesce(p_delivery_key, '') = '' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_image_claim');
  END IF;
  SELECT * INTO existing FROM persona_image_send_claims WHERE conversation_id = p_conversation_id AND image_id = p_image_id;
  IF FOUND THEN
    IF existing.delivery_key <> p_delivery_key OR existing.state = 'uncertain' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'image_already_sent_or_reserved');
    END IF;
    IF existing.state = 'sent' THEN
      RETURN jsonb_build_object('allowed', true, 'alreadySent', true, 'providerMessageId', existing.provider_message_id);
    END IF;
  END IF;
  SELECT * INTO image FROM persona_images WHERE id = p_image_id AND enabled = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'reason', 'image_disabled_or_missing'); END IF;
  IF image.allowed_time_start IS NOT NULL OR image.allowed_time_end IS NOT NULL THEN
    IF image.allowed_time_start IS NULL OR image.allowed_time_end IS NULL OR
       image.allowed_time_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR image.allowed_time_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_image_time_window');
    END IF;
    IF NOT (CASE WHEN image.allowed_time_start <= image.allowed_time_end
      THEN local_time BETWEEN image.allowed_time_start AND image.allowed_time_end
      ELSE local_time >= image.allowed_time_start OR local_time <= image.allowed_time_end END) THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'image_outside_time_window');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM image_delivery_history WHERE conversation_id = p_conversation_id AND image_id = p_image_id) OR EXISTS (
    SELECT 1 FROM instagram_messages m WHERE m.conversation_id = p_conversation_id AND m.is_mine = true AND m.media_type = 'image' AND (
      m.media_url IN (image.image_url, image.whatsapp_image_url)
      OR strpos(coalesce(m.text, ''), '[image:' || image.image_url || ']') > 0
      OR (coalesce(m.attachment_metadata->>'fileName', m.attachment_metadata->>'file_name', '') <> '' AND
          coalesce(m.attachment_metadata->>'fileName', m.attachment_metadata->>'file_name') IN (
            regexp_replace(split_part(image.image_url, '?', 1), '^.*/', ''), regexp_replace(split_part(image.whatsapp_image_url, '?', 1), '^.*/', '')))
    )
  ) THEN RETURN jsonb_build_object('allowed', false, 'reason', 'image_already_delivered'); END IF;
  INSERT INTO persona_image_send_claims(conversation_id, image_id, delivery_key)
    VALUES (p_conversation_id, p_image_id, p_delivery_key) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 1 THEN RETURN jsonb_build_object('allowed', true); END IF;
  SELECT * INTO existing FROM persona_image_send_claims WHERE conversation_id = p_conversation_id AND image_id = p_image_id;
  RETURN jsonb_build_object('allowed', existing.delivery_key = p_delivery_key AND existing.state = 'reserved',
    'reason', CASE WHEN existing.delivery_key = p_delivery_key AND existing.state = 'reserved' THEN NULL ELSE 'image_already_sent_or_reserved' END);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_persona_image_send(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_persona_image_send(TEXT, TEXT, TEXT) TO service_role;
;
