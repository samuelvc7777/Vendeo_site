-- Tabela para o Cofre de Fotos da Persona (Larissa)
CREATE TABLE IF NOT EXISTS public.persona_images (
  id TEXT PRIMARY KEY,
  objective_id TEXT, -- Vinculo opcional com um objetivo/checkpoint
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  whatsapp_image_url TEXT, -- URL otimizada para WhatsApp se necessário
  description TEXT,
  usage_instruction TEXT DEFAULT '',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_persona_images_objective ON public.persona_images(objective_id);
CREATE INDEX IF NOT EXISTS idx_persona_images_enabled ON public.persona_images(enabled);

-- Tabela para histórico de entrega de imagens
CREATE TABLE IF NOT EXISTS public.image_delivery_history (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  provider_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_image_delivery_history_conversation ON public.image_delivery_history(conversation_id);

-- Habilitar RLS (Row Level Security) se necessário, mas por enquanto vamos deixar aberto para o service role
ALTER TABLE public.persona_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_delivery_history ENABLE ROW LEVEL SECURITY;

-- Políticas simples para permitir acesso via service role (backend)
CREATE POLICY "Allow all access for service role" ON public.persona_images FOR ALL USING (true);
CREATE POLICY "Allow all access for service role" ON public.image_delivery_history FOR ALL USING (true);
