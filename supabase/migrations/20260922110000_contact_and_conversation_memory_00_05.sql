-- ==============================================================================
-- Migration: 20260922110000_contact_and_conversation_memory_00_05.sql
-- Descrição: Tabelas canônicas e seguras para Contact Memory e Conversation Memory
--            com Capability Scopes efêmeros, fingerprints determinísticos de idempotência
--            e constraints enumeradas.
-- ==============================================================================

-- 1. Tabela de Escopos Efêmeros de Memória do Agente (Capability Scopes)
CREATE TABLE IF NOT EXISTS public.agent_memory_scopes (
  scope_id text PRIMARY KEY,
  conversation_id text NOT NULL,
  cycle_id text NOT NULL,
  agent_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_scopes_conv 
  ON public.agent_memory_scopes (conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_scopes_active 
  ON public.agent_memory_scopes (scope_id) 
  WHERE revoked_at IS NULL;

-- 2. Tabela Canônica de Fatos do Contato (01 - Sobre)
CREATE TABLE IF NOT EXISTS public.contact_memory_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL,
  entity text NOT NULL DEFAULT 'self',
  field text NOT NULL,
  value jsonb NOT NULL,
  normalized_value text NOT NULL,
  temporal_status text NOT NULL DEFAULT 'durable'
    CONSTRAINT chk_contact_facts_temporal_status 
    CHECK (temporal_status IN ('durable', 'temporal', 'event', 'plan', 'superseded')),
  valid_from timestamptz NULL,
  valid_until timestamptz NULL,
  source_message_ids text[] NOT NULL,
  source_actor text NOT NULL DEFAULT 'pretendente'
    CONSTRAINT chk_contact_facts_source_actor 
    CHECK (source_actor IN ('pretendente', 'larissa')),
  confidence double precision NOT NULL DEFAULT 1.0,
  importance double precision NOT NULL DEFAULT 0.5,
  fact_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
  superseded_by_id uuid REFERENCES public.contact_memory_facts(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT uq_contact_memory_fact_fingerprint UNIQUE (conversation_id, fact_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_contact_facts_conv_entity 
  ON public.contact_memory_facts (conversation_id, entity, temporal_status);
CREATE INDEX IF NOT EXISTS idx_contact_facts_conv_field 
  ON public.contact_memory_facts (conversation_id, field);
CREATE INDEX IF NOT EXISTS idx_contact_facts_fts 
  ON public.contact_memory_facts USING gin (to_tsvector('portuguese', normalized_value));

-- 3. Tabela Canônica de Citações / Frases Marcantes (01 - Sobre)
CREATE TABLE IF NOT EXISTS public.contact_memory_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL,
  speaker text NOT NULL DEFAULT 'pretendente'
    CONSTRAINT chk_contact_quotes_speaker 
    CHECK (speaker IN ('pretendente', 'larissa')),
  quote_text text NOT NULL,
  normalized_quote text NOT NULL,
  context_or_reason text NULL,
  source_message_id text NOT NULL,
  importance double precision NOT NULL DEFAULT 0.5,
  quote_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT uq_contact_memory_quote_fingerprint UNIQUE (conversation_id, quote_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_contact_quotes_conv 
  ON public.contact_memory_quotes (conversation_id, created_at DESC);

-- 4. Evolução Segura de conversation_episodic_memory (Open Loops e Relevância)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversation_episodic_memory' AND column_name = 'loop_status'
  ) THEN
    ALTER TABLE public.conversation_episodic_memory 
      ADD COLUMN loop_status text NULL,
      ADD CONSTRAINT chk_conv_episodic_loop_status 
        CHECK (loop_status IS NULL OR loop_status IN ('open', 'closed', 'dropped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversation_episodic_memory' AND column_name = 'resolved_at'
  ) THEN
    ALTER TABLE public.conversation_episodic_memory 
      ADD COLUMN resolved_at timestamptz NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversation_episodic_memory' AND column_name = 'resolution_message_id'
  ) THEN
    ALTER TABLE public.conversation_episodic_memory 
      ADD COLUMN resolution_message_id text NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversation_episodic_memory' AND column_name = 'importance'
  ) THEN
    ALTER TABLE public.conversation_episodic_memory 
      ADD COLUMN importance double precision DEFAULT 0.5;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conv_episodic_open_loops 
  ON public.conversation_episodic_memory (conversation_id, loop_status) 
  WHERE loop_status IS NOT NULL;
