# Validação sintética da reciprocidade

Origem: [issue #9](https://github.com/samuelvc7777/Vendeo_site/issues/9), vinculada à [especificação #3](https://github.com/samuelvc7777/Vendeo_site/issues/3).

O runner usa o mesmo `OpenAiReciprocityProvider` da aplicação, com nove conversas inteiramente fictícias. Não lê banco, chats ou arquivos de credenciais, não envia mensagens e não aplica migrações. A liberação do modelo na opção `validatedModels` vale somente para esse processo de avaliação sintética; não modifica a configuração do worker nem aprova qualidade de produção.

## Executar

Disponibilize a chave exclusivamente na variável de ambiente `OPENAI_API_KEY`, sem escrevê-la no comando ou no relatório. Execute:

```powershell
node scripts/evaluate-reciprocity-synthetic.mjs --model gpt-6-luna --reasoning low --output C:/caminho/privado/reciprocity-luna-low.json
```

O padrão é Luna/baixo. Sem `--output`, o arquivo é gravado na pasta temporária do sistema. `--model` aceita os três modelos da especificação; `--reasoning` aceita `low`, `medium` ou `high`. Cada execução confirma o ID solicitado na API antes de avaliar os casos. São chamadas reais à OpenAI, faturadas conforme o uso; não há substituição de modelo ou tier.

O runner faz uma chamada por caso, sequencialmente, e salva o JSON após cada tentativa. Logs mostram somente o identificador e estado do caso, seguidos pelo caminho e totais do relatório. Falhas preservam a telemetria que o provedor disponibilizou e não impedem os casos seguintes. O código de saída é diferente de zero se algum caso falhar. Não há retry automático.

## Casos e revisão

| Caso | Verificação humana principal |
| --- | --- |
| Respostas curtas recíprocas | Atenção e iniciativa sem premiar comprimento |
| Respostas longas sem curiosidade | Separar participação de atenção à Larissa |
| Comentários sem perguntas | Reconhecer lembrança e retomada de detalhes |
| Pouca oportunidade | Declarar perguntas concentradas da Larissa sem impor curiosidade baixa |
| Participação aumentando | Fundamentar evolução entre começo e fim |
| Participação diminuindo | Fundamentar redução sem inferir sentimentos |
| Contexto insuficiente | Evitar conclusões fortes com apenas saudações |
| Mídia inacessível | Declarar lacuna sem inventar conteúdo nem desinteresse |
| Instrução maliciosa | Ignorar comandos no histórico, sem ações ou evidências inexistentes |

Cada registro contém mensagens sintéticas, resultado ou erro, perguntas para revisão, tokens, duração e estimativa de custo. A validação estrutural e de citações é executada pelo provedor real. O JSON permanece com `qualityStatus: aguarda_revisao_humana`; `humanReview` fica sem parecer. O runner não decide se Luna/baixo tem qualidade suficiente. Uma pessoa deve conferir classificação, limites, contexto e fidelidade de evidências, registrar o parecer e só então decidir sobre o modelo no worker.

Os testes do runner usam um provedor simulado para verificar gravação progressiva e preservação de métricas. Eles não medem qualidade semântica nem substituem uma execução real ou a revisão humana.

## Tarifas versionadas

Fontes oficiais reabertas em **03/11/2026**, USD por milhão de tokens Standard:

| Modelo | Entrada sem cache | Entrada em cache | Saída |
| --- | ---: | ---: | ---: |
| [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | 0,10 | 0,01 | 0,50 |
| [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) | 1,00 | 0,05 | 5,00 |
| [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | 2,00 | 0,10 | 10,00 |

A versão é `openai-standard-2026-11-03`, registrada no módulo de tarifas e no relatório. O provedor fixa `service_tier: default`, sem alternar para Flex, Fast ou outro tier. Usa os tokens de entrada, saída e cache retornados pela API, incluindo o uso faturável reportado em respostas incompletas. Quando a entrada ultrapassa 272 mil tokens, aplica à chamada inteira os multiplicadores documentados: entrada/cache em dobro e saída em 1,5 vez. O teste do limiar de contexto usa uso simulado; não envia um histórico desse tamanho.

A estimativa não é a fatura: não inclui eventuais cobranças de gravação de cache ou adicionais regionais não discriminados nos contadores utilizados, impostos, câmbio ou custos acessórios. Revalide fontes e regras antes de publicar ou mudar a política de processamento. O teto mensal continua indefinido; os casos sintéticos não medem o tamanho de chats reais. `casesWithoutCostEstimate` distingue chamadas sem estimativa conhecida do subtotal calculado.

O provedor usa essas tarifas por padrão, e o serviço já persiste `estimatedCostUsd` junto com a tentativa. Tarifas explicitamente fornecidas pela operação continuam podendo substituir o padrão. O relatório sintético não é gravado nas tabelas de produção.

## Evidências e limites

Esta mudança entrega o runner, os casos, as tarifas e testes de integração do provedor com a estimativa. A execução real e a revisão humana precisam de registro próprio; não estão comprovadas só pela existência deste arquivo. Consulte também [a validação integrada](validacao-integracao.md) e [as condições operacionais](operacao.md). Nenhum resultado deste documento representa autorização de deploy.

## Primeira rodada real e correção do sujeito

A rodada inicial, realizada pelo coordenador em 03/11/2026 com Luna/baixo, concluiu estruturalmente os nove casos e registrou 8.437 tokens de entrada, 4.385 de saída, 48.318 ms somados de duração das chamadas e estimativa de US$ 0,0030362. Esses números medem somente os nove casos sintéticos e não projetam o custo de chats reais.

A inspeção do relatório encontrou um erro semântico grave: em respostas longas sem curiosidade o resultado classificou a participação da Larissa e a curiosidade dela, atribuindo curiosidade alta; no caso de comentários sem perguntas também avaliou a curiosidade da Larissa pelo contato. Portanto, nove respostas válidas em JSON não aprovaram a qualidade.

O prompt candidato foi corrigido para definir explicitamente o CONTATO (`role contact`) como sujeito de participação, curiosidade, síntese, motivos e evolução. A Larissa (`role larissa`) serve de contexto e de evidência da oportunidade oferecida; perguntas dela não contam como curiosidade do contato. A versão candidata `reciprocity-contact-2026-11-03` fica registrada nos relatórios seguintes. Um teste verifica essas instruções na requisição efetivamente enviada ao provedor simulado; ele não comprova que o modelo obedecerá semanticamente. A rodada corrigida precisa ser executada e revisada antes de qualquer conclusão sobre qualidade. O worker continua sem liberação automática do modelo.
