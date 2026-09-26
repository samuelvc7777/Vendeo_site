# Auditoria de viabilidade do Jev no Brain

Data da auditoria: 2026-09-26
Branch: `codex/refatoração`
Estado de referência: `3047e95f83c2be9e60fde66e60b081ec90cda7c6`

Esta auditoria é somente documental. Nenhum SDK, chave, chamada externa, Edge Function, migration, prompt, Agent ou comportamento de produção foi alterado.

## 1. Fluxo real atual

O caminho oficial encontrado no código é:

```text
Instagram webhook / cron / ação operacional
  -> persistência e seleção técnica do inbound
  -> runBrainOrchestration
  -> claim atômico do ciclo e das mensagens
  -> construção de contexto e estado
  -> runOpenAiBrainTurn
  -> OpenAI Agent Session persistente
  -> cofre_audio_search, quando o Agent solicita
  -> plano JSON do Brain
  -> guards determinísticos de schema, intenção, áudio, qualidade e repetição
  -> persistência de memória e estado
  -> durable outbox
  -> claim/dispatch para Meta
```

A entrada HTTP do Instagram persiste mensagens em `src/app/api/instagram/webhook/route.ts`. O processamento automático é encaminhado pelo Edge API em `supabase/functions/api/index.ts`. O ciclo conversacional é conduzido por `runBrainOrchestration`, em `supabase/functions/api/brain_orchestrator.ts:6525`.

O lock, o claim, o debounce, o activation watermark, a preempção, a recuperação de ciclo, a idempotência, o CAS de estado, o outbox, o dispatcher e a reconciliação de `dispatch_uncertain` ficam no backend. Esses mecanismos não são semântica de conversa e não são candidatos a Jev.

A branch mantém `persistentAgentSessionEnabled = true` no caminho atual. A sessão persistente reutiliza o histórico do Agent. Na criação ou recuperação de uma sessão, o código injeta o snapshot da PersonaMemory e, quando necessário, um bootstrap pontual do histórico do banco. Em um turno normal de uma sessão válida, o histórico inteiro não é reenviado.

No modo persistente, `openai_brain.ts` marca:

- `personaMemoryToolEnabled = false`;
- `contactMemoryToolEnabled = false`;
- `conversationMemoryToolEnabled = false`;
- `audioSearchToolEnabled = true`.

A única tool externa conversacional ativa nesse modo é `cofre_audio_search`. Isso é confirmado em `supabase/functions/api/openai_brain.ts:1850` e na construção das instructions persistentes em `supabase/functions/api/openai_agent_instructions.ts:564-679`.

## 2. Mapa A/B/C/D

A classificação abaixo usa a responsabilidade predominante de cada bloco. Alguns trechos misturam integração e transformação; nesses casos classifiquei pelo risco e pela autoridade exercida.

### A — infraestrutura determinística obrigatória

Principais blocos:

- `runBrainOrchestration`: leitura do estado, debounce, lock e encerramento seguro do ciclo;
- `claimExperimentalCycleAtomic`;
- `claimExperimentalCycleMessagesAtomic`;
- `checkFreshnessGate`;
- `ackCyclePreemptionAtomic`;
- `requestBrainCyclePreemptionAtomic`;
- `commitExperimentalCycleAtomic`;
- `releaseExperimentalCycleAtomic`;
- `persistDurableOutboxBatchAtomic`;
- `claimOutboxEntryAtomic`;
- `finalizeOutboxEntryAtomic`;
- `reconcileOutboxEntryAtomic`;
- `dispatchOutboxEntry`;
- `runDurableOutboxDispatcher`;
- `reconcileUncertainOutboxAction`;
- `scheduleNextOutboxDispatch`;
- reservas e histórico de entrega de áudio;
- autorização técnica de áudio, escopo de memória, timestamps, retry e fail-closed;
- persistência do resultado do ciclo e publicação de telemetria.

Responsabilidade: impedir concorrência, perda, duplicação, envio incerto, mistura entre conversas e avanço indevido de estado.

Esses blocos não devem ser movidos para Jev.

### B — transformação determinística

Principais blocos:

