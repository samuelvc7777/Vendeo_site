# Plano de integração do Jev com as memórias do Brain

Data: 08/10/2026. Base analisada: `main`, commit `8b694e11`. Status: análise concluída; integração e avaliação com API real pendentes. Este documento não altera a aplicação publicada.

## Decisão proposta

Decisão aprovada pelo usuário: usar Jev automaticamente antes do Brain para selecionar fatos pessoais opcionais por significado. O backend entrega contexto operacional e o catálogo completo elegível, sem filtro de relevância por tags, palavras, categoria ou pontuação lexical. Identidade essencial, rotina, regras de horário, limites e instruções de comportamento continuam sempre disponíveis. O Brain recebe os textos originais selecionados e pode realizar uma consulta complementar quando faltar informação. Jev decide relevância; não cria fatos nem responde ao cliente. Plano executável: [plano de ação](../plans/2026-10-08-jev-action-plan.md).

Contrato e fontes oficiais: [pesquisa da API](2026-10-08-jev-api.md). O protótipo preservado no backup não deve ser reintegrado diretamente: seus limites de candidatos, quantidade selecionada e limiar não foram calibrados.

## Evidência da base atual

| Ponto | Situação verificada | Consequência |
| --- | --- | --- |
| Prompt canônico | `supabase/functions/api/larissa_canonical_prompt.md`: 72.963 caracteres. Biografia, rotina e regras estão misturadas. | Separar fatos de políticas por revisão explícita; não remover seções inteiras automaticamente. |
| Bloco inicial de identidade e biografia | 8.517 caracteres, aproximadamente 11,7% do prompt, incluindo regras essenciais. | A parte removível é menor. Não prometer grande redução de todo o prompt apenas com Jev. Caracteres não equivalem a tokens. |
| Recuperação persistente | `brain_orchestrator.ts`, função `fetchRelevantPersistentManualFacts`: comparação lexical, últimos 120 registros de `manual_resolution`, retorna até dois. | Esse caminho pode perder fatos por sinônimos ou múltiplas perguntas. O caminho normal novo não deve excluir candidatos por palavras antes do Jev. |
| Memórias disponíveis | Inventário somente leitura: 821 registros da persona, 137 em `manual_resolution`, 18 com alguma validade temporal; 31 fatos permanentes em `brain_manual_facts`. | Contagens de tabelas diferentes não comprovam a mesma origem. Revisar autoridade, duplicatas e proveniência antes de habilitar registros. O inventário é uma fotografia do momento. |
| Estado por turno | `openai_sdk_brain.ts`, `buildOperationalTurnState`: inclui fatos da sessão e até dois fatos persistentes. | Separar fatos obrigatórios do turno dos opcionais selecionáveis. |
| Ferramentas ativas | Brain SDK oferece áudio e pesquisa web; `personaMemoryToolEnabled: false`. | Implementar uma ferramenta real de consulta de memória. Texto no prompt sozinho não a disponibiliza. |
| Histórico persistente | `run` usa `conversationId`; `openai_conversation_runtime.ts` mantém o vínculo existente. | Memórias de turnos anteriores podem continuar no contexto. Trocar o prompt não limpa o histórico. |

## Catálogo e autoridade

Inventariar cada fato hoje fixo e cada memória elegível. Classificar explicitamente:

- **Sempre presente:** identidade necessária ao atendimento, rotina vigente, horários e regras sobre presença real, comportamento e restrições. A rotina permite descrever o habitual; não confirma um acontecimento atual.
- **Obrigatório no turno:** resposta manual que acabou de destravar a dúvida, correções atuais e informação operacional necessária. Não permitir que um escore do Jev elimine essa resposta.
- **Opcional:** gostos, planos pessoais como ter filhos, histórias e detalhes biográficos pertinentes apenas a certos assuntos.

Cada registro precisa de ID, texto original, origem/autoridade, revisão, escopo e validade quando houver. Fatos globais da persona não se confundem com fatos do cliente ou do chat. Usar conta, conversa e sessão conforme a origem. Nunca consultar sessões de outros clientes. Um registro gerado automaticamente não equivale a uma confirmação humana.

Resolver conflitos por autoridade e revisão explícitas, não pelo maior escore de relevância. Expiração e escopo são verificações determinísticas anteriores ao Jev. Duplicatas podem ser agrupadas sem alterar significado; preservar negações. Não inventar respostas para preencher lacunas do catálogo. Migração de esquema somente se os campos existentes forem insuficientes, sem exclusão de dados.

