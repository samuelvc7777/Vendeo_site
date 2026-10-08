# Plano de execução — IA no Tinder com continuidade no WhatsApp

**Objetivo:** permitir que a IA seja ativada por match Tinder, use os cronogramas/checkpoints do Vendeo e, por decisão do Brain, tente iniciar a conversa no WhatsApp mantendo identidade, histórico e progresso.  
**Estado atual (2026-10-07):** publicação concluída. As 117 migrations locais correspondem às 117 versões remotas; as seis migrations desta entrega foram registradas em produção. Os grants e RLS das tabelas operacionais e as permissões das RPCs foram verificados. A Edge Function `api` está ACTIVE na v510 e o Hosting `https://vendeo-e755e.web.app` respondeu HTTP 200. `ENABLE_TINDER_LIVE_DISPATCH` e `ENABLE_TINDER_LIVE_SYNC` continuam desligadas. O endpoint de status confirmou que a sessão Tinder anterior precisa ser reconectada com o mesmo token configurado. Ainda faltam conferir o escopo documental do consentimento e executar o teste manual controlado; nenhum tráfego de IA ou envio ao vivo foi ativado nesta publicação.  
**Autoridade:** `CONTEXT.md`.  
**Decisão estrutural:** [ADR 0004](../../adr/0004-canonical-conversation-across-channels.md).

## Contrato de domínio

- Uma conversa canônica pode possuir identidades externas em mais de um canal.
- Canal da mensagem de entrada é dado factual. O Brain produz uma ação explícita com o destino; backend persiste e despacha pelo adaptador.
- A transferência não cria um segundo Brain. A mesma identidade mantém sessão/progresso; o Brain recebe resultados de envio (`sent`, falha confirmada, incerto) e decide o próximo passo.
- Erros técnicos nunca viram texto de conversa no backend. O Brain decide se pergunta se o número está correto, pede outro ou aguarda.
- Nenhum retry cego após `uncertain`; primeiro reconciliar com o provider/outbox.
- Só marcar objetivos como concluídos com a evidência prevista no contrato atual do Brain.
- Nenhum merge automático de conversas baseado apenas em telefone.

## Auditoria inicial e pendências de produção

1. Match atual: `MatchChatModal.tsx` carrega as mensagens ao abrir e envia manualmente por `tinder-client.ts`; não há ingestão do Tinder para o Brain.
2. Tinder backend: `supabase/functions/api/tinder_match_routes.ts` faz busca de mensagens e envio; token fica em `match_tinder_config` com proteção server-side. Não foi encontrado trigger/webhook Tinder no repositório.
3. Brain: `runBrainOrchestration` consulta `instagram_conversations` e `instagram_messages`; dispatcher envia `whatsapp2` para o gateway e trata qualquer outro canal como Meta/Instagram. Tinder não pode ser habilitado antes de tornar dispatch explícito por canal.
4. Dados: na auditoria inicial, o banco restringia `channel` a `instagram`, `whatsapp`, `whatsapp2`, continha 1.260 conversas e 18 FKs para `instagram_conversations`. Após a publicação, as constraints de conversas e mensagens incluem `tinder`; a verificação atual encontrou 20 FKs.
5. Agenda: cronogramas são configurados em `conversation_schedules`/`chat_stages`; `conversation_schedule_runs` usa a identidade canônica de conversa. Isso favorece preservar o mesmo ID, run e checkpoints no handoff.
6. WhatsApp2: `whatsapp2_delivery_queue` registra `pending/sending/sent/failed/uncertain`; o gateway aceita número/chat ID e cria o registro WhatsApp a partir do fluxo de mensagem, mas usa hoje `wa2:<chatId>`. Ainda precisa provar, com número de teste autorizado, quando o provider confirma o chat novo e como resolver erro de destino.
7. Drift: a migration `20261006133505_manual_only_schedule_completion` foi recuperada do histórico remoto para o checkout sem reaplicar DDL. Os nomes/versões das migrations Tinder anteriores também foram reconciliados. A conferência final encontrou 117 versões locais e 117 remotas, sem versões ausentes em qualquer lado.
8. Segurança: migrations de hardening aplicadas. RLS está ativo nas sete tabelas operacionais verificadas, sem `SELECT` para `anon`/`authenticated`; as quatro RPCs Tinder/identidade verificadas não permitem `EXECUTE` para esses papéis e continuam acessíveis a `service_role`. A sessão Match anterior foi invalidada como parte do hardening.
9. Termos oficiais do Tinder (consultados em 2026-10-06): seção 2c, itens 22 e 23, exige consentimento escrito para aplicações de terceiros que interajam diretamente com Tinder/conteúdo dos membros — inclusive IA/ML — e uso da API. O usuário confirmou que possui consentimento; o documento e seu escopo não foram inspecionados neste checkout.
10. A rota Tinder atual busca mensagens apenas sob demanda, quando a interface pede o histórico. Foi implementada sincronização durável em background (`processTinderBackgroundSync`) com cursor persistente, leases concorrentes e deduplicação atômica no banco.

