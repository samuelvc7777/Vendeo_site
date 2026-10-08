# Jev: implementação local e configuração

Status: código implementado localmente; seleção desligada por padrão. Não publicado nesta tarefa. Avaliação com API real pendente da credencial que o usuário possui. Nenhuma migração ou alteração de dados foi necessária.

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
