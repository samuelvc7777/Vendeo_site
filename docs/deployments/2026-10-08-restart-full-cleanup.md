# Reinício limpa agendamentos e runtime antigo

Solicitação: remover mensagens agendadas e pendências que permaneciam após o reinício, corrigindo também o botão Reiniciar.

A correção foi publicada no banco de produção `wsdualhvopidgqcumonr` pela migration `restart_clears_scheduling_and_stale_runtime`. O site e a API já chamavam a RPC alterada, `restart_autopilot_runtime_atomic`; não foi necessário trocar os bundles publicados.

A RPC agora remove agendamentos e ações pendentes da projeção, limpa motivos de pausa e atividade antiga, encerra administrativamente turnos antigos sem excluir decisões ou fatos, zera flags transitórias e cancela saídas comprovadamente ainda não enviadas. A fila WhatsApp é bloqueada durante a verificação e o cancelamento, para serializar a operação com a reserva do worker. Envios em andamento ou incertos continuam impedindo reinício. Histórico, objetivos e IDs confirmados permanecem preservados.

Reprodução antes da correção: o fixture `tests/fixtures/restart_clears_scheduling.sql` falhou com `RESET_LEFT_SCHEDULED_MESSAGES`. Depois da correção, o mesmo fixture passou, incluindo cancelamento da fila pendente, encerramento do turno antigo e recusa de reset durante envio ativo ou incerto. Todos os dados do teste foram desfeitos por rollback. A suíte `node scripts/test-automation-safety.mjs` passou com 87 testes.

Limpeza aplicada também a Luciano Facebook Lote 01 Ferreira, Wesley Facebook Lote 01 Bernardo, Wú Facebook Lote 01 e Warley Facebook Lote 01. Conferência final: os quatro em `idle`, sem horário agendado, sem mensagens pendentes, sem ações pendentes e sem jobs antigos. Não foi enfileirada uma nova resposta durante essa limpeza manual; o botão mantém seu comportamento de iniciar nova tentativa quando existe entrada sem resposta.

Backups em `.firebase/automation-audit/`: definição anterior da RPC, estados anteriores dos quatro chats e registros dos ciclos anteriores à limpeza. O encerramento administrativo é identificado por `administrativeClosure` e `closureReason`, sem afirmar que houve uma nova resposta da IA.
