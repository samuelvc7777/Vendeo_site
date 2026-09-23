-- Migration local: índice em last_message_at para otimizar ORDER BY na listagem de conversas
-- ATENÇÃO: NÃO aplicar remotamente sem revisão do usuário.
--
-- Problema atual:
--   getConversations() usa ORDER BY last_message_at DESC mas o único índice existente é
--   em updated_at. Resultado: SeqScan + quicksort de 794KB para 517 linhas.
--   Com crescimento da tabela este custo sobe proporcionalmente.
--
-- Solução:
--   Índice parcial excluindo status='vault' (linhas de sistema que nunca aparecem na UI).
--   CONCURRENTLY: não bloqueia escritas durante a criação.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instagram_conversations_last_msg
  ON public.instagram_conversations(last_message_at DESC NULLS LAST)
  WHERE status IS DISTINCT FROM 'vault';

-- Índice auxiliar para EXISTS do cron: usa created_at (diferente de timestamp)
-- O cron usa: WHERE created_at > now() - interval '48 hours' AND is_mine IS FALSE
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instagram_messages_inbound_created
  ON public.instagram_messages(conversation_id, created_at DESC)
  WHERE is_mine IS FALSE;
