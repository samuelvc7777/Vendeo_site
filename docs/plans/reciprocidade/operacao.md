# Operação da análise de reciprocidade

Implementação da issue #5, parte da especificação #3. Não houve aplicação de migração, envio a contatos ou deploy nesta tarefa.

## Recorte e isolamento

A decisão do usuário foi analisar **toda a conversa**. A interação deste recurso é a identidade canônica da relação: não muda com silêncio, ativação, reinício técnico ou troca de cronograma. A solicitação captura em uma transação todas as mensagens disponíveis de ambos os lados, ordenadas por data e ID, até a última mensagem identificada nesse instante. A captura é persistida na tentativa; mensagens posteriores só entram em outra análise. A captura não cria vínculos por telefone nem procura mensagens de outras conversas.

O backend lê `instagram_messages` pela identidade canônica exata, incluindo mensagens que os adaptadores já persistiram para essa conversa durante transferências autorizadas. Conteúdo ainda não importado pelo adaptador não pode ser analisado. Usa texto, transcrição e descrição existentes; mídia sem representação textual recebe limitação explícita. Mensagens com estado de envio falho ou ainda não enviado não são tratadas como falas entregues.

## Acesso do operador

A autenticação legada do app por origem/chave pública não comprova escopo de conta. Este recurso exige uma credencial própria, enviada em `X-Reciprocity-Key`. Ela nunca é a chave service_role nem a chave da OpenAI. O servidor recebe `RECIPROCITY_OPERATOR_SCOPES`, um JSON de registros com:

- `scopeId`: identidade estável do escopo, usada em configuração, tentativas e deduplicação;
- `tokenHash`: SHA-256 hexadecimal de um segredo aleatório de alta entropia entregue ao operador;
- `conversationIds`: IDs canônicos explicitamente autorizados; ou
- `accountIds`: identidades no formato `canal:external_account_id`, comprovadas por vínculos de canal ativos/transferidos; ou
- `allConversations: true`: autorização explícita para todas as conversas do projeto, somente para o operador com esse alcance.

Não há autorização implícita. Configuração ausente ou inválida bloqueia o recurso. O cliente não escolhe o escopo e não recebe hashes. Para contas antigas sem vínculo de canal, autorize IDs canônicos explícitos em vez de deduzir titularidade por prefixo ou telefone. Mudança/revogação de chave é feita na configuração do servidor. O SSE deve autenticar e autorizar antes de assinar; alterações são apenas notificações sem conteúdo, seguidas por nova consulta autenticada.

As tabelas `reciprocity_attempts` e `reciprocity_settings` têm RLS e nenhum privilégio de `anon`/`authenticated`; só o servidor service_role lê/escreve. Não abrir as tabelas para o navegador para habilitar Realtime. Funções usam `SECURITY INVOKER`, privilégios revogados de PUBLIC e concessão apenas a service_role. A migração habilita a tabela na publicação Realtime existente, quando disponível, para o assinante servidor.

## Contrato HTTP

- `GET /operator/reciprocity?conversationId=...`: estado mais recente, último resultado concluído, tentativas e elegibilidade;
- `POST /operator/reciprocity`: corpo com `conversationId` e `reason` (`manual`, `retry` ou `reevaluation`); retorna tentativa com HTTP 202;
- `GET /operator/reciprocity/settings`: configuração do escopo autenticado; padrão Luna/baixo;
- `PUT /operator/reciprocity/settings`: corpo com `model` e `reasoning`; verifica acesso ao modelo e salva somente para próximas análises do escopo. Não aceita escopo indicado pelo cliente nem modifica tentativas já solicitadas;
- `GET /operator/reciprocity/evidence?conversationId=...&attemptId=...&messageId=...`: contexto de até duas mensagens antes/depois da mensagem citada, dentro do snapshot de uma tentativa concluída do escopo autorizado.

Os tipos públicos estão no domínio `Reciprocity`. A API nunca devolve o histórico completo capturado, segredos nem lease. Evidências permanecem verificáveis mesmo quando a mensagem antiga ainda não foi carregada na tela. Uma etapa posterior, por si só, não torna o chat elegível: todos os objetivos habilitados da etapa inicial precisam ter conclusão persistida. Objetivos desabilitados não bloqueiam e a categoria de reciprocidade não é derivada de nenhum objetivo histórico.

## Processamento e recuperação

Solicitar só persiste o trabalho. O cron autenticado integra `processReciprocityQueue`; uma execução reserva uma tentativa com `FOR UPDATE SKIP LOCKED`, sem depender do navegador aberto. A reserva dura cinco minutos, acima do prazo de 240 segundos do provedor. Não há retry automático cego: uma execução interrompida pode já ter sido faturada e é marcada como falha para recuperação explícita. Falha preserva qualquer resultado anterior. Cliques concorrentes compartilham a tentativa ativa; reavaliação posterior não é bloqueada por falta de novas mensagens.

O provedor usa Responses API com saída estruturada, sem ferramentas, sessão de atendimento ou gravação de estado no provedor. Mantém `truncation: disabled`. Se o histórico integral exceder a capacidade configurada (`maxInputChars`, padrão conservador de 200 mil caracteres de entrada), a tentativa falha com explicação de cobertura; não remove mensagens silenciosamente. Esse limite técnico não é estimativa de tokens nem limite mensal de gasto e deve ser ajustado após medições.

## Modelos, qualidade e consumo

Os IDs aceitos são `gpt-6-luna`, `gpt-6.1-terra` e `gpt-6.1-sol`; os níveis são `low`, `medium` e `high`. O padrão é Luna/baixo. Antes de aceitar uma solicitação, `preflight` consulta `GET /v1/models/{id}` com a chave resolvida pelo backend e exige o ID exato. Não há substituição silenciosa.

Em Configurações, abaixo do acesso à análise, o responsável seleciona modelo e raciocínio. O salvamento consulta o modelo real antes de persistir; indisponibilidade deixa a escolha anterior intacta. Seleções valem para todos os chats autorizados do mesmo escopo. Cada análise já solicitada preserva seu próprio snapshot de configuração, inclusive quando o responsável salva outra escolha durante processamento. Alterar configuração não inicia reavaliações nem refaz histórico. A escolha de modelo disponível não contorna a validação de qualidade exigida para o worker.

O worker só avalia modelos presentes em `validatedModels`, uma lista server-side de modelos cuja qualidade foi validada pelos casos da issue #9. Sem essa lista, a tentativa informa pendência de validação em vez de ativar um modelo sem fundamento. Acesso ao catálogo da API não equivale a qualidade validada. O coordenador confirmou acesso aos três IDs com a credencial salva; a variável local de ambiente estava obsoleta. Não incluir qualquer chave em logs, PR, comandos compartilhados ou documentos.

`rates` pode fornecer preços por milhão de tokens de entrada, saída e entrada em cache, com data e fonte registradas pela operação. Sem tarifas confirmadas, `estimatedCostUsd` é nulo; nunca inventar custo. A tentativa registra tokens e duração disponíveis. Preços devem ser revalidados antes de habilitar estimativas. Medições reais de consumo e qualidade com casos sintéticos pertencem à issue #9, sem mensagens a clientes ou acesso a conversas de terceiros.

Referências consultadas: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [RLS no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