## Pendências antes de ativar o tráfego ao vivo

- **Concluído — migration drift:** 117/117 versões locais e remotas correspondem; não reaplicar migrations já registradas.
- **Concluído — grants e RLS:** tabelas operacionais e RPCs foram conferidas em produção após a publicação.
- **P1 — contrato de envio a número novo:** gateway validado com mock e pronto para teste controlado com conta/número de teste.
- **P1 — ingresso de Tinder sem modal aberto:** implementado com background sync, leases, cursor monotônico e enfileiramento durável no worker do Brain.
- **P0 externo — escopo da autorização do Tinder:** o usuário confirmou que possui consentimento escrito, mas o documento e seu escopo ainda não foram conferidos. Fazer isso antes de ativar sync ou envio ao vivo; usar perfil de teste controlado.
- **P0 operacional — mecanismo de inbound:** background worker integrado via cron/worker e filas duráveis do Supabase.
- **P1 — colisão de identidade:** implementado bloqueio estrito contra merge silencioso (`phone_collision_existing_contact`).

## Tarefas

### Fase 0 — auditoria inicial e segurança de produção

- [x] T0.1 Inspecionar os fluxos Match UI, cliente Tinder e rotas Edge.
- [x] T0.2 Inspecionar Brain, cronograma, run, FKs e outbox WhatsApp2 no código.
- [x] T0.3 Consultar schema, constraints, contagem por canal e histórico de migrations no Supabase ativo `wsdualhvopidgqcumonr`.
- [x] T0.4 Consultar Advisor, policies, grants e usos no código das tabelas envolvidas.
- [x] T0.5 Recuperar do array remoto `schema_migrations.statements` e restaurar a migration ausente `20261006133505` no diretório local sem reaplicá-la.
- [x] T0.6 Validar ACL/RLS remotos, aplicar migrations de hardening e confirmar grants em produção.
- [ ] T0.7 Testar manualmente o comportamento do gateway com destino de teste autorizado (etapa de validação operacional do usuário).
- [x] T0.8 Confirmar com o usuário a existência de consentimento escrito do Tinder.
- [ ] T0.8a Conferir o escopo e registrar evidência do consentimento escrito antes de ativar leitura, processamento por IA ou envio pela API.
- [x] T0.9 Fechar estratégia de inbound compatível com a autorização e política de colisão de telefone.

### Fase 1 — persistência de identidade multi-canal (publicada e verificada em produção)

