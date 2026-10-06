-- Migration: Cleanup de tabelas órfãs de Tinder e Badoo e desativação de RPC legado do WhatsApp 1
-- ATENÇÃO: NENHUM dado do WhatsApp Legado (38 conv / 1.044 msgs), WhatsApp 2 ou Instagram é apagado!

-- 1. Remoção do RPC de ingestão do WhatsApp 1 legado (Meta Cloud API) sem consumidores no runtime
DROP FUNCTION IF EXISTS public.ingest_whatsapp_inbound_atomic(
  text, text, text, text, text, text, text, text,
  text, text, text, text, text, boolean
);

-- 2. Remoção fail-safe das tabelas órfãs e vazias (0 registros comprovados) de Tinder e Badoo.
-- Sem CASCADE: se existir qualquer dependência inesperada, a execução aborta imediatamente por segurança.
-- Nota: No PostgreSQL 17, o DROP TABLE remove automaticamente o registro das tabelas da publicação supabase_realtime.
DROP TABLE IF EXISTS public.tinder_messages;
DROP TABLE IF EXISTS public.tinder_conversations;
DROP TABLE IF EXISTS public.tinder_config;
DROP TABLE IF EXISTS public.badoo_messages;
DROP TABLE IF EXISTS public.badoo_conversations;
DROP TABLE IF EXISTS public.badoo_config;

-- 3. Atualização das constraints de canal para refletir os canais suportados e históricos preservados:
-- 'instagram', 'whatsapp' (legado preservado com 38 conversas e 1.044 mensagens) e 'whatsapp2' (atual)
ALTER TABLE public.instagram_conversations
  DROP CONSTRAINT IF EXISTS instagram_conversations_channel_check;

ALTER TABLE public.instagram_conversations
  ADD CONSTRAINT instagram_conversations_channel_check
  CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text]));

ALTER TABLE public.instagram_messages
  DROP CONSTRAINT IF EXISTS instagram_messages_channel_check;

ALTER TABLE public.instagram_messages
  ADD CONSTRAINT instagram_messages_channel_check
  CHECK (channel = ANY (ARRAY['instagram'::text, 'whatsapp'::text, 'whatsapp2'::text]));
