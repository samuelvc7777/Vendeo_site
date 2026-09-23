CREATE TABLE IF NOT EXISTS public.chat_stages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stage_order INTEGER NOT NULL DEFAULT 0,
    color TEXT NULL,
    icon TEXT NULL,
    description TEXT NULL,
    goals JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now())
);

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

CREATE TABLE IF NOT EXISTS public.vault_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NULL,
    icon TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now())
);

CREATE TABLE IF NOT EXISTS public.vault_items (
    id TEXT PRIMARY KEY,
    folder_id TEXT REFERENCES public.vault_folders(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NULL,
    media_url TEXT NULL,
    duration NUMERIC NULL,
    file_size BIGINT NULL,
    file_name TEXT NULL,
    mime_type TEXT NULL,
    linked_item_id TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now())
);

CREATE TABLE IF NOT EXISTS public.persona_audios (
    id TEXT PRIMARY KEY,
    stage_id TEXT NULL,
    title TEXT NOT NULL,
    audio_url TEXT NOT NULL,
    duration INTEGER NULL,
    transcript TEXT NOT NULL DEFAULT '',
    usage_instruction TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now())
);

CREATE TABLE IF NOT EXISTS public.audio_delivery_history (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    audio_id TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Sao_Paulo'::text, now()),
    provider_message_id TEXT NULL
);

ALTER TABLE public.chat_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subagent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persona_audios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_delivery_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Permitir leitura de chat_stages" ON public.chat_stages;
    CREATE POLICY "Permitir leitura de chat_stages" ON public.chat_stages FOR SELECT USING (true);
    DROP POLICY IF EXISTS "Permitir escrita de chat_stages" ON public.chat_stages;
    CREATE POLICY "Permitir escrita de chat_stages" ON public.chat_stages FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Permitir leitura de subagent_definitions" ON public.subagent_definitions;
    CREATE POLICY "Permitir leitura de subagent_definitions" ON public.subagent_definitions FOR SELECT USING (true);
    DROP POLICY IF EXISTS "Permitir escrita de subagent_definitions" ON public.subagent_definitions;
    CREATE POLICY "Permitir escrita de subagent_definitions" ON public.subagent_definitions FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Permitir leitura de vault_folders" ON public.vault_folders;
    CREATE POLICY "Permitir leitura de vault_folders" ON public.vault_folders FOR SELECT USING (true);
    DROP POLICY IF EXISTS "Permitir escrita de vault_folders" ON public.vault_folders;
    CREATE POLICY "Permitir escrita de vault_folders" ON public.vault_folders FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Permitir leitura de vault_items" ON public.vault_items;
    CREATE POLICY "Permitir leitura de vault_items" ON public.vault_items FOR SELECT USING (true);
    DROP POLICY IF EXISTS "Permitir escrita de vault_items" ON public.vault_items;
    CREATE POLICY "Permitir escrita de vault_items" ON public.vault_items FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Permitir leitura de persona_audios" ON public.persona_audios;
    CREATE POLICY "Permitir leitura de persona_audios" ON public.persona_audios FOR SELECT USING (true);
    DROP POLICY IF EXISTS "Permitir escrita de persona_audios" ON public.persona_audios;
    CREATE POLICY "Permitir escrita de persona_audios" ON public.persona_audios FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Permitir leitura de audio_delivery_history" ON public.audio_delivery_history;
    CREATE POLICY "Permitir leitura de audio_delivery_history" ON public.audio_delivery_history FOR SELECT USING (true);
    DROP POLICY IF EXISTS "Permitir escrita de audio_delivery_history" ON public.audio_delivery_history;
    CREATE POLICY "Permitir escrita de audio_delivery_history" ON public.audio_delivery_history FOR ALL USING (true) WITH CHECK (true);
END $$;;