- `normalizeToCanonicalMessage`;
- `buildBudgetedRecentContext`;
- `loadMandatoryBrainContextCandidates`;
- `serializeLiveStateForPrompt`;
- `formatConversationContextForModel`;
- `formatContextForConversationAgent`;
- `formatContextForConexaoInicial`;
- `formatContextForDescoberta`;
- `splitIntoBalloons`;
- `normalizeQuestionTextForExactRepeat`;
- validação e normalização do contrato JSON;
- montagem de IDs, escopos, chaves de idempotência e payloads de outbox;
- limite de quatro ações e poda mecânica de conteúdo;
- coleta, normalização e soma de telemetria.

Responsabilidade: converter dados de banco, inbound e resultado do Agent em formatos canônicos e limitados.

Esses blocos devem continuar em código convencional. Um modelo não deve ser usado para ordenar, deduplicar ou validar schema.

### C — interpretação semântica no backend

Há uma camada real e relevante de interpretação semântica no backend:

- `validateBackendQuestionIntentGuard` em `brain_orchestrator.ts:1820`: detecta e protege perguntas diretas, respostas obrigatórias, repetição e orçamento de novas perguntas;
- `detectSpontaneousObjectiveCompletions` em `brain_orchestrator.ts:5517`: procura no texto sinais de profissão, estado civil, filhos e outros dados associados a objetivos;
- `extractFactsFromInboundText` em `brain_orchestrator.ts:6332`: extrai idade, cidade, profissão, veículo e fatos de terceiros usando regex e regras de negação;
- parte de `resolveStageChecklistGoals` em `brain_orchestrator.ts:4261`: decide se metas de estado conversacional ou fatos já podem ser consideradas satisfeitas;
- `resolveOfficialObjectiveProgress` e `processDeterministicStageProgression`: combinam evidência, memória e regras de estágio para decidir progresso operacional;
- `buildObjectiveCandidateEvidence`: transforma correspondências semânticas em evidência candidata para o Brain;
- `searchCofreAudios`: ranqueia candidatos por termos e `when_to_use`, embora a decisão final de usar o áudio fique com o Brain;
- partes de `buildConversationContextForCycle`: selecionam o último turno da Larissa, replies referenciados e conteúdo que será considerado obrigatório;
- classificação de tonalidade, recência, estilo e intenção usada para construir snippets de contexto.

Há duas ressalvas importantes.

Primeiro, essa camada não é uma autoridade única. Muitas heurísticas são apenas pré-processamento, observabilidade ou proteção. O Brain recebe `candidateEvidence`, mas o código exige que ele próprio retorne `objectiveDecision`, `evidenceMessageId`, `turnContract` e o plano final.

Segundo, parte dessas regras é deliberadamente determinística por segurança. A detecção de negação, terceiro citado, origem da mensagem e prova de evidência não deve ser substituída cegamente por uma classificação probabilística.

Esses são os pontos que poderiam ser estudados para um pré-processador semântico barato, desde que o resultado seja somente uma estrutura auxiliar e nunca uma decisão de envio.

### D — decisão conversacional e integração com o Brain

O Brain continua responsável por:

- decidir `pursue`, `defer`, `already_satisfied` ou `none`;
- escolher o gancho humano principal;
- interpretar sinais sociais;
- decidir se consulta o cofre;
- escolher texto, áudio ou combinação;
- formular respostas;
- escolher perguntas;
- definir tom, estilo e quantidade de balões;
- retornar `needsHumanReview`;
- emitir `outboundActions`;
- aplicar a Persona e o DNA conversacional;
- decidir como avançar na conversa.

A integração D inclui também:

- `runOpenAiBrainTurn`;
- criação e reutilização da Session;
- instruções canônicas;
- execução e submissão de resultado de tool;
- recuperação dos items do Turn;
- extração e validação do JSON final;
- retries estruturais da Agents API.

O backend pode rejeitar, podar ou colocar o ciclo em espera por regras técnicas. Ele não deve reescrever a intenção conversacional do Brain para transformá-la em uma segunda política de diálogo.

## 3. Estimativa de linhas

`supabase/functions/api/brain_orchestrator.ts` tem aproximadamente **9.843 linhas** no estado auditado.

A estimativa por responsabilidade predominante é:

