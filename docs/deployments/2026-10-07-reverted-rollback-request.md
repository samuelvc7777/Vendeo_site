# Produção restaurada ao estado anterior ao pedido de rollback

Concluído em 07/10/2026, por solicitação do usuário: voltar ao estado anterior à mensagem "vamos fazer seguinte, tem como voltar a versao de antes de 22h de ontem?". A mensagem original foi registrada em 08/10/2026 00:34:27.794 UTC (07/10 21:34:27.794 em São Paulo).

- Site: republicado o release oficial Firebase `377b1468256bab18`, originalmente de 07/10 às 14:02:02.821. Novo release `1791422878700000`, criado em 08/10 01:27:58.700 UTC.
- API: republicados os 45 arquivos íntegros dos argumentos do deploy v520, de 07/10 17:18:44.940 UTC, anterior ao pedido. A republicação aparece como v522 ACTIVE; hash do bundle `72711b17ac0a53537e0d2838a81cdcc288e87a3df014296d672b1521296d9b84`. O incremento de versão é do deploy; não representa mudanças no pacote restaurado.
- Gateway: restaurado `.firebase/rollback-20261006-2137/gateway-before-rollback.cjs` em `.firebase/gateway-production-source.cjs`. Esse backup foi feito antes da única substituição operacional realizada no rollback; a inspeção dos comandos desde o pedido original confirmou a proveniência. Reiniciado sem logout, PID 25440.
- Conta conectada: `553284039466@c.us`, preservada.
- Banco: nenhuma migration, restauração de dados, exclusão ou renomeação de conversa. O checkout principal com alterações locais foi preservado.

Verificação: site HTTP 200; nove de nove scripts públicos correspondem por SHA256 ao build anterior; rotas de ativação e projeção retornam HTTP 400 esperado para corpo vazio, sem ativar atendimento; gateway local e público HTTP 200, `ready`, `lastError: null`; fonte do gateway igual ao backup byte a byte. Houve erro de consulta de presença durante o estado temporário `starting`; a verificação final confirmou `ready`.

Artefatos: `.firebase/revert-before-rollback-request/verification.json`, `firebase-release-result.json`, `gateway.log`, `gateway-error.log`. Pacote restaurado: `.firebase/rollback-20261006-2137/api-before-user-rollback-request.json`. A tentativa com a credencial OAuth do script legado falhou com HTTP 401 sem deploy; a publicação foi feita pela conexão Supabase disponibilizada nesta tarefa.

Este registro substitui `2026-10-07-restored-baseline-new-number.md` como referência do conjunto atualmente em produção. A reconstrução aproximada v521 não está mais ativa.
