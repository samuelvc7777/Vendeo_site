-- Migration: Tabela persona_memory para Persona Memory estruturada e persistente
CREATE TABLE IF NOT EXISTS public.persona_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id TEXT NOT NULL,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('canonical', 'generated', 'temporal')),
    confidence NUMERIC DEFAULT 1.0,
    aliases TEXT[] DEFAULT '{}'::text[],
    valid_from TIMESTAMPTZ NULL,
    valid_until TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('America/Sao_Paulo'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('America/Sao_Paulo'::text, now()),
    CONSTRAINT uq_persona_memory_persona_key UNIQUE (persona_id, key)
);

-- Índices otimizados para busca direta, busca por categoria e aliases
CREATE INDEX IF NOT EXISTS idx_persona_memory_lookup ON public.persona_memory(persona_id, category);
CREATE INDEX IF NOT EXISTS idx_persona_memory_key ON public.persona_memory(persona_id, key);
CREATE INDEX IF NOT EXISTS idx_persona_memory_aliases ON public.persona_memory USING GIN(aliases);
CREATE INDEX IF NOT EXISTS idx_persona_memory_temporal ON public.persona_memory(valid_from, valid_until);

-- Gatilho para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_persona_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('America/Sao_Paulo'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_persona_memory_updated_at ON public.persona_memory;
CREATE TRIGGER trg_persona_memory_updated_at
    BEFORE UPDATE ON public.persona_memory
    FOR EACH ROW
    EXECUTE FUNCTION update_persona_memory_updated_at();

-- Habilita Row Level Security (RLS)
ALTER TABLE public.persona_memory ENABLE ROW LEVEL SECURITY;

-- Segurança: Apenas leitura para anon/authenticated, escrita restrita a service_role
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'persona_memory' 
        AND policyname = 'Permitir leitura de persona_memory'
    ) THEN
        CREATE POLICY "Permitir leitura de persona_memory"
        ON public.persona_memory
        FOR SELECT
        USING (true);
    END IF;
END $$;
