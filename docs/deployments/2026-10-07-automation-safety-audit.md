# Investigação e correções da automação

Auditoria iniciada após a restauração do estado anterior ao pedido de rollback. As correções foram feitas sobre os artefatos realmente publicados: API v522, gateway restaurado e build Firebase `377b1468256bab18`. O checkout principal já tinha alterações de outras tarefas; elas foram preservadas.

## Problemas reproduzidos e corrigidos

- Uma falha ao persistir a confirmação do WhatsApp podia transformar um envio confirmado em falha. O worker preserva o ID do provedor, e a conclusão no banco não pode rebaixar `sent`.
- A fila podia reservar novamente um envio `sending` antigo sem saber se tinha sido entregue. Agora ele fica `uncertain`; não autoriza reenvio automático.
- Erros durante o envio e falhas ao consultar uma entrega já enfileirada podiam ser tratados como não envio. Agora ficam incertos. Falhas comprovadas no download antes do envio continuam recuperáveis.
- Uma resposta sem ID do provedor podia ser marcada como enviada. WhatsApp e Instagram passam a exigir confirmação real.
- Um áudio antigo no histórico podia confirmar uma ação diferente. A recuperação do WhatsApp exige a fila exata, a conversa e a conta corretas; nos demais canais a evidência de histórico precisa ter o ID exato.
- A finalização podia declarar sucesso apesar de erro do banco e regravar todo o JSON da conversa. Foi removido esse fallback. O dispatcher bloqueia o restante do lote quando a confirmação não é persistida.
- Conversas pausadas ou desligadas ocupavam a lista de entregas. A seleção agora considera o estado da automação e só inclui ações incertas pausadas quando há confirmação exata para reconciliar, sem enviar.
- A RPC que reserva uma ação não conferia a pausa da conversa. Agora bloqueia IA desligada, espera humana, cancelamento e pausas operacionais sob o mesmo lock da conversa.
- Outbox confirmada e ação normalizada incerta podiam divergir indefinidamente. A recuperação corrige a projeção usando a confirmação exata do WhatsApp, inclusive IDs incorretos salvos pelo reconciliador antigo, sem reenviar nem reativar atendimento.

## Publicação

- Supabase `wsdualhvopidgqcumonr`: API **v525 ACTIVE**, bundle `57ef48f66ffe27c049550d93f00c8c63f941575e567df767a5a1cddaac81f474`. Apenas `api/brain_orchestrator.ts` e `api/whatsapp2_gateway.ts` foram modificados nos 45 arquivos do pacote anterior.
- Migrations: `harden_whatsapp_delivery_and_scheduler` e `respect_automation_pause_in_outbox_claim`, alinhadas às versões aplicadas `20261008020018` e `20261008020021` durante a consolidação de 08/10.
- Gateway: fonte auditada publicada em `.firebase/gateway-production-source.cjs`, PID **4308**, conectado à mesma conta, sem logout. SHA256 `69d612618b5ebc356c69e3ff5d79eaf0da4bc2fb8282af90c3bbef4d7ac0b36f`.
- Firebase: build anterior preservado. Nove de nove scripts públicos conferidos por SHA256; site HTTP 200. Rotas de ativação e projeção recusam corpo vazio com HTTP 400 esperado.
- Backups operacionais e evidências em `.firebase/automation-audit/`: pacote anterior em `.firebase/rollback-20261006-2137/api-before-user-rollback-request.json`, definições SQL anteriores, gateway anterior, manifest e verificação.

## Validação e limites

Cada falha corrigida teve reprodução antes da alteração. A suíte selecionada pode ser executada com `node scripts/test-automation-safety.mjs`. Abrange identidade, aliases, escopo por conta, ativação, histórico, fila, confirmação, recuperação, transferência e sincronização Tinder. O comando executa **87 testes**, incluindo um arquivo com 13 cenários adicionais de autorização manual de retry.

Os dois fixtures SQL em `tests/fixtures/automation_*_rpc_boundaries.sql` verificam 14 condições: confirmação monotônica, ausência de ID, envio antigo incerto, exclusão mútua, pausas e ativação válida. Executados no banco real com rollback de todos os dados de teste. Nenhuma mensagem de teste foi enviada a clientes.

Conferência final em 08/10/2026 02:06:56 UTC (07/10 23:06 em São Paulo): zero conversas na lista de entrega vencida, zero ações incertas com entrega já confirmada, zero entregas `sent` sem ID do provedor, zero entregas pendentes há mais de cinco minutos e zero novos eventos de falha/cancelamento desde a publicação v525. Todos os dados dos fixtures foram desfeitos. Esses números descrevem o momento da consulta, não um período prolongado de observação.

A suíte antiga completa não foi declarada aprovada: há harnesses com injeções de runtime e assertions que não correspondem ao pacote publicado, além de um teste que exige um Markdown não incluído no bundle. Eles não foram usados como evidência positiva desta publicação.

Houve anteriormente indisponibilidade HTTP 429 do serviço OpenAI Flex. A configuração de custo não foi trocada silenciosamente. Falhas externas, desconexão do WhatsApp e resultados sem confirmação continuam possíveis; o sistema deve representá-los corretamente e não repetir envios às cegas. Esta auditoria reduz causas comprovadas e acrescenta regressões, mas não é garantia de ausência absoluta de bugs.

Este documento passa a ser a referência das correções posteriores ao registro `2026-10-07-reverted-rollback-request.md`.
