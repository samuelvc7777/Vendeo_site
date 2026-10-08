# Ativação com cronograma concluído — 07/10/2026

Barbosa Facebook Lote 01 tinha schedule_status=completed_waiting_manual. A RPC de ativação gravava true, mas o trigger enforce_manual_schedule_transition_policy restaurava false. A conferência posterior retornava canonical_state_mismatch.

A rota toggle-chat agora verifica a conclusão antes de chamar a RPC e retorna HTTP 409 com instrução em português para selecionar o próximo cronograma. Não reinicia o cronograma nem altera objetivos concluídos.

API v520 publicada a partir dos 45 arquivos efetivamente presentes em v519, alterando apenas index.ts. Teste local cobre concluído, transição e ativo. Verificação real em produção no ID canônico do Barbosa confirmou HTTP 409 e code=schedule_completed_waiting_manual.
