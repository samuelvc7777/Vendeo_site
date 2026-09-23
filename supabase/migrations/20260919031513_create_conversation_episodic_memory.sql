CREATE TABLE IF NOT EXISTS public.conversation_episodic_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL,
    actor TEXT NOT NULL CHECK (actor IN ('larissa', 'pretendente')),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'question',
        'answer',
        'statement',
        'self_disclosure',
        'fact_reveal',
        'topic',
        'audio_sent',
        'reaction',
        'plan',
        'preference_reveal'
    )),
    topic TEXT NULL,
    summary TEXT NOT NULL,
    source_message_id TEXT NULL,
    source_message_ids TEXT[] NULL,
    original_text TEXT NULL,
    semantic_keys TEXT[] DEFAULT '{}'::text[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conv_episodic_conv_created ON public.conversation_episodic_memory(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_conv_actor ON public.conversation_episodic_memory(conversation_id, actor);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_conv_event ON public.conversation_episodic_memory(conversation_id, event_type);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_conv_topic ON public.conversation_episodic_memory(conversation_id, topic);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_semantic_keys ON public.conversation_episodic_memory USING GIN(semantic_keys);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_source_msg ON public.conversation_episodic_memory(conversation_id, source_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_episodic_msg_event 
    ON public.conversation_episodic_memory(conversation_id, source_message_id, event_type) 
    WHERE source_message_id IS NOT NULL;

ALTER TABLE public.conversation_episodic_memory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'conversation_episodic_memory' 
        AND policyname = 'Permitir leitura de conversation_episodic_memory'
    ) THEN
        CREATE POLICY "Permitir leitura de conversation_episodic_memory"
        ON public.conversation_episodic_memory
        FOR SELECT
        USING (true);
    END IF;
END $$;
;