- [x] T1.1 Criar e verificar a constraint aditiva que habilita `tinder` em `instagram_conversations` e `instagram_messages`, preservando os canais existentes. Verificado em produção.
- [x] T1.2 Criar/verificar a relação de canais (`conversation_id`, channel/provider, conta externa, id externo, estado, timestamps), índices, uniqueness e RLS. Verificado em produção.
- [x] T1.3 Definir/verificar a RPC transacional de vínculo de identidade e restringir `EXECUTE` a `service_role`. Verificado em produção.
- [x] T1.4 Adaptar a ingestão/projeção WhatsApp2 para usar a identidade canônica vinculada quando existir; preservar `wa2:<chatId>` para chats sem vínculo. (Integrado no gateway e testado).
- [x] T1.5 Revalidar integridade do schema remoto: constraints aceitam `tinder`, há 20 FKs para `instagram_conversations`, uniqueness de identidade/transferência presente, RLS ativo e grants restritos.

### Fase 2 — inbound Tinder e ativação por match

- [x] T2.1 Persistir configuração de IA por match/conversa; ativar/desativar sem afetar outros contatos. (O controle Match prepara o estado canônico por conversa e chama a operação atômica padrão do AutoPilot. A API exige sessão Match válida; operação fica bloqueada até ambas as flags de leitura/envio estarem habilitadas.)
- [x] T2.2 Adaptar o reader Tinder para sincronização incremental de mensagens, com cursor/freshness e dedupe por provider message ID; persistir antes de enfileirar. (Implementado localmente em `supabase/functions/api/tinder_sync_service.ts` e no reader de `tinder_match_routes.ts`: percorre `backward_page_token`, deduplica IDs com upsert atômico, para ao cruzar o cursor e falha fechado no limite de 12 páginas em vez de avançar watermark incompleto. Ainda falta validar o formato/ordem real do provider e staging; a flag de leitura permanece desligada.)
- [x] T2.3 Usar `instagram_messages` como histórico canônico com `channel=tinder`, IDs internos namespaced e ordenação estável; o envelope do Brain deve incluir o canal de entrada. (Concluído: `CanonicalMessage` com `channel`, queries e normalizador em `brain_orchestrator.ts` propagam `channel`, e `buildPersistentTurnContext` em `openai_brain.ts` projeta `[MENSAGEM X ... | canal=tinder ...]`).
- [x] T2.4 Reusar locks, fila, debounce limitado e recuperação durável existentes; encontrar caminho de trabalho para mensagem nova com UI fechada. (O cron chama `processTinderBackgroundSync`, persiste mensagens canônicas e enfileira a mensagem inbound em `enqueue_autopilot_inbound_job`; o worker existente chama o Brain. Verificado com testes simulados.)
- [x] T2.5 Inicializar sessão/cronograma existentes sem duplicar o catálogo. (A preparação do match chama `ensure_conversation_schedule_run_atomic` e usa o catálogo compartilhado ativo já empregado pelos outros canais; o prompt canônico orienta o Brain a confirmar idade e cidade e, conforme o cronograma e a conversa, pedir o telefone. A validação com o Brain em staging continua pendente.)
- [ ] T2.6 Tratar ida ao modal, reabertura do app, fetch repetido, atraso de API e mensagens fora de ordem. (A sincronização manual/background tolera gravações concorrentes pelo ID único, o reader usa janela sobreposta e o cursor agora não retrocede quando chega mensagem atrasada; faltam validar reabertura/fetch e turnos tardios com provider e staging.)

### Fase 3 — decisão e dispatch por canal

- [x] T3.1 Estender schema/validador de ação Brain para destino de entrega explícito por ação, compatível com decisões legadas. (Concluído: `OutboundAction` com campo `channel`, prompt canônico documentando formato, `validateConversationBrainPlan` e `createBrainOutboxBatch` preservando `channel` e tipo).
- [x] T3.2 Adicionar adapter Tinder ao dispatcher canônico, usando token server-side; remover qualquer possibilidade de fallback Tinder para Graph API. (O adapter reutiliza o token `auth_token` e o mesmo caminho de envio server-side já usado pela área Match; `ENABLE_TINDER_LIVE_DISPATCH` segue desligada por padrão.)
- [x] T3.3 Persistir ação/outbox antes do envio, reaproveitando idempotência/ordenação/status atual. (Concluído: `createBrainOutboxBatch` e `dispatchOutboxEntry` em `brain_orchestrator.ts`).
- [x] T3.4 Registrar echoes/receipts por `channel` e provider message ID sem conflitar IDs Tinder/WhatsApp. (Concluído: espelho de envio no Brain adota o prefixo namespaced `tinder_msg_${providerMessageId}` alinhado com o leitor incremental do Tinder para evitar duplicatas em `isMine`; receipts do WhatsApp2 no gateway permanecem filtrados estritamente por `channel="whatsapp2"`.)
- [x] T3.5 Enviar ao Brain o resultado factual de entrega e reconciliar `uncertain` sem retry cego. (Falhas e incertezas persistem um evento técnico interno, acordam a fila real e chegam ao Brain sem serem apresentadas como mensagem do pretendente. O dispatcher mantém o bloqueio de retry cego para `uncertain`; teste com mocks.)

