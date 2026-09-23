ALTER TABLE public.conversation_episodic_memory DROP CONSTRAINT IF EXISTS uq_conv_episodic_msg_event;
DROP INDEX IF EXISTS public.uq_conv_episodic_msg_event;
ALTER TABLE public.conversation_episodic_memory ADD CONSTRAINT uq_conv_episodic_msg_event UNIQUE (conversation_id, source_message_id, event_type);;
