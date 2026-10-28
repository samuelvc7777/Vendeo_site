# Consolidação da produção — 28/10/2026

**Estado: fontes recuperadas e frontend reproduzido; promoção à main bloqueada por diferenças de contrato. Nenhuma publicação foi realizada.**

## Estado inicial e preservação

A pasta principal estava em `deploy/design-only`, commit `650e3b2d`, com 31 arquivos rastreados modificados e 121 não rastreados. Foram encontrados 26 worktrees anteriores, 19 com mudanças ou arquivos não rastreados, 33 branches locais anteriores e uma tag. A primeira branch desta tarefa elevou a contagem do inventário Git para 34 branches; a segunda elevou o total atual para 35 branches e 28 worktrees. Os 12 refs remotos incluem o alias origin/HEAD.

A main local permanece em `89148629`, sete commits à frente de origin/main `fdca9685`, confirmado diretamente no GitHub. O histórico oficial foi preservado; nenhuma branch histórica foi mesclada.

Backup privado: `E:/backups/Vendeo_git_consolidacao_2026-10-28`. ACL com herança desativada, acesso concedido ao usuário e SYSTEM. Isso restringe acesso local; não constitui criptografia ou cópia fora deste computador.

O bundle `all-refs.bundle` passou em git bundle verify. SHA-256: `7555ffebfe50db84a24ab22f867006ed6a54562c444b51ee611482cc6e6cb360`. Seus 65 objetos de referência foram recuperados e lidos numa cópia privada de verificação; existem refs auxiliares que apontam a árvores, por isso não são 65 branches nem 65 commits. Os dez HEADs destacados também foram recuperados dos bundles individuais. Patches binários staged/unstaged, arquivos pendentes e manifestos SHA-256 estão separados por worktree. Zero divergências entre os hashes das cópias verificadas. Houve 15 falhas de cópia de arquivos bloqueados da sessão WhatsApp ativa; nenhuma sessão foi encerrada para desbloqueá-los. Dependências, caches e saídas reconstruíveis foram excluídos do backup planejado; a primeira passagem preservou também cópias parciais adicionais de caches, sem apagar nada.

## Produção verificada

- Firebase Hosting: `a61062ba6dd63f75`; 86 entradas no release. Os 84 arquivos comuns correspondem ao out do release de cofres. Os dois caminhos reservados de inicialização são respondidos pelo Firebase e divergem dos bytes enviados.
- Reconstrução local: todos os arquivos comuns correspondem após normalizar exclusivamente o BUILD_ID aleatório; JavaScript e CSS correspondem byte a byte. O build usa os parâmetros públicos da cópia de release; valores privados não foram colocados no Git.
- API Supabase: v635, bundle `e9336e076f701463b4dc7664acd926fc523f31fd948448b6ca3ada3e3cfb87e0`, 57 fontes baixadas diretamente.
- vendeo-brain-mcp: v38, fonte remota preservada.
- tinder-match-history: v1, fonte remota preservada.
- tinder-unmessaged-matches: v2, fonte remota preservada.
- raffle-draw: v1, fonte remota preservada.
- tinder-pass: v1, fonte remota preservada.
- Banco: 153 registros de migrações consultados; todos têm arquivo correspondente na consolidação. Também foram preservados schema, funções SQL, políticas, grants, índices, triggers e views. Isso não é dump dos dados. Funções como release_flex_capacity_cycle_if_owned existem no schema mesmo sem um registro homônimo na lista histórica: existência de função e histórico de migração são evidências distintas. Nenhuma migração foi executada.
- Gateway: processos locais nas portas 8788 (awaiting_pairing), 8789 (idle) e 7153 (ready). O arquivo apontado pelo processo ready é igual à fonte oficial e sua modificação precede a inicialização. O túnel publicado responde HTTP 200/idle. O health não fornece hash da memória carregada; a correspondência exata de todo o processo não pode ser provada apenas por esse endpoint. Sessões e processos foram preservados.

## Banco, Storage e sessões

