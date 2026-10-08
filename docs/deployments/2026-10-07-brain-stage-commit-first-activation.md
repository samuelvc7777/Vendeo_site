# Resposta gerada sem envio na primeira ativação

## Causa comprovada

Na primeira ativação, `ensureConversationScheduleRuntime` inicializa `current_stage_id` depois da leitura inicial da conversa. O commit da decisão utilizava o valor anterior em `expectedCurrentStageId`. A comparação atômica do PostgreSQL rejeitava a transação com `semantic commit lost current stage CAS`, antes de persistir decisão e outbox. O ramo de falha liberava o ciclo, mas não publicava o erro na projeção do chat.

## Correção publicada

Os commits de resposta e de espera/resolução manual agora usam a etapa da leitura feita após o claim. A proteção contra alterações concorrentes continua ativa. Falhas na persistência da resposta registram o motivo e o ciclo, e publicam o estado `failed` com um evento operacional.

Supabase Edge Function `api`, versão 519, publicada em 07/10/2026. O pacote foi criado a partir dos 45 arquivos recuperados da versão 518 em produção, alterando somente `brain_orchestrator.ts`.

## Verificação

`node --test tests/test_brain_stage_commit_snapshot.mjs` reproduziu quatro falhas antes da correção e passou os quatro casos após a correção. Exercita os payloads reais dos dois pontos de commit, incluindo etapa inicializada e preservação do snapshot para concorrência.

A resposta pendente da conversa indicada pelo operador foi retomada pelo endpoint oficial de tentativa manual. O runtime recuperou o mesmo plano aceito, com `openai_execution_recovered=true`, mesma resposta do provedor e tentativa de execução 1. Os dois textos foram enviados e confirmados pelo WhatsApp, com IDs do provedor. Não foi criada uma nova resposta pelo modelo durante a recuperação.
