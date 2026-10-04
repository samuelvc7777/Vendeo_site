-- Migration: Reconnect Tinder integration to Brain Architecture v2
-- 1. Permite canal 'tinder' nas tabelas unificadas do Brain
ALTER TABLE public.instagram_conversations DROP CONSTRAINT IF EXISTS instagram_conversations_channel_check;
ALTER TABLE public.instagram_conversations ADD CONSTRAINT instagram_conversations_channel_check 
  CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text, 'tinder'::text]));

ALTER TABLE public.instagram_messages DROP CONSTRAINT IF EXISTS instagram_messages_channel_check;
ALTER TABLE public.instagram_messages ADD CONSTRAINT instagram_messages_channel_check 
  CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text, 'tinder'::text]));

-- 2. Tabela de configuração do Tinder (Sessão & Perfil do Operador)
CREATE TABLE IF NOT EXISTS public.tinder_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auth_token TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.tinder_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir acesso total a tinder_config" ON public.tinder_config;
CREATE POLICY "Permitir acesso total a tinder_config" ON public.tinder_config FOR ALL USING (true);

-- 3. Tabela de cache dedicado de conversas do Tinder
CREATE TABLE IF NOT EXISTS public.tinder_conversations (
  match_id TEXT PRIMARY KEY,
  person_id TEXT,
  name TEXT,
  birth_date TEXT,
  bio TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  last_message_preview TEXT,
  last_message_at TIMESTAMPTZ,
  last_direction TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.tinder_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir acesso total a tinder_conversations" ON public.tinder_conversations;
CREATE POLICY "Permitir acesso total a tinder_conversations" ON public.tinder_conversations FOR ALL USING (true);

-- 4. Tabela de cache dedicado de mensagens do Tinder
CREATE TABLE IF NOT EXISTS public.tinder_messages (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_date TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  status TEXT DEFAULT 'sent',
  deliver_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.tinder_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir acesso total a tinder_messages" ON public.tinder_messages;
CREATE POLICY "Permitir acesso total a tinder_messages" ON public.tinder_messages FOR ALL USING (true);

-- 5. Índices de alta performance
CREATE INDEX IF NOT EXISTS idx_tinder_messages_match_id ON public.tinder_messages(match_id, sent_date);
CREATE INDEX IF NOT EXISTS idx_tinder_conversations_last_at ON public.tinder_conversations(last_message_at DESC);

-- 6. Adição às publicações Realtime do Supabase de forma defensiva
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tinder_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tinder_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tinder_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tinder_conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tinder_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tinder_config;
  END IF;
END $$;
