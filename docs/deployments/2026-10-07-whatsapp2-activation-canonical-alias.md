# Identidade do contato na ativação imediata

O endpoint de sincronização comparava o ID exibido pela lista com o ID canônico resolvido pelo gateway. Uma lista ainda usando LID podia ser rejeitada quando o gateway já confirmava a ligação desse LID com o telefone do mesmo contato.

O gateway agora aceita o ID canônico ou o ID exato do chat solicitado dentro da conta conectada e retorna o ID canônico em todas as respostas bem-sucedidas. IDs de outro contato ou de outra conta continuam bloqueados. A interface usa o ID retornado para ativar o AutoPilot e atualiza o chat aberto sem sobrescrever uma seleção diferente feita durante a requisição.

Verificação: 23 testes direcionados passaram, incluindo o handler real com alias confirmado, recusa de outro contato e outra conta, e ativação no ID retornado pelo gateway. O teste do alias falhou com HTTP 409 antes da correção.

A publicação usa a base anterior isolada do frontend e o snapshot anterior do gateway. O snapshot de rollback do gateway está em `.firebase/gateway-before-alias-source.cjs`.

Publicado em 07/10/2026: build estático e TypeScript concluídos; Firebase Hosting liberou 89 arquivos. Gateway local e público retornaram `ready` sem `lastError`. Os nove scripts do HTML público correspondem por SHA-256 ao build publicado. O POST vazio na rota pública retornou HTTP 400, confirmando a rota sem executar envio em conversas.

## Complemento: lista com LID antigo e provider com telefone

A primeira correção aceitava o ID bruto solicitado e o canônico retornado, mas ainda rejeitava a combinação inversa: ID antigo da lista diferente do ID atual do provider. Agora, dentro da mesma conta, consulta o mapeamento de telefone do WhatsApp para os dois identificadores e só aceita quando ambos têm o mesmo telefone confirmado. LIDs sem confirmação, contatos diferentes e contas diferentes permanecem bloqueados.

25 testes direcionados passaram; o caso inverso falhou com HTTP 409 antes desta correção. Atualização exclusiva do gateway, preservando o frontend já publicado. Snapshot anterior em `.firebase/gateway-before-inverse-alias-source.cjs`.
