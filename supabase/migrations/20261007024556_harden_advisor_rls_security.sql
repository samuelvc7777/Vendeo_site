-- ============================================================================
-- Migration: 20261006200000_harden_advisor_rls_security.sql
-- Objetivo: Fechar vulnerabilidades de segurança apontadas pelo Supabase Advisor (RLS desativado)
--           nas tabelas operacionais do backend:
--           1. public.whatsapp2_delivery_queue
--           2. public.whatsapp2_gateway_config
--           3. public.openai_conversation_links
--           4. public.openai_message_receipts
-- Autoridade: ADR 0004 e Auditoria de Segurança Fase 0 (T0.6)
-- Acesso: Exclusivo para service_role (Edge Functions e Gateway interno).
--         Bloqueio total para papéis públicos anon e authenticated.
-- ============================================================================

-- 1. whatsapp2_delivery_queue
ALTER TABLE IF EXISTS public.whatsapp2_delivery_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_whatsapp2_delivery_queue" ON public.whatsapp2_delivery_queue;
CREATE POLICY "service_role_manage_whatsapp2_delivery_queue"
  ON public.whatsapp2_delivery_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.whatsapp2_delivery_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp2_delivery_queue TO service_role;


-- 2. whatsapp2_gateway_config
ALTER TABLE IF EXISTS public.whatsapp2_gateway_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_whatsapp2_gateway_config" ON public.whatsapp2_gateway_config;
CREATE POLICY "service_role_manage_whatsapp2_gateway_config"
  ON public.whatsapp2_gateway_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.whatsapp2_gateway_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp2_gateway_config TO service_role;


-- 3. openai_conversation_links
ALTER TABLE IF EXISTS public.openai_conversation_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_openai_conversation_links" ON public.openai_conversation_links;
CREATE POLICY "service_role_manage_openai_conversation_links"
  ON public.openai_conversation_links
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.openai_conversation_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.openai_conversation_links TO service_role;


-- 4. openai_message_receipts
ALTER TABLE IF EXISTS public.openai_message_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_openai_message_receipts" ON public.openai_message_receipts;
CREATE POLICY "service_role_manage_openai_message_receipts"
  ON public.openai_message_receipts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.openai_message_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.openai_message_receipts TO service_role;
