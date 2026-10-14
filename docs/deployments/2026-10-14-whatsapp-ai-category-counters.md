# Publicação — contadores de IA por categoria do WhatsApp (14/10/2026)

## Alteração
- Os chips **Com IA** e **Sem IA** agora contam apenas as conversas da categoria primária selecionada: Todos, Respondidos, Não respondidos, Arquivados, Trancadas ou Bloqueados.
- Em **Todos**, os totais excluem contatos bloqueados, arquivados, trancados, pendentes e restritos.
- Arquivados, Trancadas e Bloqueados têm suas contagens próprias.
- Os dois chips aplicam o filtro de IA em todas as categorias, inclusive as especiais; antes, nessas categorias, a seleção não filtrava.
- Os números por categoria continuam representando toda a categoria mesmo quando houver um chip de IA, busca ou etapa selecionada; assim é possível alternar entre Com/Sem IA com seus totais preservados.
- Nenhum registro, configuração de IA, conversa, sessão ou fila foi alterado no Supabase/gateway.

## Validação e publicação
- **41 testes passaram**, incluindo 13 cenários novos cobrindo contadores e filtros rápidos.
- `npx tsc --noEmit` e `npm run build` passaram.
- Build anterior salvo em `.firebase/ai-counts-before-20261014.zip`.
- Frontend atualizado no Firebase Hosting: `https://vendeo-e755e.web.app`.
- HTML remoto idêntico ao `out/index.html`; pacote atualizado `/_next/static/chunks/0coemkq7lhd3x.js` respondeu HTTP 200.
- Gateway WhatsApp continuou no estado `ready`; sem reinício, mudanças de banco ou nova publicação da API.
