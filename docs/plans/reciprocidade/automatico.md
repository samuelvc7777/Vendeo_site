# Disparo automático da análise de reciprocidade

Implementação do ticket #6, dependente da primeira análise manual (#5). A migração apenas registra marcos futuros; não consulta conversas antigas para criar eventos e não ativa o recurso em produção.

## Contrato

O trigger observa a atualização persistida de `stage_completed_rules`. Ele compara o estado anterior e posterior sob a mesma configuração canônica de `stage_1_conexao` em `schedule_sales`, usando o helper já existente no #5. Somente a passagem de incompleto para todos os objetivos habilitados concluídos registra um evento. Objetivos opcionais habilitados também contam; desabilitados não. Campos oficiais vazios não são substituídos por espelhos antigos. O evento contém o catálogo e apenas os campos de progresso necessários como evidência do marco, sem copiar outbox ou outros dados operacionais.

A identidade é toda a conversa canônica, conforme a decisão “toda cv”. Há um único marco automático por conversa durante sua existência. Reinício técnico, transferência autorizada, reabertura/conclusão do checklist e troca de nome da etapa não criam um segundo evento. A mudança de configuração sozinha não faz backfill. Conversas que já tinham todo o checklist concluído antes da instalação permanecem elegíveis à primeira análise manual.

O evento e a conclusão são persistidos na mesma transação. O trigger não chama OpenAI, serviços externos ou variáveis de ambiente. Ausência de configuração de análise não interfere na persistência normal do atendimento. Falhas estruturais do banco seguem a atomicidade normal; não são ocultadas descartando eventos.

## Cron e escopos

O entrypoint `processReciprocityAutomaticEvents({supabase,scopes,openAiKey,providerOptions})` deve ser chamado pelo cron autenticado da API, antes do processamento normal da fila de análises. Ele percorre no máximo vinte marcos pendentes por escopo autorizado em uma invocação, sem polling ou dependência do navegador. A seleção filtra escopo antes do limite para evitar que eventos de outras contas bloqueiem o progresso. O store ainda revalida a autorização atual de cada conversa antes do preflight e do agendamento.

Sem chave OpenAI ou sem escopos, não consome eventos. Configuração e disponibilidade do modelo são consultadas antes do enqueue, da mesma forma que a primeira análise manual. Uma falha de preflight é registrada como primeira tentativa falha, visível ao operador e recuperável pela solicitação explícita de nova tentativa. O cron não repete automaticamente uma chamada com falha nem troca o modelo.

Cada escopo explicitamente autorizado possui seu próprio recibo e resultado. O agendamento e o recibo são gravados atomicamente por uma RPC que compartilha o lock do enqueue manual. Uma análise manual já ativa pode satisfazer o marco; a RPC associa seu ID ao evento e não altera seu estado, inclusive se houver falha de preflight concorrente. Repetir o evento após queda ou após conclusão retorna a mesma tentativa, evitando uma nova chamada. A execução da avaliação continua revalidando o escopo pelo worker do #5.

## Verificação e limites

Testes SQL aplicam as migrações reais em PGlite e verificam transição parcial/completa, configuração dinâmica, objetivos opcionais/desabilitados, espelhos contraditórios, rollback, ausência de backfill, avanço de etapa, reabertura, recibo associado a manual ativa, repetição após conclusão, falha recuperável, separação de escopos e privilégios. Testes do worker usam store real com fronteiras Supabase/OpenAI simuladas para verificar autorização, configuração efetiva, ausência de chamada de avaliação, falhas e múltiplos escopos.

PGlite valida SQL e atomicidade em uma instância de teste; não comprova carga nem concorrência entre sessões remotas. Não foram enviados contatos, consultados chats reais, instaladas migrações ou realizados deploys. A integração do entrypoint ao cron pertence à branch integradora do PR.