### Fase 4 — transferência Tinder → WhatsApp

- [x] T4.1 Definir formato estruturado da decisão do Brain para transferência: destino fornecido pelo contato e conteúdo da primeira mensagem produzido pelo Brain. (Concluído: contrato tipado `transfer_channel` em `OutboundAction`, aceito pelo validador e instruído no prompt do Brain).
- [x] T4.2 Persistir transferência e ação idempotente antes de chamar `whatsapp2_delivery_queue`. (Concluído em `supabase/functions/api/channel_transfer_service.ts`: `executeChannelTransfer` grava em `conversation_channel_transfers` com chave idempotente herdada da outbox).
- [x] T4.3 No retorno confirmado, associar chat WhatsApp à conversa canônica estável e conservar Brain session, schedule run, estágio e checkpoints. (Concluído localmente: usa o número E.164, vincula a identidade canônica e, após o envio, pede ao gateway para salvar o contato na agenda interna do WhatsApp sem sincronizá-lo com a agenda do aparelho. O resultado de salvar contato não reclassifica uma mensagem já entregue; a API real ainda precisa ser validada em staging.)
- [x] T4.4 Em falha confirmada, entregar código/dado ao Brain para que ele decida perguntar se o número está correto ou solicitar outro. (A falha persiste com código/detalhe técnico e aciona um turno do Brain por evento interno tipado; a decisão e o texto continuam sob autoridade do Brain.)
- [x] T4.5 Em incerteza, congelar nova tentativa e reconciliar status do provider antes de continuar. (Concluído: `executeChannelTransfer` e `dispatchOutboxEntry` marcam `uncertain` / `dispatch_uncertain` e bloqueiam retry cego. Se o envio for confirmado pelo provider mas a persistência falhar, retorna `persistence_failed_after_delivery` sem reportar sucesso falso nem duplicar).
- [x] T4.6 Bloquear merge por telefone duplicado até política de identidade aprovada; reentrada por qualquer canal é enviada ao mesmo Brain com canal de entrada como fato. (Concluído: detecção de colisão preserva a conversa existente, rejeita merge com `phone_collision_existing_contact` e gateway roteia via identidade canônica).
- [x] T4.7 Tratar mensagem Tinder tardia durante/após transferência e concorrência de inbound sem turnos duplicados. (Concluído: cursor em `tinder_sync_service.ts` é monotonicamente não-decrescente garantindo que mensagens antigas/atrasadas sejam persistidas sem retroceder o watermark; dedupe atômico impede inbounds repetidos; mensagens tardias nos dois canais coexistem sob a mesma conversa canônica.)

### Fase 5 — interface Match/Inbox

