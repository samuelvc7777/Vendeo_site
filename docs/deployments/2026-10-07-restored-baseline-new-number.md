# Restauração da base anterior com número novo

Publicação concluída em produção. O usuário autorizou voltar à base anterior às 22h de 06/10/2026 mantendo a adaptação ao número novo.

## Fontes e limites da restauração

Esta publicação é uma reconstrução da base anterior com compatibilidade, não uma republicação byte a byte do release 21h37.

- Frontend: base isolada chat-controls-release, preservando o botão de reiniciar e o fluxo anterior de ativação; foram mantidas as adaptações de carregamento pelo número conectado, resolução de aliases, estado canônico, preservação do cache e acesso à projeção protegida.
- API: os arquivos recuperados da v509 foram usados quando íntegros. O resultado histórico de get_edge_function continha um marcador de truncamento no brain_orchestrator.ts; esse arquivo não era restaurável a partir daquela resposta. Foi substituído pela fonte íntegra do commit 9a193d2f de 06/10 às 11h38. Os módulos ausentes no retorno foram recuperados do pacote completo de suporte v510. O transporte WhatsApp permanece compatível com os IDs e filas por conta atuais. Foi mantida a rota interna de projeção para a RPC protegida no banco atual e a correção CAS da etapa inicial criada no primeiro atendimento. Pacote final: 46 arquivos; API ativa v521.
- Gateway: snapshot gateway-before-immediate-source.cjs, anterior às mudanças de sincronização imediata, com adaptação de conta já aplicada. Sessão persistente preservada, sem logout. Processo atual: 22208, número conectado 553284039466@c.us.
- Banco: nenhuma migration de retorno, exclusão, renomeação de conversa ou restauração de backup. Dados e progresso atuais permanecem armazenados nos IDs por conta.

## Verificação

- Build estático e TypeScript passaram.
- 14 testes executados contra os helpers e seleção de estado do frontend preparado, além dos dois cenários de reconciliação da lista; contato aparece uma vez e controles canônicos são preservados.
- Todos os imports locais do pacote API resolvidos; sintaxe de todos os arquivos TypeScript validada; bundler do Supabase aprovou o pacote íntegro. A primeira tentativa foi rejeitada pelo trecho truncado; não substituiu a API ativa. Após substituir pela fonte íntegra, v521 ficou ACTIVE.
- Frontend público HTTP 200; nove scripts públicos conferidos por SHA256 contra o build preparado; isolamento por conta presente no bundle.
- Rotas toggle-chat e state-patch em produção retornaram HTTP 400 esperado para corpo vazio; nenhum atendimento real foi ativado nesse teste.
- Gateway local retornou ready na conta esperada; logs de inicialização sem erro; requisições da API v521 confirmadas nos logs de produção.
- Contagem de mensagens da conta após publicação: 1357 (antes, 1356). Não houve exclusão ou rollback do banco.

## Artefatos operacionais

- Release do frontend: .firebase/rollback-20261006-2137/frontend/out.
- Pacote API publicado: .firebase/rollback-20261006-2137/api-restored-new-number.json.
- Backup da API anterior: .firebase/rollback-20261006-2137/api-before-rollback-v520.json.
- Backup do gateway anterior: .firebase/rollback-20261006-2137/gateway-before-rollback.cjs.
- Gateway ativo: .firebase/gateway-production-source.cjs, carregado pela entrada habitual.
- Logs: .firebase/rollback-20261006-2137/gateway.log e gateway-error.log.
- Verificação: .firebase/rollback-20261006-2137/verification.json.

O checkout principal contém outras alterações locais e não foi sobrescrito. Consultar estes artefatos como referência da produção em tarefas seguintes.
