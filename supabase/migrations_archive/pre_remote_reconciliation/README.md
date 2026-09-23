# Arquivo de migrations pré-reconciliação

Reconciliação realizada em 23/09/2026. O histórico remoto do projeto Supabase foi
tratado como fonte de verdade. Os SQLs desta pasta eram versões locais que o CLI
considerava `local_only`; foram retirados do diretório ativo para impedir que
migrations históricas fossem reaplicadas em produção.

Os arquivos são preservados para auditoria e não devem ser executados
automaticamente pelo Supabase CLI. Quando identificável, a versão remota
correspondente tem o mesmo objetivo funcional, mas pode ter timestamp e SQL
diferentes; portanto não são considerados equivalentes sem comparação semântica.

Nenhum histórico remoto foi alterado e nenhuma migration deste arquivo foi
aplicada durante a reconciliação.

## Relações conhecidas

- `20260918145000_create_ack_experimental_cycle_preemption.sql` foi substituída por `20260918175728_create_ack_experimental_cycle_preemption.sql`.
- `20260918190000_create_persona_memory.sql` foi substituída por `20260918214448_create_persona_memory.sql`.
- `20260919003000_create_conversation_episodic_memory.sql` foi substituída por `20260919031513_create_conversation_episodic_memory.sql`.
- `20260920150000_official_stages_subagents_vault.sql` foi substituída por `20260920144958_create_official_stages_subagents_vault.sql`.
- As migrations de ciclo/outbox de 20–21/09 foram substituídas pelas versões remotas de 21/09 e pelos hardenings remotos subsequentes.
- `20260922110000_contact_and_conversation_memory_00_05.sql` foi substituída por `20260922104752_contact_and_conversation_memory_00_05.sql`.
- `20260922180000_drop_subagent_definitions.sql` foi substituída por `20260922193849_drop_subagent_definitions.sql`.

As migrations `20260909_create_ai_persona_references.sql` e
`20260913_create_raffles.sql` não possuem correspondente remoto no inventário;
foram arquivadas como legado local e não devem ser reaplicadas sem uma decisão
de produto/schema específica.
