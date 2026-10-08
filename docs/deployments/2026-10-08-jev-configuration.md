# Jev: implementação local e configuração

Status atual: integração publicada e `JEV_MEMORY_MODE=active` confirmado no servidor em 08/10/2026. Política 3.0.0. Detalhes em [registro de ativação](2026-10-08-jev-activation.md). As seções abaixo preservam as avaliações históricas e configurações locais; menções a desligado/não publicado descrevem aquelas etapas anteriores. Não alegar economia agregada nem teto monetário garantido. A consolidação posterior de perguntas modificou dados autorizados da persona, sem migração de schema.

## Comportamento implementado

Backend entrega o catálogo global da persona completamente paginado, sem filtro temático por tags/categoria/palavras. Jev julga todos os candidatos elegíveis em lotes; resposta parcial, erro ou orçamento excedido usa fallback completo. Fatos da sessão e resposta manual atual permanecem separados e obrigatórios; registros de outros chats não são consultados no repositório da persona.

O Brain SDK tem seleção automática e a ferramenta `persona_memory_lookup`, limitada a duas consultas adicionais por execução. A consulta relê o catálogo para respeitar atualização/validade. Retries internos da mesma execução reutilizam a seleção preparada, evitando cobrar nova seleção automática em cada tentativa. Não há cache entre turnos ou clientes.

Foram separados inicialmente oito fatos opcionais do prompt: manhã/alimentação, almoço, comidas, doces, bebidas, filmes, música e lazer. Os textos vêm diretamente da fonte canônica por manifesto revisado. Rotina e todas as regras permanecem; geradores manuais continuam com o prompt completo. Outros fatos no banco, inclusive planos pessoais cadastrados, participam da seleção sem filtro de tema. Esta etapa não remove indiscriminadamente toda a biografia nem promete grande redução do prompt.

Circuit breaker local ao isolate: erro 401 ou três falhas de transporte/timeout/HTTP suspendem novas chamadas por 30 segundos; não bloqueia chats. Seleção conserva métricas, IDs e revisões, sem registrar textos privados ou credencial. A limpeza técnica existente remove blocos operacionais/ferramentas após checkpoint e pode ser retomada se falhar; nenhum histórico de cliente é apagado pela integração.

## Configuração local para avaliação

No arquivo `.env.local`, já ignorado pelo Git, acrescente:

```dotenv
TYPESAFE_API_KEY=SUA_CHAVE
JEV_MEMORY_MODE=off
JEV_MEMORY_THRESHOLD=0.5
```

O limiar 0,5 é apenas um ponto inicial da rodada de calibração, não um valor validado para produção. Não use prefixo `NEXT_PUBLIC_`. Não enviar a chave pelo chat nem versionar o arquivo.

O runner lê `.env.local` explicitamente; isso não significa que a Edge Function local carrega esse arquivo automaticamente. Para servir a Edge local, configure o arquivo específico de secrets ou passe-o ao comando de execução conforme a documentação Supabase.

```powershell
node scripts/eval-jev-memory.mjs
node scripts/eval-jev-memory.mjs --live
```

Primeiro comando apenas confere os 12 casos fictícios. Segundo realiza chamadas pagas autorizadas à TypeSafe e salva resultados em `.firebase/jev-evaluation/`. Não acessa chats nem envia WhatsApp. Essa rodada inicial não comprova a qualidade final do Brain nem a latência/custo do catálogo real. Ainda é necessário avaliar o catálogo completo e comparar custo agregado e respostas em sessões longas antes de ativar.

## Configuração do servidor

