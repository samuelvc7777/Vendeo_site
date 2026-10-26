-- Adiciona coluna reaction_context ao cofre de finalização para categorizar
-- itens por tipo de reação pós-pitch da rifa (interesse, recusa, insistência, etc.)
-- Isso permite que a IA consulte automaticamente o item correto baseado na intenção detectada.

ALTER TABLE whatsapp_finalization_vault_items
ADD COLUMN IF NOT EXISTS reaction_context TEXT;

COMMENT ON COLUMN whatsapp_finalization_vault_items.reaction_context IS
  'Categoria semântica da reação: raffle_interest_response, raffle_refusal_empathy, raffle_insistence_soft, raffle_confirmation, raffle_ghost_reminder. NULL = item genérico (uso manual).';

-- Índice parcial para filtragem rápida pela IA (ignora NULLs)
CREATE INDEX IF NOT EXISTS idx_finalization_vault_reaction_context
ON whatsapp_finalization_vault_items(reaction_context)
WHERE reaction_context IS NOT NULL;