| Categoria | LOC aproximadas | Proporção | Observação |
|---|---:|---:|---|
| A — infraestrutura obrigatória | 4.800 | 49% | ciclos, locks, CAS, outbox, dispatch, retry, reservas e persistência |
| B — transformação determinística | 1.250 | 13% | normalização, contexto, schema, payloads e telemetria |
| C — semântica no backend | 1.350 | 14% | intents, fatos, evidência, objetivos, afinidade e seleção semântica |
| D — Brain e integração | 2.450 | 25% | Agent, Session, plano, tools, integração, guards de decisão e observabilidade |
| **Total** | **9.850** | **100%** | arredondamento deliberado |

A margem de erro é de aproximadamente 10% porque `runBrainOrchestration` mistura o controle do ciclo com a preparação do Agent. A conclusão relevante é que não estamos diante de um problema de 200 linhas semânticas isoladas. Existe uma camada C de cerca de 1.000–1.500 linhas, mas ela está entrelaçada com garantias A e com a integração D. Mover tudo para Jev criaria risco e não simplificaria automaticamente o arquivo.

## 4. Pacote enviado ao Brain no modo persistente

O objeto construído por `runBrainOrchestration` e passado para `runOpenAiBrainTurn` contém, entre outros:

- `conversationId`;
- `sessionId` persistente;
- `persistentSessionEnabled: true`;
- `model`;
- `reasoningEffort`;
- `agentId`;
- `currentStageId`;
- `currentObjectiveId`;
- `currentObjectiveLabel`;
- `currentObjectiveDescription`;
- `currentObjectiveRequired`;
- `currentObjectiveKind`;
- `inboundMessages`;
- `currentInboundMessages`, com id, texto e timestamp;
- `replyTargets`;
- `recentMessages: []`;
- `contactMemorySummary: ""`;
- `landmarksSummary: ""`;
- `liveStateContext: ""`;
- `temporalContext`;
- `candidateEvidence`;
- `recentStyleStateSnippet`;
- `includePersonaProfileSnapshot`;
- `memoryScopeId`;
- `recentQuestionIntentsSnippet: ""`;
- `nextObjectives`;
- `contextPipeline`, com contagens, cortes, IDs obrigatórios e watermark de contexto;
- `strictOpenAiPilot`;
- `searchCofreAudios`, callback técnico do backend;
- `runtime`, somente quando injetado em testes.

O texto de turno persistente produzido por `buildPersistentTurnContext` inclui:

1. etapa atual;
2. objetivo atual;
3. próximos objetivos pendentes;
4. contexto temporal;
5. evidências candidatas de objetivo;
6. reply targets;
7. mensagens novas do turno, com seus IDs;
8. snippet recente de estilo;
9. regra de grounding seguro;
10. contrato JSON de saída.

### Obrigatórios por turno

No modo persistente, os dados que realmente variam e precisam chegar ao Turn são:

- novas mensagens inbound, com IDs;
- etapa e objetivo operacional atuais;
- reply target quando houver;
- contexto temporal/recência quando aplicável;
- evidência candidata, quando o backend encontrou uma possível correspondência;
- instruções de estilo que mudam por turno;
- parâmetros técnicos do modelo e da sessão quando houver sincronização;
- indicação de recuperação ou criação de sessão.

### Dados que já existem na Session

Em uma Session válida, já permanecem:

- instructions canônicas do Agent;
- identidade e DNA da Larissa;
- snapshot completo da PersonaMemory inserido na criação da Session;
- histórico vivo de turnos e mensagens do Agent;
- definição da tool `cofre_audio_search`;
- configuração persistente de modelo e reasoning, sujeita à sincronização.

Por isso, `recentMessages`, `contactMemorySummary`, `landmarksSummary`, `liveStateContext` e `recentQuestionIntentsSnippet` ficam vazios no modo persistente. O histórico completo também não é reconstruído no prompt de cada turno.

### Dados semanticamente pré-processados pelo backend

Os principais são:

- `candidateEvidence`;
- objetivo atual e próximos objetivos;
- reply targets;
- `recentStyleStateSnippet`;
- lista de mensagens novas;
- seleção de mensagens obrigatórias usada para telemetria e recuperação;
- temporalidade e detecção de gap;
- resultado de `detectSpontaneousObjectiveCompletions`.