- [x] T5.1 Adicionar toggle de IA por match com estados canônicos e feedback de erro. (Toggle no chat Match, consulta estado persistido e usa a rota atômica padrão do AutoPilot; preparação/ativação falha com feedback e não envia quando as flags estão desligadas.)
- [x] T5.2 Exibir cronograma, etapa e objetivos a partir das mesmas fontes de estado que os outros canais. (A rota de estado lê o schedule run, etapa e checkpoints da conversa canônica; a tela exibe cronograma/etapa quando já inicializados.)
- [x] T5.3 Exibir canais vinculados, status de tentativa WhatsApp (enviado, falha, incerto), resultado de salvar contato e conversa WhatsApp associada. (A rota lê vínculos e a fila do gateway; o modal informa vínculo, transferência e estado separado da agenda.)
- [x] T5.4 Permitir pausa/retomada e abrir chat WhatsApp sem mutações diretas de estado sem passar pelas operações autorizadas. (Pausa/retomada usa a operação atômica padrão do AutoPilot; a abertura resolve IDs diretos por E.164 e JIDs LID somente após o gateway confirmar o telefone associado, com feedback se o gateway estiver desconectado ou não houver correspondência. Teste visual e validação integrada aguardam staging.)
- [x] T5.5 Tratar mobile/desktop, loading, vazio, token expirado e desconexão Tinder/gateway. (Concluído em `MatchChatModal.tsx`: viewport mobile-first adaptativo, tratamento explícito de sessão expirada/desconectada com ações de "Tentar novamente" e "Reconectar no Match", feedback de erro e foco automático; validação visual em dispositivo físico aguarda staging.)

### Fase 6 — verificação e rollout

- [x] T6.1 Testes focados após as correções locais: 77/77 passaram, incluindo adaptadores, segurança de sessão, identidade multicanal, sync, colisões, transferência e entrega WhatsApp2.
- [x] T6.2 Validar remotamente schema, RPCs, constraints, grants e RLS; reconciliar as 117 versões locais/remotas.
- [x] T6.3 E2E com Tinder/WhatsApp simulados para sucesso, falha confirmada, número corrigido, resultado incerto, mensagens nos dois canais e retry (100% de sucesso em `tests/test_channel_transfer_scenarios_simulated.mjs`).
- [x] T6.4 Regressão de alinhamento com a arquitetura do Brain: 11/11 testes passaram nesta rodada.
- [ ] T6.5 Teste manual de ponta a ponta com conta/perfil controlado do operador (pronto para execução pelo usuário no painel).
- [x] T6.6 Publicar a Edge Function corrigida e validar a versão ativa: `api` v510 ACTIVE. Publicar o frontend em Firebase Hosting e confirmar HTTP 200. As flags `ENABLE_TINDER_LIVE_DISPATCH` e `ENABLE_TINDER_LIVE_SYNC` permanecem desligadas até consentimento conferido e teste controlado aprovado.

## Grafo de dependências

`T0.5 + T0.6 + T0.7 → fundação WhatsApp/Vendeo`

`T0.8a (escopo do consentimento) + T0.7 (teste controlado) + T0.9 (inbound e colisões) → ativação gradual das flags`

As migrations e o código foram publicados. A ativação de leitura/envio ao vivo segue separada e depende de conferir o escopo do consentimento e concluir o teste manual com perfil controlado.

## Critérios de conclusão

- Cada inbound tem uma única persistência e um único turno do Brain.
- Match e WhatsApp associados compartilham identidade, memória, sessão/progresso e checkpoints sem recomeçar o cronograma.
- O Brain escolhe conteúdo e canal de cada ação; dispatcher apenas entrega pelo adaptador solicitado.
- Falha de destino retorna ao Brain; o backend nunca fala por ele nem declara número semanticamente inválido.
- Incerteza não causa duplicação; transferências e decisões são auditáveis e recuperáveis.
- Testes não indicam regressão nos fluxos cobertos; ACL/RLS e histórico de migrations já foram reconciliados e registrados. A conclusão do rollout ainda depende do teste manual controlado e da conferência do escopo do consentimento antes de habilitar tráfego ao vivo.

## Referências

- [CONTEXT.md](../../CONTEXT.md)
- [ADR 0004](../../adr/0004-canonical-conversation-across-channels.md)
- [Termos do Tinder em português — seção 2c, itens 22–23](https://policies.tinder.com/terms/intl/pt/)
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Security Advisor: https://supabase.com/docs/guides/observability/advisors
