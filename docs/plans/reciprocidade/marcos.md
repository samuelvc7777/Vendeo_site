# Marcos da análise de reciprocidade

Origem: [especificação #3](https://github.com/samuelvc7777/Vendeo_site/issues/3) e [ticket #4](https://github.com/samuelvc7777/Vendeo_site/issues/4).

Estado: investigação e regra de recorte concluídas para o ticket #4. Em 03/11/2026, após a explicação da opção de usar toda a conversa desde a primeira mensagem, o usuário escolheu explicitamente “toda cv”. A implementação dos tickets dependentes deve seguir o contrato abaixo; a issue #4 permanece aberta até a integração do PR.

## Fontes e limites

O código foi consultado na `main`, revisão `aa90524bcddb2b7e188c222224a19fda81d4a2dd`, por `git show` e `git grep`. Arquivos pendentes do checkout de trabalho e branches históricas não foram usados como base oficial.

O agente coordenador consultou somente configuração e metadados do projeto Supabase `wsdualhvopidgqcumonr` em 03/11/2026. Não foram consultados conteúdos de chats, enviados contatos, alterados dados ou executadas migrações. A configuração abaixo é um retrato dessa leitura; a implementação deverá consultar a configuração canônica vigente, sem fixar esta lista no código.

## Checklist confirmado na configuração atual

A etapa `stage_1_conexao` tem nome atual **Inicial**, pertence ao cronograma `schedule_sales` (**Venda**) e usa o modo `goal_driven`. Os cinco objetivos habilitados estão marcados como obrigatórios:

| Identificador | Conteúdo ou contrato observado |
| --- | --- |
| `goal_initial_greeting` | Saudação inicial; ação `send_text_and_audio`, conclusão `delivery_confirmed` |
| `goal_city` | Cidade |
| `goal_job` | Profissão / trabalho |
| `goal_1790089822342_oi2ym` | Idade |
| `goal_1790089822697_ojxwm` | Hobbies |

O objetivo de áudio de interesse `goal_1793368641135_qs1gb` está desabilitado e não integra o checklist ativo. `goal_initial_reciprocity` não existe na configuração atual consultada; o objetivo histórico não pode ser usado como classificação nem gatilho isolado.

O catálogo versionado de setembro difere da configuração atual. A migração `supabase/migrations/20260927045446_restore_canonical_chat_stage_catalog.sql:8` registra Conexão Inicial com reciprocidade inicial, cidade e trabalho, mas preserva configurações e IDs customizados. Ela é antecedente histórico, não prova de que a produção usa apenas aqueles três objetivos.

A identidade estável da etapa e seu vínculo ao cronograma devem prevalecer sobre nomes de exibição. A conclusão completa exige progresso persistido para todos os objetivos habilitados desse checklist, respeitando a política de conclusão de cada um; não basta a saudação, o primeiro objetivo ou apenas estar em etapa posterior.

## Não confundir com janela de conexão

O outro cronograma ativo consultado, `schedule_1791256441827_wf3q3`, chama-se **Continuar a conexao**, usa `connection_window` e não tinha etapas na consulta. Ele não é o checklist inicial confirmado acima.

O contrato do código também distingue os modos. A migração `supabase/migrations/20261006060603_connection_window_arsenal.sql:23` converte cronogramas pós-venda em janelas e, a partir da linha 31, remove seus objetivos e obrigatoriedade. A etapa interna de compatibilidade criada a partir da linha 41 não possui checkpoints. Arsenal é opcional, não checklist. `supabase/migrations/20261006101932_harden_connection_window_runtime.sql:5` preserva Venda como `goal_driven`.

## Autoridade do progresso e cuidados para o gatilho

- `src/domain/entities/ChatStage.ts` define `StageObjective` com `enabled`, `required`, ordem e política de conclusão, e `ChatStage` com `objectives` e o alias `goals`.
- `src/application/use-cases/ManageChatProgressUseCase.ts:111` filtra os objetivos habilitados e resolve conclusão por IDs ou estado detalhado. Sua variável `is100Percent` considera apenas os obrigatórios pendentes. Na configuração consultada todos os habilitados são obrigatórios, mas essa coincidência pode mudar: a especificação pede o checklist inteiro, portanto não se deve usar a flag como substituto permanente desse contrato.
- `supabase/functions/api/brain_orchestrator.ts:1191` documenta `stage_completed_rules.completed_goals` como autoridade primária e `orchestration.completedGoalIds` como espelho/fallback. O repositório frontend usa outra prioridade em `src/infrastructure/repositories/SupabaseChatStageRepository.ts:385`; o disparo backend precisa partir do estado persistido confirmado, não de uma contagem visual em memória.
- A antiga associação entre checklist e pasta do Cofre foi removida por `supabase/migrations/20261006052220_remove_stage_vault_legacy.sql`. O ADR antigo sobre checklist de pastas não descreve o contrato atual.

## Investigação dos marcos técnicos existentes

A pesquisa no código oficial por `interaction_id`, `interactionId`, `interaction_started`, `interactionStarted`, `interaction_start` e `interactionStart`, em `src`, funções e migrações, não retornou ocorrências. A consulta do coordenador ao `information_schema` de `public` também não retornou colunas com `interaction` no nome. Isso não prova ausência de todo campo JSON possível, mas não foi encontrado contrato persistido inequívoco que delimite a interação semântica atual.

Os marcos existentes têm outra finalidade:

| Marco existente | Evidência e limitação |
| --- | --- |
| `conversation_schedule_runs.started_at` | `supabase/migrations/20261006022055_conversation_schedules.sql:186`: o RPC reutiliza um run ativo ou cria um run com o horário da chamada, nas linhas 305–323. Pode ser posterior ao começo das mensagens. |
| Novo run após troca de cronograma | `supabase/migrations/20261006033859_manual_conversation_schedule_switch.sql:80`: cancela o run anterior e cria outro com `started_at` novo. Troca de cronograma não comprova uma nova interação. |
| `activation_watermark` | `supabase/migrations/20261023155700_restart_clears_activation_watermark.sql`: o reinício técnico remove o campo quando há mensagem recebida para reprocessar. Não é uma fronteira imutável. |
| `openai_conversation_links.created_at` | `supabase/migrations/20260928233539_openai_conversation_runtime.sql:3`: registra um vínculo técnico da sessão persistente, sem contrato de início semântico. |
| `ai_debounce_started_at` | `supabase/migrations/20260928100551_finalize_brain_architecture_alignment.sql:5`: representa um lote de debounce e é limpo ao término; não delimita uma interação inteira. |

Não adotar silêncio, ativação da IA, criação de run ou reinício do Brain como regra implícita de corte.

## Identidade canônica e transferência de canal

`docs/adr/0004-canonical-conversation-across-channels.md` estabelece a conversa canônica estável em `instagram_conversations`, com vínculos explícitos entre canais e sem junção por telefone coincidente. A migração `supabase/migrations/20261007024535_tinder_multichannel_identities.sql:26` cria as identidades de canal; a partir da linha 56 registra transferências. A função de associação recusa vínculo existente com outra conversa, inclusive nas linhas 198–210.

Para este recurso, a identidade da interação é a própria conversa canônica. Transferências autorizadas preservam essa identidade e incorporam apenas os canais explicitamente vinculados e autorizados. Reinícios técnicos não geram nova interação nem reiniciam a deduplicação da análise.

## Decisão aprovada: toda a conversa disponível

Em 03/11/2026, o usuário respondeu **“toda cv”** à opção explicada como toda a conversa desde a primeira mensagem. Para a análise de reciprocidade, a interação corresponde à relação/conversa canônica inteira disponível no escopo autorizado.

O recorte começa na primeira mensagem disponível dessa conversa e inclui as falas dos dois lados. Não há segmentação por silêncio, ativação da IA, cronograma, reinício técnico ou sessão do Brain, nem ação de abertura de uma nova interação para este recurso. Chats antigos não precisam de seleção ou confirmação manual de uma mensagem inicial.

No início de cada execução, fixar a última mensagem incluída e manter esse limite estável. Mensagens recebidas depois entram somente em outra avaliação. Persistir os identificadores e o intervalo efetivamente analisados, informar lacunas e indisponibilidade de conteúdo e não truncar histórico silenciosamente.

A identidade usada para a deduplicação por interação é a conversa canônica, junto ao marco confirmado do checklist para a execução automática. Transferência autorizada não reinicia essa identidade. Somente mensagens dos canais explicitamente vinculados à conversa e pertencentes ao escopo autorizado podem participar do histórico; coincidência de telefone não autoriza incorporar outra pessoa ou conversa.

Não é necessário criar um marcador de início semântico para liberar os tickets dependentes. A proposta anterior de início explícito pelo operador e confirmação manual de início em chats antigos foi substituída pela decisão de analisar toda a conversa disponível.

## Elegibilidade e validação

Um chat antigo precisa de escopo autorizado, identidade canônica resolvida e comprovação persistida da conclusão do checklist alvo. A etapa `stage_1_conexao` tem cinco objetivos habilitados no retrato acima, mas a implementação deve obter dinamicamente os objetivos habilitados da configuração canônica. Uma etapa posterior sozinha não comprova que todos os objetivos foram concluídos. A primeira análise desses chats será solicitada manualmente, sem seleção de mensagem inicial e sem backfill automático em massa.

O teste do fluxo deverá verificar conclusão parcial e completa, eventos repetidos, reinício técnico, transferência autorizada, chegada de mensagens durante execução, inclusão de toda a conversa disponível desde a primeira mensagem e isolamento entre contas. Nenhum desses testes foi implementado ou executado nesta investigação documental; não houve alteração do comportamento da aplicação nem publicação.