Esses campos não são a resposta final. Eles são uma mistura de sinais auxiliares, restrições e contexto para o Brain.

### Dados redundantes ou possivelmente evitáveis

Há oportunidades de redução, mas elas não são todas token dominante:

- `candidateEvidence` pode ser omitido quando a correspondência for fraca ou puramente lexical;
- `nextObjectives` pode ser enviado apenas quando houver uma ponte plausível com o turno;
- alguns campos de observabilidade em `contextPipeline` não precisam entrar no texto enviado ao Agent e podem ficar somente na telemetria;
- `temporalContext` pode ser reduzido a um código compacto quando não houver mudança de período ou gap;
- `recentStyleStateSnippet` pode ser omitido quando não houver restrição ativa;
- o contrato operacional do turno ainda repete uma parte das regras das instructions persistentes. Ele é pequeno comparado às instructions, mas merece medição antes de ser removido.

O pacote atual do turno persistente já é substancialmente menor que o modo legado. A maior duplicação histórica, o reenvio da janela de 25 mensagens, não ocorre no caminho persistente normal.

## 5. O caso do cofre de áudio

O trace:

```text
Generation GPT-6 Luna
  -> cofre_audio_search
  -> Generation GPT-6 Luna
```

é o comportamento esperado de uma tool call do Agent.

### 1. Por que existe uma geração antes da tool

O modelo precisa interpretar as mensagens, reconhecer que há uma pergunta ou gancho sobre um fato da Larissa e decidir que vale consultar o cofre. Essa decisão é emitida como `function_call` para `cofre_audio_search`.

O backend não deve adivinhar essa decisão apenas porque detectou uma palavra. A instrução persistente orienta o Agent a buscar o cofre quando houver uma pergunta pessoal que possa ser respondida por áudio.

### 2. O que o Brain decide na primeira geração

Na primeira geração, ele decide a intenção de consulta e constrói uma query semântica curta. Ele ainda não deveria escolher o áudio final sem conhecer os candidatos retornados pela ferramenta.

### 3. Payload enviado à tool

A definição da tool exige:

```json
{
  "query": "termos sobre o tema pessoal da Larissa"
}
```

O runtime aceita o objeto `{ query }`, exige string não vazia, corta a query em 200 caracteres e executa a busca com limite de 3 resultados. O callback usado em produção é `searchCofreAudios`, que recebe `conversationId`, `query` e `limit: 3`.

### 4. O que retorna

A busca devolve candidatos sanitizados contendo, principalmente:

- `audioId`;
- título;
- transcrição;
- instrução `whenToUse`;
- duração;
- metadados de já enviado/ativo conforme a fonte.

A telemetria registra `audioSearchResults`, `authorizedCandidateAudios`, `toolsRequested`, `toolExecutionsCount` e `sourcesUsed`.

### 5. Por que ocorre a segunda geração

Depois que o resultado é submetido no evento `agent.session.input.tool_result`, a Session volta a processar o mesmo Turn. O modelo recebe os candidatos e gera o plano JSON final. Nessa segunda geração ele pode selecionar o `audioId`, formular texto complementar e decidir a ordem de `outboundActions`.

O backend ainda verifica se o áudio escolhido pertence aos candidatos autorizados daquele ciclo. O Brain continua sendo a autoridade conversacional final.

### 6. Métricas existentes

O runtime inicializa:

- `turnInputTokens`;
- `turnCachedInputTokens`;
- `turnUncachedInputTokens`;
- `turnOutputTokens`;
- `turnReasoningTokens`;
- `turnTotalTokens`;
- `turnCacheWriteTokens`;
- `sessionUsageTotal`;
- `modelGenerationCount`;
- `agentToolCallCount`.

Quando o Turn devolve usage, os campos `turn*` são preenchidos diretamente de `turnData.usage` após normalização. `sessionUsageTotal` é coletado separadamente para observabilidade e não deve ser somado novamente ao custo do Turn.

A contagem de generations é aproximada pela implementação como:

```text
modelGenerationCount = 1 + appToolRound
agentToolCallCount = toolsRequested.length
```