## Fluxo de execução

1. O orquestrador captura a revisão do turno, a mensagem pendente, contexto recente suficiente, assunto/objetivo e horário local. Mantém os controles existentes de cancelamento e entrega.
2. O repositório carrega somente candidatos autorizados, vigentes e com origem aprovada. Acrescenta separadamente os fatos obrigatórios do turno.
3. O seletor envia contexto compartilhado e uma pergunta Noul por candidato ao Jev. A pergunta inclui o conteúdo do fato e pede relevância para responder às mensagens atuais. Mensagens e memórias são dados, não instruções autorizadas a mudar a tarefa.
4. O código valida respostas e associa escores exclusivamente aos IDs conhecidos. Entrega ao Brain os textos originais, origem, revisão e validade dos selecionados.
5. O Brain responde usando regras essenciais, fatos obrigatórios e seleção opcional. Se necessário, chama a ferramenta complementar de memória; ela usa o mesmo repositório e critérios de escopo.
6. Antes de prosseguir com a entrega, a execução confirma que o turno ainda é válido. Resultado de seleção antigo não autoriza enviar depois de cancelamento ou reinício.

Exemplo: “você pensa em ser mãe?” pode recuperar o fato sobre filhos mesmo sem repetir suas palavras. “o que está fazendo às 08:28?” deve usar a rotina essencial e distinguir atividade habitual de atividade atual confirmada; não depende de Jev para saber o horário do estágio.

## Contrato e orçamento

Implementar transporte HTTP com `fetch` no servidor, sem presumir compatibilidade do SDK Node com Deno. Credencial `TYPESAFE_API_KEY` somente em secret do backend. Fixar `jev-1.13.0` na primeira avaliação; versionar instruções e limiares.

API: `POST https://api.typesafe.ai/v1/systemone`. Estado compartilhado contém contexto e objetivo; `questions` contém uma Noul por memória. Resultado válido exige todos os IDs solicitados, tipo correto e número finito entre zero e um. Resultado parcial, campo ausente ou erro não significa “nenhuma memória relevante”.

Avaliar todos os candidatos elegíveis em um lote quando couberem no limite oficial e no orçamento medido. O catálogo de 821 registros não comprova que o payload completo cabe: medir texto de estado e perguntas. Limites documentados: 64 mil tokens totais e 32 mil para estado mais maior pergunta. O máximo de perguntas por requisição não foi confirmado nesta pesquisa; validar com a API real.

Se necessário, dividir deterministicamente em lotes que cubram todo o catálogo, com concorrência limitada e prazo total. Não truncar silenciosamente os primeiros 120 registros. Não instalar uma recuperação lexical ou por tags como filtro de relevância. Se a cobertura completa não couber no prazo, tratar a seleção como incompleta e usar fallback; registrar a limitação para ajustar lotes e orçamento. Não introduzir outra etapa de seleção anterior ao Jev neste escopo.

Não fixar arbitrariamente “duas memórias” ou limiar 0,4. Calibrar seleção e orçamento com exemplos rotulados, incluindo várias perguntas no mesmo turno. Se houver fatos relevantes demais para o orçamento, registrar a condição e usar consulta complementar ou caminho conservador; não anunciar seleção completa.

## Falhas e histórico

Configuração operacional deve permitir `off`, `shadow` e `active`:

- `off`: comportamento e prompt completos atuais.
- `shadow`: Jev executa para medir; Brain continua recebendo o caminho atual completo.
- `active`: prompt essencial e seleção, com recuperação complementar e fallback.

Preparar prompt completo e prompt essencial a partir de uma fonte revisada para impedir divergência. O fallback precisa restaurar o conhecimento opcional aprovado, não usar apenas o prompt reduzido após falha. Para fatos manuais, preservar o comportamento atual como fallback inicial explicitamente identificado; isso não substitui a seleção semântica normal. O fallback também precisa caber no contexto.

Definir prazo total de seleção, cancelamento e circuit breaker. Dois segundos podem ser uma meta inicial de avaliação, não uma garantia. Não herdar retries que esperem dezenas de segundos. Falhas de credencial/validação não devem repetir; sobrecarga e limite só permitem tentativa adicional dentro do prazo. Falha do seletor, por si só, não deve desligar a IA, bloquear envio ou aparecer como ausência de conhecimento pessoal.

