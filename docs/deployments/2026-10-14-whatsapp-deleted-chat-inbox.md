# Publicação da sincronização de conversas excluídas — 14/10/2026

## Problema
A inbox unia indiscriminadamente os chats retornados pelo WhatsApp com registros de `instagram_conversations` no Supabase. Quando uma conversa era removida no WhatsApp, mas permanecia no banco, voltava a ser exibida. O estado React retinha por mais uma semana chats recentes não conciliados e eventos realtime de registros antigos também podiam reintroduzi-los.

A auditoria somente leitura do recorte atual encontrou 46 chats no snapshot de listagem do gateway e 129 registros canônicos elegíveis; 45 registros canônicos não tinham correspondência direta de ID no snapshot. Isso não significa que todos os 45 representavam exclusões: aliases, limites temporais e ausência de chat também são possíveis.

## Correção de frontend
- Depois de um `/chats` bem-sucedido, só identidades com chat devolvido pelo gateway são incluídas na inbox. Os dados canônicos continuam enriquecendo as conversas presentes, inclusive seus aliases LID/telefone.
- Cache local não pode reintroduzir chat sem correspondência no snapshot bem-sucedido.
- Quando a conversa aberta deixa de existir no gateway, a tela é fechada com segurança.
- Eventos Supabase de IDs ainda não confirmados pelo gateway solicitam nova sincronização com deduplicação temporal, em vez de inserir diretamente um registro órfão.
- Atualização periódica da inbox visível a cada 45 segundos se o realtime estiver conectado; quando desconectado permanece 30 segundos.
- Se uma consulta ao gateway falhar, a ausência de chat não é interpretada como exclusão confirmada; mantém-se fallback de histórico até o próximo snapshot válido.
- Nenhum dado, mensagem, status de rifa, histórico ou conta foi apagado do banco.

## Verificação
- 26 testes direcionados aprovados, zero falhas, incluindo quatro novos cenários de regressão.
- `npx tsc --noEmit` e `npm run build` aprovados.
- Publicação Firebase Hosting `https://vendeo-e755e.web.app` concluída; HTML público confere exatamente com `out/index.html`; bundle novo `1moy1xankvvm1.js` respondeu HTTP 200.
- Gateway WhatsApp permaneceu `ready`, sem reinício; API/banco Supabase não foram publicados ou modificados.
- Backup do `out` anterior: `.firebase/inbox-before-20261014.zip`.

Limite: a detecção depende de o gateway retornar a lista atualizada. Se uma conversa ainda estiver no WhatsApp Web, continuar visível é esperado; se estiver fora do limite do snapshot atual, ela será excluída da inbox exibida. O histórico canônico permanece no banco, inclusive para uso de outras funcionalidades.