No caminho simulado de testes, a contagem é `1 + toolsRequested.length`. Em um Turn com uma rodada de `cofre_audio_search`, a leitura operacional é uma geração inicial mais uma geração depois do resultado da tool. Se houver múltiplas rodadas, o limite técnico é `MAX_APP_TOOL_ROUNDS = 4`.

### É possível trocar por Jev antes do Brain?

Tecnicamente, sim:

```text
Jev interpreta o inbound
  -> retorna uma query tipada de áudio
Backend busca candidatos
  -> Brain recebe candidatos autorizados
Brain decide o plano final
```

Isso pode eliminar a rodada de geração usada somente para decidir a chamada da tool. Porém:

- o Jev adiciona uma request e uma latência própria;
- a query de áudio é uma interpretação semântica;
- uma classificação errada pode omitir áudio relevante;
- o Brain ainda precisa decidir texto, áudio, tom e resposta;
- o custo total só melhora se o custo e a latência do Jev forem menores que a geração adicional evitada;
- o teste deve medir também falsos positivos, falsos negativos e consultas desnecessárias.

## 6. Pontos concretos candidatos a Jev

Os candidatos reais são:

1. **Classificação de perguntas diretas**
   Jev poderia retornar intenções estruturadas, como `wellbeing`, `profession`, `city` e `preference), com offsets ou IDs das mensagens. O backend continuaria validando a cobertura e o Brain continuaria respondendo.

2. **Extração de evidência candidata**
   Jev poderia substituir ou complementar `detectSpontaneousObjectiveCompletions`, retornando objetivo, campo, valor, mensagem de origem e confiança. O backend deveria validar a origem, a conversa, negação e terceiro citado antes de usar o dado.

3. **Classificação de oportunidade de áudio**
   Jev poderia dizer que existe um forte candidato de categoria, por exemplo `profession`, e sugerir uma query. O backend buscaria os candidatos. Jev não escolheria o `audioId`.

4. **Seleção semântica de contexto**
   Em conversas muito longas ou com múltiplos inbound, Jev poderia produzir etiquetas de relevância para observabilidade ou para ordenar candidatos. A inclusão de mensagens obrigatórias, reply targets e mensagens novas continuaria determinística.

5. **Classificação de sinais sociais**
   Jev poderia fornecer um sinal auxiliar de elogio, vulnerabilidade ou pergunta social. O resultado seria somente contexto para o Brain, sem acionar envio ou mudança de estágio.

O candidato de maior impacto potencial é o pré-processamento de áudio, porque há uma rodada extra do mesmo Agent quando a tool é usada. O candidato de maior volume de código é a substituição das heurísticas de perguntas, evidências e fatos, mas esse caminho tem maior risco e não garante redução de tokens se o Brain continuar recebendo o mesmo turno.

## 7. O que não deve ir para Jev

Não devem ser delegados:

- locks, CAS, claim, ownership ou preempção;
- activation watermark;
- idempotência e deduplicação de mensagens;
- decisão de enviar, aguardar ou bloquear;
- autorização final de áudio;
- criação, atualização ou liberação de reservas;
- persistência de memória;
- escrita de objetivo, estágio ou estado oficial;
- criação ou finalização de outbox;
- dispatch para Meta/Tinder;
- retry, `dispatch_uncertain` e reconciliação;
- validação de identidade da conversa e origem da mensagem;
- decisão final de objetivo;
- seleção final de áudio;
- texto final;
- pergunta final;
- tom, flerte, reciprocidade ou progressão conversacional.

A fronteira segura é:

```text
Jev: produz sinais semânticos tipados e não autoritativos
Backend: valida, recupera recursos e aplica invariantes
Brain: decide a conversa e produz o plano final
Backend: valida tecnicamente, persiste e despacha
```

Jev pode dizer “há pergunta sobre profissão”. Não pode dizer “mande o áudio X e pergunte Y”.

## 8. Arquiteturas comparadas

### Arquitetura 1 — atual

```text
Backend -> OpenAI Brain
```

O backend já faz pré-processamento determinístico e o Brain faz a interpretação e decisão final.

- Complexidade: alta no backend atual, mas sem uma nova dependência de inferência.
- Latência: uma chamada principal; quando há áudio, uma rodada de tool dentro do mesmo Turn.
- Requests: uma execução do Agent por turno, mais eventos de tool quando necessários.
- Tokens OpenAI: o turno persistente é compacto e o histórico fica na Session.
- Inconsistência: uma fonte de decisão conversacional.
- Risco de segundo cérebro: baixo.
- Observabilidade: já há telemetria detalhada de Turn, tool, uso e contexto.
- Implementação: nenhuma migração.

É a arquitetura mais simples para preservar a autoridade única do Brain.

### Arquitetura 2 — Jev como pré-classificador

```text
Backend -> Jev -> OpenAI Brain
```

Jev classificaria perguntas, fatos ou categorias de áudio e retornaria somente JSON.

- Complexidade: aumenta por causa de contrato, timeout, versionamento, custo, telemetria e comparação.
- Latência: adiciona uma request antes do Brain; pode reduzir uma rodada do Agent somente em casos específicos.
- Requests: pelo menos uma request adicional por turno se não houver gating ou amostragem.
- Tokens OpenAI: pode reduzir tokens/generations do Brain, mas o custo do Jev precisa ser contado separadamente.
- Inconsistência: Jev e Brain podem interpretar o mesmo inbound de formas diferentes.
- Risco de segundo cérebro: controlável se Jev não retornar ação, texto ou transição.
- Observabilidade: melhora se houver comparação explícita; piora se o resultado for misturado ao plano oficial.
- Implementação: moderada, com shadow mode obrigatório antes de qualquer uso ativo.

Essa arquitetura só faz sentido se o pré-classificador evitar uma geração significativa ou reduzir muito o prompt sem aumentar a taxa de erro.

### Arquitetura 3 — Jev como camada semântica mais ampla

```text
Backend Core
  -> Jev
  -> Backend Resource Resolver
  -> OpenAI Brain
  -> Outbox
