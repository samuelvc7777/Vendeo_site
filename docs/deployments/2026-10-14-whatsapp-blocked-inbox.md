# Publicação — filtro de contatos bloqueados (14/10/2026)

## Diagnóstico de produção
O usuário informou que três conversas bloqueadas e excluídas no celular continuavam aparecendo na caixa principal. Confirmamos que, mesmo após a correção de conciliação entre gateway e Supabase, o próprio gateway `GET /chats?limit=500` devolvia os três JIDs:
- `87214176399513@lid` — +55 13 99207-5172 — `isBlocked=true`;
- `126993710465253@lid` — +55 11 95108-2128 — `isBlocked=true`;
- `59369483972782@lid` — +55 32 9951-0929 — `isBlocked=true`.

O Chrome do gateway foi inspecionado somente para leitura via Puppeteer conectado ao DevTools existente. O `ChatStore` contém os três modelos com mensagens residuais, `shouldAppearInList=true` e estado de bloqueio confirmado no gateway. O WhatsApp Web não expõe nesse estado uma marca inequívoca de exclusão realizada no celular. Não é seguro inferir exclusão apenas do bloqueio nem apagar dados.

## Solução
- Adicionada categoria **Bloqueados** ao conjunto de filtros da inbox iOS.
- Contatos cujo `isBlocked === true` saem da lista principal e dos filtros respondidos/não respondidos/arquivados/trancadas.
- Todos os contatos bloqueados continuam acessíveis em **Bloqueados**, inclusive para consultar o histórico e usar **Desbloquear contato** pelo menu de ações.
- Todos os contatos não bloqueados, inclusive Home Care e +44 7723 442971, permanecem no fluxo anterior.
- Não foram alteradas ações de bloqueio/desbloqueio, função Supabase, gateway, automação, mensagens, rifa nem dados persistidos.

## Validações
- 28 testes direcionados passaram, zero falhas (incluindo os 3 novos cenários de exibição e desbloqueio).
- `npx tsc --noEmit` e `npm run build` aprovados.
- Backup pré-publicação do frontend: `.firebase/blocked-filter-before-20261014.zip`.
- Firebase Hosting `https://vendeo-e755e.web.app` publicado com sucesso; HTML público idêntico ao `out/index.html` e novo bundle contendo o filtro acessível em `/_next/static/chunks/36t106o44tp7g.js`.
- Gateway local respondeu `ready`, sem reinício.

Limite: essa é uma regra visual para contatos bloqueados, **não uma confirmação de que cada conversa foi apagada no WhatsApp Web**. Se um contato for desbloqueado, poderá voltar à lista principal enquanto continuar existindo no snapshot do gateway.