Cache de seleção, se adotado, precisa considerar versão do modelo/política, revisão das memórias, escopo, mensagens atuais, objetivo e janela temporal. Não reutilizar somente por texto da última mensagem. Começar sem cache de resultados simplifica validação.

As Conversations da OpenAI armazenam mensagens e ferramentas ([documentação](https://developers.openai.com/api/docs/guides/conversation-state)). Conferência adicional durante implementação: `cleanupSdkConversationTechnicalItems` remove mensagens system/developer e ferramentas após o checkpoint, preservando as falas naturais. A integração utiliza esse mecanismo existente; não cria uma limpeza de chats. Se a limpeza falhar, o marcador permite nova tentativa e blocos técnicos podem permanecer temporariamente. Medir sessões longas e esse cenário antes de anunciar economia. Não limpar conversas, vínculos, agendamentos ou outbox para ativar Jev.

## Economia que precisa ser medida

Preço publicado em 08/10/2026: US$ 0,042 por milhão de tokens de entrada, saída gratuita ([modelos TypeSafe](https://docs.typesafe.ai/models)). Dez mil tokens custariam US$ 0,00042 apenas no Jev; exemplo aritmético, não medição deste sistema. Conteúdo de todas as perguntas também custa tokens, embora o estado compartilhado seja contabilizado uma vez por lote.

Comparar custo total: Jev + entradas não cacheadas do Brain + entradas cacheadas + saída + chamadas complementares. O projeto já configura cache no Brain; manter instruções essenciais estáveis e enviar seleção como contexto variável. A redução de caracteres não prova a redução de cobrança ([cache OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching)). Medir turnos iniciais, sessões aquecidas e conversas longas com o mesmo conjunto de casos.

## Avaliação e critérios de ativação

Criar conjunto rotulado em português com memória esperada e resposta aceitável, usando cenários fictícios ou dados minimizados, sem enviar mensagens a clientes. Cobrir:

- Sinônimos, perguntas indiretas, pronomes, mudanças de assunto e múltiplas perguntas.
- Negação, memória irrelevante, informação desconhecida e tentativa de mudar instruções.
- Rotina às 08:28, estágio em horário incompatível, fim de semana, validade vencida e conflito entre fontes.
- Resposta manual recém-salva, correção de memória e isolamento entre números/chats/sessões.
- Timeout, 401, 422, 429, 529, resposta parcial, IDs desconhecidos, cancelamento e reinício durante seleção.
- Fallback com todos os fatos essenciais disponíveis, ferramenta complementar funcional e ausência de duplicação de envio.
- Histórico longo, cache frio/quente, tokens e custo agregado por resposta.

Critérios propostos para calibrar, ainda não atingidos: recall de memórias relevantes de pelo menos 98% no conjunto; cobertura integral dos casos críticos rotulados; zero vazamento de escopo ou uso de fato expirado nesses casos; custo agregado inferior ao baseline com qualidade preservada; latência dentro do orçamento definido. Relatar tamanho do conjunto e erros, sem tratar teste finito como garantia universal.

## Ordem de implementação

1. Revisar catálogo e separar fatos opcionais das regras sem remover informação do prompt atual.
2. Implementar módulo isolado do seletor e validação do contrato; testes com transporte simulado e repositório com escopo explícito.
3. Integrar em `brain_orchestrator.ts` antes de `runOpenAiBrain`; adicionar seleção estruturada em `openai_sdk_brain.ts` e ferramenta real de memória.
4. Adaptar geração de instruções em `openai_agent_instructions.ts` e demais consumidores do prompt, mantendo versão completa para `off`/fallback.
5. Adicionar avaliação reproduzível com API real e telemetria de IDs/revisões, duração, falha, tokens e custo. Não registrar conversa completa ou chave.
6. Executar `node scripts/test-production-baseline.mjs` e verificações de automação pertinentes; avaliar sem enviar aos clientes.
7. Publicar inicialmente com flag desligada; habilitar sombra, comparar resultados e depois ativar gradualmente. Rollback desliga seleção e restaura prompt completo, preservando sessão e dados.

Não foi encontrada credencial TypeSafe no ambiente local nesta análise. Isso impede comprovar seleção, latência e economia reais agora; não impede preparar a implementação desligada. Nenhuma integração ativa deve ser anunciada antes dessa validação.