No [Supabase do projeto](https://supabase.com/dashboard/project/wsdualhvopidgqcumonr/functions/secrets), em Edge Function Secrets, crie `TYPESAFE_API_KEY` com sua chave e mantenha `JEV_MEMORY_MODE=off`. Os secrets são separados do `.env.local` e ficam disponíveis no servidor ([documentação oficial](https://supabase.com/docs/guides/functions/secrets)). Configurar a chave não publica o novo código.

| Variável | Uso |
| --- | --- |
| `TYPESAFE_API_KEY` | Credencial da TypeSafe, somente servidor. |
| `JEV_MEMORY_MODE` | `off` por padrão; `shadow` mede seleção mantendo Brain atual; `active` usa seleção e prompt essencial. |
| `JEV_MEMORY_THRESHOLD` | Limiar Noul calibrado. `active` sem número explícito entre zero e um é tratado como desligado. |
| `JEV_MEMORY_TIMEOUT_MS` | Prazo total inicial 2000 ms; configuração aceita 100–10000 ms. Medir antes de ajustar. |
| `JEV_MEMORY_BRAIN_MAX_BYTES` | Teto do bloco selecionado: 16000 bytes por padrão. Exceder aciona fallback, sem cortar memórias arbitrariamente. |

Publicação futura deve começar com `off`, passar por `shadow` e depois `active` após avaliação. Para reverter, definir `JEV_MEMORY_MODE=off`: volta o prompt completo/caminho atual no próximo turno sem limpar agendamentos, sessões ou histórico.

## Validação

Resultados da implementação local:

- `node scripts/test-production-baseline.mjs`: 471 testes passaram, zero falhas.
- `node scripts/test-automation-safety.mjs`: 87 testes passaram, zero falhas.
- Novos módulos de memória: compilação TypeScript estrita sem erros.
- Comparação semântica da API com a base anterior: zero diagnósticos novos; há diagnósticos anteriores do ambiente/runtime que esta tarefa não declara corrigidos.
- Verificação de identificadores da Edge e sincronização do prompt gerado passaram.
- Runner de avaliação validou a estrutura de 12 casos fictícios. Execução real confirmou ausência de credencial local e encerrou sem chamar o provedor.

Testes simulados verificam contrato, falhas e integração; não substituem avaliação real em português. A base histórica de produção permanece documentada no manifesto original; os arquivos novos divergem intencionalmente e seus hashes não devem substituir os do release anterior.

## Avaliação real em 08/10/2026

- Chave TypeSafe funcionando. Com limiar experimental 0,25: 12/12 casos da calibração passaram e 24/24 casos adicionais passaram em rodada separada. Amostra pequena; não comprova precisão sobre todo o catálogo nem qualidade da resposta final do Brain.
- Catálogo elegível real: 829 candidatos. Dois lotes concorrentes reduziram o tempo de seleção de aproximadamente 6 para 3 segundos, além do carregamento do banco. O prazo padrão de 2000 ms é insuficiente para esses exemplos e aciona fallback.
- Aproximadamente 262 mil tokens de entrada no Jev por seleção completa nesses exemplos. Ao preço consultado de US$ 0,042 por milhão de tokens de entrada, aproximadamente US$ 0,011 por turno, sem incluir Brain.
- Contagem real pelo endpoint OpenAI de tokens, sem gerar resposta nem enviar WhatsApp: filmes 18.195 → 18.795; filhos 18.196 → 19.350. A entrega compacta reduziu metadados repetidos, mas ainda acrescenta 600 e 1.154 tokens respectivamente. Contagem exclui histórico, ferramentas, saída e efeito de cache.
- O backend aplica um limiar aos escores Noul produzidos pelo Jev. Não filtra relevância por tags, palavras ou categoria; isso não equivale a uma lista final escolhida diretamente pelo modelo sem limiar local.
- Nova conferência do workspace: 476 testes da base e 87 verificações de segurança passaram. Há alterações de outra tarefa na branch `codex/rifa-audio-quatro-turnos`; não tratar o conjunto do workspace como pacote exclusivo do Jev nem publicar sem separar e revisar o escopo.

Relatórios locais ignorados pelo Git: `.firebase/jev-evaluation/selection-1791466686704.json` (calibração), `selection-1791465942528.json` (casos adicionais) e `catalog-1791466372050.json` (catálogo e contagem compacta). Os resultados anteriores desta página descrevem a primeira validação; esta seção registra a avaliação posterior com credencial real.

Pendências antes de ativar: reduzir custo e contexto mantendo os fatos originais, medir com contexto operacional completo, ajustar o prazo com evidência, validar respostas finais do Brain e revisar o pacote de publicação. A seleção permanece desligada.

## Revisão do conjunto pelo Jev (política 2.0.0)

Após Noul, o Jev compara candidatos com Choice e entrega no máximo duas memórias originais. A primeira é escolhida entre os candidatos relevantes; na segunda escolha pode responder `none` quando a informação já está coberta. Não há corte local pelos maiores escores nem comparação semântica por palavras no backend. Catálogos grandes passam por comparações em grupos e revisão dos finalistas; agrupamento pode perder uma combinação melhor e deve ser avaliado, não tratado como seleção global perfeita.

Pergunta sintética “O que você procura nesse app?” sobre catálogo real: seleção inicial anterior de 218 memórias passou a uma memória sobre conhecer alguém sem pressa, sem expectativas e aberta a relacionamento. Rodada isolada levou 8,4 s; houve timeout a 10 s em outra rodada concorrente. Prazo padrão local passa a 10.000 ms, sem alterar secrets remotos. Falhas da revisão descartam seleção parcial e usam fallback.

Avaliação da política nova: calibração 12/12; conjunto adicional 23/24. O caso restante pede três fatos distintos e só recebe dois: isso é uma limitação deliberada do teto, não um teste aprovado. Brain recebe instrução explícita para consultar o fato restante com `persona_memory_lookup`; o atendimento final desse caso ainda exige avaliação ponta a ponta. Testes da base: 479 passaram; segurança: 87 passaram, antes da última alteração textual dessa instrução.

Contagem antes de acrescentar a instrução sobre três assuntos: filmes 18.357 → 18.285 (-72); filhos 18.358 → 18.305 (-53). Economia pequena no total do Brain e não comprova economia agregada com Jev. Seleção inicial e revisão custam chamadas adicionais. Ainda desligado e não publicado.

Referência do contrato Choice: [documentação TypeSafe](https://docs.typesafe.ai/primitives/choice). Relatórios: `selection-1791467143730.json`, `selection-1791467195194.json`, `catalog-1791467189345.json` em `.firebase/jev-evaluation/`.

Contagem final com instrução complementar: filmes 18.357 → 18.318 (-39); filhos 18.358 → 18.338 (-20). Relatório `catalog-1791467275935.json`. Os 34 testes específicos de memória passaram após a última alteração. A comparação é com prompt completo e pergunta sintética, sem fatos legados recuperados, histórico ou ferramentas; não representa a fatura de produção.

## Otimização do Jev (política 3.0.0, vigente localmente)

Removida a pergunta Noul por registro, que repetia política, IDs, aliases e metadados centenas de vezes. Cada grupo entrega o conjunto de fatos uma vez no `state`; na mesma chamada Jev responde Choice para primeira/segunda memória e Noul para existência de resposta no conjunto. O backend valida respostas e resolve os IDs, sem ranking temático. O Noul do conjunto é aceito a partir de 0,5; esse corte técnico continua local. `JEV_MEMORY_THRESHOLD` agora é apenas compatibilidade histórica e não decide memórias; `active` exige modo explícito, não esse limiar antigo.

Compactação estrutural preserva chave/valor e negações, retira aliases/confidence e usa índices curtos somente no transporte. O Brain recebe o registro original com procedência; não usamos síntese de fatos. As comparações em grupos continuam uma aproximação e podem perder combinações melhores; limitar a duas memórias pode exigir esclarecimento adicional.

Medição real com 829 candidatos e perguntas sintéticas: filmes 42.761 tokens, 2,258 s; filhos 42.763 tokens, 2,063 s. Todas as sete chamadas de cada seleção estão incluídas nesse consumo. Pela tarifa oficial de US$ 0,042/M e dólar **hipotético a R$ 5**, custo de aproximadamente R$ 0,00898 por seleção (0,898 centavo), sem Brain, tributos ou spread. Redução de aproximadamente 84% frente aos 262 mil tokens iniciais. Não obtivemos cotação cambial atual verificável nesta avaliação; não apresentar R$ 5 como cotação vigente.

Consulta complementar só é admitida quando consumo já observado mais reserva equivalente à seleção inicial não ultrapassa 45 mil tokens. Caso contrário retorna `turn_memory_budget`, sem nova chamada: Brain deve usar fatos disponíveis ou solicitar esclarecimento, nunca inventar. Essa reserva evita releituras caras usuais, mas **não garante um centavo por todo turno**: contexto maior, catálogo alterado, consumo da próxima chamada e câmbio podem variar. A seleção inicial ainda não tem limite financeiro pré-faturamento; é necessário avaliar cenários operacionais completos antes de ativar.

Avaliação real anterior à última compactação dos índices: 12/12 casos iniciais. Na compactação final: 23/24 casos adicionais; a exceção continua sendo a pergunta com três assuntos, limitada a dois fatos. Pergunta sobre intenção no app retorna uma memória pertinente em 2,852 s. Rodada intermediária recebeu HTTP 529; encerrou sem retries e preservou fallback. Relatórios: `catalog-1791468091380.json`, `selection-1791468123175.json` em `.firebase/jev-evaluation/`.

Preço verificado em [Models TypeSafe](https://docs.typesafe.ai/models), com saída gratuita. Nenhuma publicação ou ativação foi realizada.
