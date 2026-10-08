# Ativação imediata do AutoPilot no WhatsApp2

Publicado em 07/10/2026 no Firebase Hosting `vendeo-e755e` e no gateway de produção.

## Correção

O histórico consultado no provedor podia aparecer na interface sem existir em `instagram_messages`. A ativação imediata dependia desse histórico persistido e podia habilitar o AutoPilot sem encontrar uma mensagem para responder.

A interface agora solicita a sincronização da última mensagem recebida antes da ativação imediata. O gateway valida a identidade da conversa na conta conectada, usa a fila existente e espera a persistência. Não importa o histórico inteiro. Falhas de sincronização aparecem no modal.

Se a última mensagem do provedor for de saída, a ativação usa o modo de aguardar a próxima mensagem, evitando responder novamente a uma entrada antiga do banco.

## Publicação e verificação

- Build estático e TypeScript concluídos com sucesso.
- Testes direcionados de seleção de mensagem, handler HTTP, ativação, escopo de conta e identidade canônica.
- Firebase confirmou a liberação de 89 arquivos.
- Os nove scripts referenciados pelo HTML público correspondem por SHA-256 ao build publicado; o bundle contém a nova rota.
- Gateway local e público retornaram HTTP 200, estado `ready` e `lastError: null` após a reinicialização sem logout.
- POST vazio na nova rota pública retornou HTTP 400 com `chatId obrigatório`, confirmando o handler sem executar ações em conversas.
- Não foi disparada mensagem real para clientes durante a verificação.

O frontend foi preparado sobre a cópia isolada da publicação anterior. O gateway foi preparado sobre o snapshot anterior de produção para evitar publicar alterações locais sem relação com esta correção. Snapshot anterior preservado em `.firebase/gateway-before-immediate-source.cjs`.