O provedor lista oito backups físicos COMPLETED, incluindo 28/10/2026 às 05:20 UTC (02:20 em São Paulo); PITR está desativado. A restauração não foi ensaiada. Não há pg_dump nem credenciais de conexão direta disponíveis neste ambiente; não foi criado dump local transacional completo. A distinção entre backups físicos, exportação lógica e objetos do Storage segue a documentação oficial: https://supabase.com/docs/guides/platform/backups . Backups físicos gerenciados não são arquivos lógicos baixáveis. Portanto, existe evidência de backup gerenciado, mas a recuperação integral do banco não foi demonstrada. Os arquivos de Storage são verificados separadamente no relatório privado, e não estão incluídos nesses backups físicos do banco.

Storage: 12349/12349 objetos verificados em disco, 0 erros, 0 divergências de tamanho, 0 divergências de hash. Total de 2972512288 bytes. ETag/MD5 conferido em 12349 objetos, com 0 divergências. Referência de listagem inicial: 12.349 objetos; a aplicação continuou ativa durante a cópia, portanto não se trata de snapshot transacional conjunto banco/Storage.

A cópia da sessão ativa é parcial por bloqueios de arquivos do navegador. Não é possível prometer restauração integral dessa sessão a partir da cópia. Não houve logout, reinício de gateway, modificação de conversas ou escrita em dados reais por esta tarefa. Consultas de schema e downloads foram de leitura; testes de escrita utilizaram PGlite ou mocks locais.

## Branches e arquivos

A branch `codex/consolidacao-producao-20261028` parte da main local, com checkpoint de fontes `113d3733`. Recupera o frontend dos cofres publicado, a API e demais funções remotas, 11 SQLs ausentes, o Markdown do prompt extraído do módulo publicado e testes de entrega/persistência. O manifesto separado `production-2026-10-28-manifest.json` registra fontes e versões; o manifesto histórico de 08/10 não foi reescrito. As exceções de formatação são três linhas vazias e quatro finais de arquivo.

A branch adicional `codex/protecoes-main-20261028`, autorizada depois do inventário, parte desse checkpoint e prepara correções para revisão futura. Ela não representa os bytes da API publicada. Recupera autorização por origem, isolamento de conta, confirmação de Boost, tier sem fallback de preço, retry durável Flex, indicador de outbox com CAS e validação de pedidos manuais. Preserva imagens, legendas, visualização única, figurinhas e autoridade SQL de conclusão de objetivos. A política de operações Tinder exige as duas flags também no executor por conta e revalida antes do envio. As rotas antigas de IA por chat continuam retornando 410.

Arquivos alterados no checkpoint de fontes:

