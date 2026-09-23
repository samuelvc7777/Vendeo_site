ALTER TABLE public.conversation_episodic_memory 
  ADD COLUMN IF NOT EXISTS episode_fingerprint TEXT NULL;

ALTER TABLE public.conversation_episodic_memory 
  DROP CONSTRAINT IF EXISTS uq_conv_episodic_msg_event;

UPDATE public.conversation_episodic_memory
  SET episode_fingerprint = conversation_id || '::' || COALESCE(source_message_id, id::text) || '::' || actor || '::' || event_type || '::' || COALESCE(topic, 'general')
  WHERE episode_fingerprint IS NULL;

ALTER TABLE public.conversation_episodic_memory 
  DROP CONSTRAINT IF EXISTS uq_conv_episodic_fingerprint;
ALTER TABLE public.conversation_episodic_memory 
  ADD CONSTRAINT uq_conv_episodic_fingerprint UNIQUE (conversation_id, episode_fingerprint);

CREATE INDEX IF NOT EXISTS idx_conv_episodic_fingerprint 
  ON public.conversation_episodic_memory(conversation_id, episode_fingerprint);;