```

Aqui o Jev classificaria intents, evidências, memória candidata e necessidade de recursos; o backend resolveria áudio e memória; o Brain receberia tudo pronto.

- Complexidade: alta, porque cria uma fronteira semântica permanente entre Jev, backend e Brain.
- Latência: pode exigir uma chamada Jev, consultas ao banco e depois Brain.
- Requests: aumenta o número de etapas, ainda que evite tool rounds.
- Tokens OpenAI: potencial maior de redução no Brain, mas o contexto preparado pode ficar maior e mais rígido.
- Inconsistência: maior, pois três componentes passam a ter uma visão parcial da conversa.
- Risco de segundo cérebro: alto; o preprocessor pode começar a decidir progressão e resposta por acúmulo de campos.
- Observabilidade: exige IDs de versão, hashes de resultado, comparação por campo e explicação de divergências.
- Implementação: grande, incluindo fallback, timeout, replay e governança de schema.

Não há evidência atual de que a arquitetura 3 seja necessária. Ela deve ser evitada até que um shadow test prove que a arquitetura 2 tem ganho concreto.

## 9. Arquitetura hipotética segura

Se houver resultado positivo no shadow test, a forma mais segura seria:

```text
Inbound
  -> Backend Core
  -> Jev Semantic Preprocessor
       {intents, evidence candidates, audio query candidate, context labels}
  -> Backend Resource Resolver
       {audio candidates, validated evidence, bounded context}
  -> OpenAI Brain
       {conversation decision, final text/audio plan}
  -> deterministic guards
  -> durable outbox
  -> dispatch
```

O contrato mínimo deveria ser menor que o exemplo inicial:

```json
{
  "message_annotations": [
    {
      "message_id": "id-da-mensagem",
      "intents": ["profession"],
      "direct_question": true,
      "confidence": 0.0
    }
  ],
  "objective_evidence_candidates": [],
  "audio_query_candidate": {
    "recommended": false,
    "query": null,
    "category": null,
    "confidence": 0.0
  }
}
```

`recommended` nesse contrato significa apenas “vale pesquisar candidatos”, nunca “envie áudio”. O backend pode ignorar qualquer campo sem confiança, origem ou schema válido. O Brain recebe os candidatos e decide.

## 10. Shadow test proposto

O teste deve ser paralelo e sem efeito operacional:

```text
Inbound
  ├─ fluxo atual -> produção
  └─ Jev -> resultado salvo apenas para comparação
