-- Migration: Tabela conversation_episodic_memory para Memória Episódica da Conversa
-- Armazena representações compactas e semânticas de eventos ocorridos entre Larissa e cada pretendente.

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
    metadata JSONB DEFAULT '{}'::jsonb,
    episode_fingerprint TEXT NULL
);

-- Índices de consulta, ordenação e isolamento de segurança
CREATE INDEX IF NOT EXISTS idx_conv_episodic_conv_created ON public.conversation_episodic_memory(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_conv_actor ON public.conversation_episodic_memory(conversation_id, actor);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_conv_event ON public.conversation_episodic_memory(conversation_id, event_type);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_conv_topic ON public.conversation_episodic_memory(conversation_id, topic);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_semantic_keys ON public.conversation_episodic_memory USING GIN(semantic_keys);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_source_msg ON public.conversation_episodic_memory(conversation_id, source_message_id);
CREATE INDEX IF NOT EXISTS idx_conv_episodic_fingerprint ON public.conversation_episodic_memory(conversation_id, episode_fingerprint);

-- Idempotência estrita: impede duplicações em retries usando episode_fingerprint determinístico
-- Permite múltiplos eventos do mesmo tipo para a mesma mensagem mantendo o source_message_id original intacto
ALTER TABLE public.conversation_episodic_memory 
    DROP CONSTRAINT IF EXISTS uq_conv_episodic_msg_event;
ALTER TABLE public.conversation_episodic_memory 
    DROP CONSTRAINT IF EXISTS uq_conv_episodic_fingerprint;
ALTER TABLE public.conversation_episodic_memory 
    ADD CONSTRAINT uq_conv_episodic_fingerprint UNIQUE (conversation_id, episode_fingerprint);

-- Habilita Row Level Security (RLS)
ALTER TABLE public.conversation_episodic_memory ENABLE ROW LEVEL SECURITY;

-- Política de Leitura Pública / Autenticada / Service Role
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
