# Identidade canônica compartilhada entre canais

**Estado:** aceita para orientar o plano; sujeita a revisão se a auditoria de migrações ou de fluxo de WhatsApp contradisser as premissas. O Vendeo manterá uma identidade canônica estável em `instagram_conversations` e ligará IDs externos de Tinder/WhatsApp a ela por uma relação explícita de canais, preservando o progresso e as FKs existentes. Não será feita uma migração ampla para uma tabela nova, pois o banco ativo tem 18 FKs apontando para a tabela atual; telefone coincidente nunca causará merge silencioso. A escolha reduz o risco de migrar o write model atual, mas exige que ingestão e despacho resolvam o vínculo externo em vez de presumir IDs `wa2:<chatId>` para todas as conversas.

## Premissas verificadas

- `instagram_conversations.channel` e `instagram_messages.channel` atualmente aceitam `instagram`, `whatsapp` e `whatsapp2`; não aceitam `tinder`.
- O projeto Supabase ativo tem 1.260 conversas: 518 Instagram, 38 WhatsApp legado e 704 WhatsApp2.
- Há 18 constraints de chave estrangeira apontando para `instagram_conversations`.
- O WhatsApp2 atualmente gera sua própria identidade canônica `wa2:<chatId>` em `whatsapp2ConversationId` e os RPCs de saída atualizam/criam linhas e mensagens com essa identidade.
- A rota Tinder atual faz leitura sob demanda e envio manual; não persiste mensagens no modelo canônico nem despacha para o Brain.
- Uma migração aplicada no banco, `20261006133505_manual_only_schedule_completion`, não está presente no checkout atual e precisa ser reconciliada antes de gerar novas migrações.

## Consequências

- A implementação deve conservar a mesma chave de conversa Brain, sessão, memória e checkpoints durante a associação Tinder → WhatsApp.
- A tabela de vínculos precisa impor unicidade por provedor/conta/identidade externa e suportar resoluções concorrentes.
- Os RPCs de ingestão e projeção WhatsApp precisam encontrar a identidade canônica por vínculo, com o comportamento legado inalterado quando não houver vínculo.
- A ação do Brain precisa carregar o destino de canal escolhido; `instagram_conversations.channel` sozinho não deve decidir uma resposta semântica em conversa multi-canal.
- A colisão entre telefone já associado e pessoa existente permanece bloqueada até existir regra de produto para identidade/merge.