```

O resultado do Jev não pode:

- enviar mensagem;
- mudar objetivo ou estágio;
- escolher áudio final;
- escrever memória;
- bloquear o Brain;
- alterar outbox;
- alterar o prompt oficial;
- alterar a Session.

O shadow deve ser amostrado inicialmente para evitar custo desnecessário. Cada execução precisa registrar:

- versão do contrato e do modelo Jev;
- hash da entrada sem conteúdo sensível desnecessário;
- IDs das mensagens analisadas;
- resultado estruturado;
- latência e custo do Jev;
- erro, timeout e schema inválido;
- query de áudio sugerida, se houver;
- resultado real do Brain;
- tool calls reais do Brain;
- generations reais;
- tokens de Turn;
- cache hit/miss;
- áudio realmente escolhido;
- objetivo e estágio efetivamente persistidos;
- resposta final realmente despachada.

Métricas de comparação:

1. precisão e recall de perguntas diretas;
2. precisão da evidência de objetivo;
3. falsos positivos com terceira pessoa e negação;
4. concordância de categoria de áudio;
5. candidatos recuperados quando o Brain usou áudio;
6. consultas de áudio evitáveis;
7. redução potencial de `modelGenerationCount`;
8. `turnInputTokens`, `turnCachedInputTokens`, `turnUncachedInputTokens`, `turnOutputTokens`, `turnReasoningTokens` e `turnTotalTokens`;
9. latência p50/p95;
10. erro de schema e timeout;
11. divergência entre Jev e decisão final do Brain;
12. nenhuma alteração no comportamento efetivo de produção.

O teste só deve sair de shadow se houver ganho estatisticamente consistente em custo/latência, sem regressão de cobertura, áudio, objetivos, memória ou segurança.

## 11. Conclusão técnica

Existe uma camada C verdadeira no backend, principalmente em:

- detecção de perguntas;
- extração de fatos;
- evidência candidata de objetivos;
- classificação de oportunidade de áudio;
- seleção de contexto e sinais sociais.

Porém, ela não forma hoje um “segundo Brain” completo. Parte dela existe por segurança determinística, parte é observabilidade e parte é pré-processamento duplicado que o Brain ainda interpreta novamente.

A conclusão é:

> **vale prototipar em shadow, mas não vale implementar Jev ativo ainda.**

O motivo não é que Jev já seja necessário para a arquitetura. O motivo para o shadow é medir duas hipóteses concretas:

1. se um preprocessor barato consegue classificar perguntas/evidências com precisão suficiente para substituir heurísticas frágeis;
2. se uma query de áudio antecipada evita a rodada extra do Agent com custo total menor e sem reduzir a qualidade da seleção.

Sem esse experimento, colocar Jev no caminho ativo adicionaria latência, custo e uma segunda interpretação concorrente. O Brain deve continuar como autoridade final.

A maior oportunidade real de economia identificada é o caso de `cofre_audio_search`: quando ocorre uma rodada de tool, o Agent precisa gerar antes para decidir a consulta e gerar novamente depois para formular o plano final. Um preprocessor Jev poderia antecipar somente a classificação/query e deixar o backend buscar candidatos antes do Brain. Essa oportunidade ainda precisa ser comprovada por shadow test.

A segunda oportunidade, já parcialmente resolvida pelo estado atual, é não reenviar histórico completo em cada turno. A Session persistente já mantém instructions, PersonaMemory e histórico; o contexto normal enviado por turno contém principalmente inbound novo, objetivo, evidências e restrições variáveis. Portanto, uma grande refatoração para remover “25 mensagens por turno” não é a principal oportunidade do caminho persistente atual.

## 12. Fontes do código auditadas

- `supabase/functions/api/brain_orchestrator.ts`
- `supabase/functions/api/openai_brain.ts`
- `supabase/functions/api/openai_agent_instructions.ts`
- `supabase/functions/api/index.ts`
- `src/app/api/instagram/webhook/route.ts`
- `supabase/functions/api/persona_memory.ts`
- `supabase/functions/api/contact_memory.ts`
- `supabase/functions/api/ConversationQualityGate.ts`
- `supabase/functions/api/persona_audio_policy.ts`

Nenhuma dessas fontes foi alterada nesta auditoria.