- `package-lock.json`
- `package.json`
- `public/wa2-config.json`
- `scripts/build-static-export.mjs`
- `scripts/test-vault-settings-ui.mjs`
- `src/domain/entities/ChatStage.ts`
- `src/domain/entities/ConversationSchedule.ts`
- `src/infrastructure/repositories/SupabasePersonaImageRepository.ts`
- `src/presentation/components/chat/AutoPilotActivityIndicator.tsx`
- `src/presentation/components/chat/ChatStageBar.tsx`
- `src/presentation/components/chat/InstagramChatComposer.tsx`
- `src/presentation/components/chat/InstagramDirect.tsx`
- `src/presentation/components/chat/WhatsAppFinalizationActions.tsx`
- `src/presentation/components/config/AutoPilotConfigManager.tsx`
- `src/presentation/components/config/ChatStagesManager.tsx`
- `src/presentation/components/config/ConfigView.tsx`
- `src/presentation/components/vault/PersonaVaultModal.tsx`
- `src/presentation/hooks/usePersonaImages.ts`
- `supabase/functions/api/autopilot_inbound_queue.ts`
- `supabase/functions/api/brain_operator_auth.ts`
- `supabase/functions/api/brain_orchestrator.ts`
- `supabase/functions/api/brain_private_chat.ts`
- `supabase/functions/api/brain_stickers.ts`
- `supabase/functions/api/index.ts`
- `supabase/functions/api/larissa_canonical_prompt.generated.ts`
- `supabase/functions/api/larissa_canonical_prompt.md`
- `supabase/functions/api/objective_evidence.ts`
- `supabase/functions/api/objective_image_delivery.ts`
- `supabase/functions/api/openai_brain.ts`
- `supabase/functions/api/openai_sdk_brain.ts`
- `supabase/functions/api/openai_usage.ts`
- `supabase/functions/api/persona_image_access.ts`
- `supabase/functions/api/tinder_account_ai.ts`
- `supabase/functions/api/tinder_approach_console.ts`
- `supabase/functions/api/tinder_approach_runtime.ts`
- `supabase/functions/api/tinder_match_routes.ts`
- `supabase/functions/api/tinder_recipient_selection.ts`
- `supabase/functions/api/tinder_schedule_routes.ts`
- `supabase/functions/api/whatsapp2_gateway.ts`
- `supabase/functions/raffle-draw/index.ts`
- `supabase/functions/tinder-match-history/index.ts`
- `supabase/functions/tinder-pass/index.ts`
- `supabase/functions/tinder-unmessaged-matches/index.ts`
- `supabase/migrations/20261024163719_add_auto_close_test_flag.sql`
- `supabase/migrations/20261026094448_brain_saved_stickers.sql`
- `supabase/migrations/20261026131951_add_caption_to_persona_images.sql`
- `supabase/migrations/20261026135858_persona_image_send_claims.sql`
- `supabase/migrations/20261026164509_tinder_text_conversation_schedules.sql`
- `supabase/migrations/20261026171302_tinder_account_ai_settings.sql`
- `supabase/migrations/20261026171837_inbound_context_channel_identity.sql`
- `supabase/migrations/20261026174458_tinder_approach_recipient_selection.sql`
- `supabase/migrations/20261026183811_tinder_approach_executor.sql`
- `supabase/migrations/20261027215317_add_gpt_6_1_terra_schedule_model.sql`
- `supabase/migrations/20261028131229_enforce_delivery_objective_authority.sql`
- `tests/test_delivery_objective_authority.mjs`
- `tests/test_delivery_objective_persistence.mjs`
- `tests/test_objective_audio_deadline.mjs`

## Validação

| Verificação | Resultado |
|---|---|
| Build de produção e TypeScript, consolidação | Passaram |
| Reconstrução x Firebase | 84/84, normalizando somente BUILD_ID |
| Entrega, conclusão/reabertura e persistência SQL | 56/56 passaram |
| Cofres e compositores, Chromium e WebKit | 8 cenários em cada navegador, desktop/móvel, claro/escuro, mocks |
| Suíte main comparativa, com FFmpeg configurado | 527/529, 2 falhas |
| Suíte consolidação, com FFmpeg configurado | 559/578, 19 falhas |
| Suíte branch de proteções | 582/584, 2 falhas |
| Novos testes das guardas Tinder por conta | 6/6 passaram |
| Arquitetura com loader, main | 87/91, 4 falhas |
| Arquitetura com loader, consolidação | 86/91, 5 falhas |
| Arquitetura com loader, proteções | 87/91 aprovações; 4 falhas |
| Build da branch de proteções | Passou, incluindo TypeScript |
| git diff --check | Passou no checkpoint de fontes |

O TypeScript executado pelo build verifica o frontend; o tsconfig exclui supabase. Não foi executado typecheck completo do backend Deno. Nenhum teste foi marcado como ignorado. A suíte operacional de memória exige credencial de serviço e poderia gravar no ambiente remoto; ela falhou por credencial ausente e toda a execução teve bloqueio adicional de rede externa. O binário FFmpeg foi fornecido explicitamente pela instalação local existente. O comando npm de arquitetura original não registra o loader npm: necessário para scripts Deno no Node; as medições acima usam o mesmo conjunto com --import ./scripts/register-loader.mjs. Os logs originais permanecem preservados, incluindo timeouts e erros de ambiente anteriores.

