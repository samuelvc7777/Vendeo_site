# Publicação da separação de conversas por conta WhatsApp

Publicação concluída em 07/10/2026.

## Componentes publicados

- Frontend estático no Firebase Hosting: https://vendeo-e755e.web.app.
- Edge Function `api` do Supabase `wsdualhvopidgqcumonr`, versão 518. A publicação preservou a configuração existente `verify_jwt=false` e partiu do código que estava ativo na versão 517.
- Gateway WhatsApp reiniciado com o código de escopo por conta. O processo usa a sessão persistente existente.

## Comportamento

- O ID da conta é derivado do WID do WhatsApp conectado.
- As conversas persistidas usam `wa2:account-<número>:<jid>`; leituras, eventos em realtime e envios de automação respeitam esse escopo.
- O nome salvo na agenda do WhatsApp tem prioridade. O nome de perfil fica como alternativa quando não há nome salvo.
- O gateway publica `savedContactName` para a lista e mantém caches de contato separados por conta.

## Validação

- Build de produção isolado passou, incluindo a checagem TypeScript do Next.js.
- 35 testes direcionados de conta WhatsApp, identidade, contatos, controles da conversa e destinatário passaram.
- Firebase Hosting respondeu HTTP 200 e os bundles públicos incluem o escopo de conta e o nome salvo.
- Gateway respondeu HTTP 200 e voltou ao estado `ready` após o reinício.
- Edge Function `api` ficou ativa na versão 518; uma chamada de validação sem `conversationId` retornou HTTP 400 esperado, sem alterar conversa ou enviar mensagem.
- As colunas e RPCs de fila por conta já existiam no banco; nenhuma migration foi aplicada.

## Histórico legado

Conversas antigas identificadas apenas como `wa2:<jid>` continuam armazenadas, mas ficam fora da lista escopada. Não foram atribuídas automaticamente a um número porque esses IDs não registram qual conta as criou. Novas mensagens e sincronizações passam a gravar a conta no ID.

## Artefatos do gateway

- Código ativo: `.firebase/gateway-production-source.cjs`.
- Cópia anterior preservada: `.firebase/gateway-production-source-before-account-scope-20261007.cjs`.
- PID ativo: `.firebase/gateway-production.pid`.
- Logs desta inicialização: `.firebase/gateway-production-account-scope.log` e `.firebase/gateway-production-account-scope-error.log`.
