-- Migration: Criar tabela dedicada public.subagent_definitions para Catálogo de Subagentes
-- Fonte de verdade única no Supabase para subagentes canônicos e personalizados.

-- 1. Criação da Tabela
CREATE TABLE IF NOT EXISTS public.subagent_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mission TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false,
    description TEXT NULL,
    stage_ids TEXT[] NULL DEFAULT '{}'::text[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now())
);

-- 2. Índices para Otimização de Consultas e Roteamento
CREATE INDEX IF NOT EXISTS idx_subagent_definitions_enabled ON public.subagent_definitions(enabled);
CREATE INDEX IF NOT EXISTS idx_subagent_definitions_system ON public.subagent_definitions(is_system);

-- 3. Gatilho para Atualização Automática de updated_at
CREATE OR REPLACE FUNCTION update_subagent_definitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('America/Sao_Paulo'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subagent_definitions_updated_at ON public.subagent_definitions;
CREATE TRIGGER trg_subagent_definitions_updated_at
    BEFORE UPDATE ON public.subagent_definitions
    FOR EACH ROW
    EXECUTE FUNCTION update_subagent_definitions_updated_at();

-- 4. Proteção de Sistema: Bloqueio estrito no PostgreSQL contra exclusão de subagentes canônicos (is_system = true)
CREATE OR REPLACE FUNCTION prevent_system_subagent_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_system = true THEN
        RAISE EXCEPTION 'Subagentes canônicos de sistema (%) não podem ser excluídos.', OLD.id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_system_subagent_delete ON public.subagent_definitions;
CREATE TRIGGER trg_prevent_system_subagent_delete
    BEFORE DELETE ON public.subagent_definitions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_system_subagent_delete();

-- 5. Configuração de Row Level Security (RLS)
ALTER TABLE public.subagent_definitions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'subagent_definitions' 
        AND policyname = 'Permitir leitura de subagent_definitions'
    ) THEN
        CREATE POLICY "Permitir leitura de subagent_definitions"
        ON public.subagent_definitions
        FOR SELECT
        USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'subagent_definitions' 
        AND policyname = 'Permitir gerenciamento de subagent_definitions'
    ) THEN
        CREATE POLICY "Permitir gerenciamento de subagent_definitions"
        ON public.subagent_definitions
        FOR ALL
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- 6. Carga Inicial (Seed Idempotente) dos 3 Subagentes Canônicos
INSERT INTO public.subagent_definitions (id, name, mission, enabled, is_system, created_at, updated_at)
VALUES
    (
        'conexao_inicial',
        'Conexão inicial',
        'Criar conforto, reciprocidade e um começo natural de conversa, sem transformar o contato em entrevista nem antecipar assuntos profundos.',
        true,
        true,
        timezone('America/Sao_Paulo'::text, now()),
        timezone('America/Sao_Paulo'::text, now())
    ),
    (
        'descoberta',
        'Descoberta',
        'Conhecer organicamente quem o pretendente é, sua rotina, vida, trabalho, gostos e contexto pessoal, aproveitando naturalmente os assuntos que surgem.',
        true,
        true,
        timezone('America/Sao_Paulo'::text, now()),
        timezone('America/Sao_Paulo'::text, now())
    ),
    (
        'compatibilidade',
        'Compatibilidade',
        'Entender valores, momento de vida, visão de relacionamento, família, planos e compatibilidade com Larissa, somente quando houver abertura natural para assuntos mais pessoais.',
        true,
        true,
        timezone('America/Sao_Paulo'::text, now()),
        timezone('America/Sao_Paulo'::text, now())
    )
ON CONFLICT (id) DO UPDATE SET
    is_system = true,
    updated_at = timezone('America/Sao_Paulo'::text, now());