As correções de harness forneceram as funções reais de figurinhas ao VM e alinharam o teste SQL à versão efetivamente aplicada 20261028131229; as guardas, assertions e persistência foram mantidas.

Falhas presentes na main:

- tests\test_e2e_contact_conversation_memory.mjs
- prompt essencial mantém rotina/regras e todo fato retirado tem origem canônica

Falhas adicionais ao comparar a API publicada com a main:

- Brain SDK aplica service_tier configurável sem fallback silencioso para Standard
- uma chave anon longa não autoriza uma origem externa desconhecida
- estado de IA do match informa flags desligadas sem ativar conversa
- preparação da IA recusa sync real enquanto qualquer flag de operação estiver desligada
- CONTRATO 0B: engajamento com a rifa segue reações configuradas e respeita recusa
- Flex 429 stays Flex, no Standard provider fallback
- retry uses durable schedule, no outgoing action duplication
- configuração de sessão antiga precisa ser recriada para receber ferramenta e política
- Brain mantém pesquisa interna sem backend decidir o conteúdo
- preserva o tier configurado no provider e falha sem fallback de preço
- não interfere em recuperação técnica que preserva o mesmo tier
- dispatch publica progresso e fim do envio sem sobrescrever ciclos novos
- 17. Ativação prepara histórico Tinder e cronograma compartilhado sem ligar a IA
- IA Tinder exige sessão e flags antes do toggle
- Boost rejeita consumo sem confirmação explícita
- manual_resolution rejeita pedido de identificador técnico interno
- envio recusa conta diferente da conversa antes de consultar ou alterar a fila

Falhas ainda presentes na branch de proteções (commit b81ff56a):

- tests\test_e2e_contact_conversation_memory.mjs
- prompt essencial mantém rotina/regras e todo fato retirado tem origem canônica

Os quatro testes da API Tinder antiga foram atualizados na segunda branch para o contrato por conta: estado sem flags, recusa de ativação, exigência de sessão e tombstone 410 sem escrita/ativação do Brain compartilhado. As verificações de bloqueio e ausência de chamadas reais foram mantidas com novas fixtures. Outros seis testes verificam combinações de flags, revogação durante processamento e exigência de sessão. Nenhum teste foi ignorado; a branch fiel à produção conserva os testes anteriores. As duas falhas restantes já estão na main.

## Endpoints e limites

GET /api/health retorna HTTP 500 antes de qualquer alteração desta tarefa. O handler da fonte v635, executado isoladamente com fronteiras externas substituídas, retorna undefined para esse GET; OPTIONS retorna 200 tanto localmente quanto remotamente. Falta resposta explícita nessa rota. Isso explica o erro sem provar indisponibilidade das demais rotas. A correção não foi publicada nem incorporada silenciosamente.

A verificação histórica `node scripts/verify-production-baseline.mjs --live` apresenta divergências esperadas frente ao release de outubro: o log foi guardado e os hashes antigos não foram ajustados para forçar aprovação. Não houve teste de restauração de dados, validação Deno completa nem envio real a clientes.

## Limpeza e promoção

A proposta detalhada em `2026-10-28-proposta-limpeza.md` classifica cada branch e worktree, sem excluir nenhum. Diretórios de publicação e experimentos continuam preservados. O procedimento em `../procedimento-desenvolvimento-deploy.md` define o fluxo futuro.

Antes de qualquer promoção: revisar as 17 diferenças entre API e main, avaliar a branch de proteções, revisar os quatro testes Tinder adaptados e suas novas fixtures, resolver ou delimitar as duas falhas preexistentes, revisar os resultados de arquitetura e os limites de recuperação de dados. Só então apresentar a versão validada ao usuário e obter autorização explícita para merge/push na main e tag remota. Reconsultar origin/main e o runtime antes dessas operações. Nenhuma tag de produção nova foi criada.

**Nenhum deploy, push, merge na main, exclusão de branch/worktree, reset, envio real de mensagens, aplicação de migração ou alteração de dados reais foi realizado.**
