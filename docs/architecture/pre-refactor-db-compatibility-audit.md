# Auditoria de compatibilidade do banco com a arquitetura pré-refatoração

Data da auditoria: 26/09/2026
Projeto Supabase: wsdualhvopidgqcumonr
Branch: fix/pre-refactor-db-compatibility
Referência: 4cbf582da8071ec1a92a67fc9214b0f6a41e9cd2
HEAD inicial: 37809c838fede353011f1f8526eaa1ee6ea7a332

## Resumo executivo

O repositório local está alinhado funcionalmente ao commit 4cbf582d. A auditoria foi somente de leitura; nenhum banco, dado, migration ou deploy foi alterado.

Foram comprovadas duas falhas distintas:

1. patch_autopilot_pause_atomic é incompatível com o código antigo. O código envia p_conversation_id, p_paused e p_reason; o banco remoto expõe somente p_conversation_id e p_paused. A chamada produz PGRST202/HTTP 404. A função também só permite service_role, embora o frontend antigo a chame pelo cliente browser.
2. late_agent_result_discarded é causado pela recuperação stale da Edge Function implantada. A versão 348 usa 180.000 ms; o contrato local usa TTL mínimo de 300 s e o Agent pode aguardar 120 s. A Edge Function limpa o token enquanto o Agent ainda executa. Ao retornar, o Brain não é mais dono do ciclo e bloqueia a outbox/envio.

A segunda falha não pode ser resolvida apenas com SQL: a limpeza prematura está em supabase/functions/api/index.ts. A correção definitiva exige ajustar o TTL/fluxo da Edge Function ou substituir a recuperação JavaScript pela RPC atômica. O SQL da RPC incompatível foi deixado como proposta local, sem aplicação.

## Estado confirmado

- Branch criada a partir da main limpa em 37809c83.
- Código local equivalente ao estado funcional de 4cbf582d.
- Edge Function api remota na versão técnica 348.
- Cron remoto ativo: autopilot-cron-tick, a cada minuto, chamando api/autopilot/cron-tick com segredo do Vault.
- Consultas remotas feitas apenas por leitura: migrations, funções, grants, políticas, tabelas, cron e logs.

## Contrato esperado pelo código antigo

- ACTIVE_CYCLE_TTL_SECONDS = 300 em supabase/functions/api/autopilot_cycle_safety.ts.
- AGENT_LOCAL_WAIT_MS = 120_000 em autopilot_cycle_safety.ts/openai_brain.ts.
- claim_experimental_cycle adquire o token em stage_completed_rules.active_cycle_token.
- brain_orchestrator.ts valida o token depois do Agent e antes de persistir a outbox.
- persist_durable_outbox_batch deve ocorrer antes de qualquer envio à Meta.
- A pausa altera ai_auto_respond, ai_debounce_until e os marcadores de cancelamento em stage_completed_rules.
- SupabaseAutoPilotRepository.ts chama patch_autopilot_pause_atomic com p_reason.

Existe um drift anterior às migrations remotas: 20260923170000_atomic_chat_progress_and_runtime_guard.sql cria a função de pausa com dois argumentos, mas o código antigo passa três. Portanto o mismatch de assinatura já existia entre código e migration; o remoto confirma a assinatura de dois argumentos.

## RPCs e contratos remotos

As funções abaixo foram confirmadas no schema public, como SECURITY DEFINER com search_path public. Todas estavam executáveis somente por service_role, exceto funções de trigger:

| RPC | Assinatura remota | Resultado |
|---|---|---|
| claim_experimental_cycle | text, text, integer | Compatível; mínimo efetivo de 300 s |
| claim_experimental_cycle_messages | text, text, text[] | Compatível |
| commit_experimental_cycle_if_owned | text, text, jsonb | Compatível |
| release_experimental_cycle_if_owned | text, text, text, timestamptz, text[], text[], text, jsonb, jsonb, boolean | Compatível |
| request_experimental_cycle_preemption | text, text, timestamptz | Compatível |
| ack_experimental_cycle_preemption | text, text, integer | Compatível |
| persist_durable_outbox_batch | text, text, jsonb | Compatível |
| claim_outbox_entry | text, text, text | Compatível |
| finalize_outbox_entry | text, text, text, text, text | Compatível |
| reconcile_outbox_entry | text, text, text | Compatível |
| record_inbound_message_atomic | 11 argumentos text | Compatível para uso service-side |
| patch_autopilot_hold_edit_atomic | text, boolean | Compatível |
| patch_autopilot_edit_preview_atomic | text, text | Compatível |
| patch_autopilot_pause_atomic | text, boolean | Incompatível com p_reason |

As RPCs de áudio claim_audio_delivery_reservation, claim_or_record_audio_delivery, commit_audio_delivery_sent, release_audio_delivery_reservation e update_audio_delivery_status também existem e não apresentaram mismatch de assinatura; todas estão restritas a service_role.

## Causa confirmada da pausa

A Edge Function e o frontend chamam:

    supabase.rpc("patch_autopilot_pause_atomic", {
      p_conversation_id: conversationId,
      p_paused: true,
      p_reason: "paused_manual",
    });

O remoto só possui:

    public.patch_autopilot_pause_atomic(text, boolean)

Os logs mostram PGRST202/HTTP 404 tanto na Edge Function quanto no browser. O fallback grava somente ai_auto_respond/ai_debounce_until, sem registrar cancel_current_cycle/status em stage_completed_rules. Isso deixa a pausa sem a semântica atômica esperada.

Mesmo com a assinatura corrigida, o browser não tem EXECUTE: as migrations de endurecimento revogaram as RPCs operacionais para anon/authenticated. A tabela continua acessível pela política vendeo_anon_app_access, mas a função não. O fallback atual é fail-closed e evita read-modify-write de stage_completed_rules.

## Causa exata de late_agent_result_discarded

O ciclo observado é:

1. O ciclo adquire active_cycle_token.
2. O Agent continua executando dentro do orçamento local.
3. A Edge Function 348 seleciona ciclos com active_cycle_at anterior a Date.now() - 180_000.
4. Ela atualiza diretamente stage_completed_rules, limpa active_cycle_token/active_cycle_at e rebaixa claimed para pending.
5. O Agent retorna depois da limpeza.
6. brain_orchestrator.ts executa checkCycleAuthority(), registra late_agent_result_discarded e retorna sem persistir a outbox ou enviar à Meta.

Os logs de 26/09/2026 mostram recuperação às 05:03:03.180Z para a conversa 1102757978793683 e descarte às 05:03:04.688Z; há sequências equivalentes para 1404481621891227 às 04:57, 04:59 e 05:02. A resposta é descartada antes da outbox; a Meta não é a causa primária desses casos.

O banco possui recover_stale_experimental_cycle_atomic e recover_stale_experimental_cycles_atomic, que usam lock/CAS e evidência da outbox, mas o código da Edge Function 348 confirmado não as chama. Elas são uma melhoria aditiva e não impedem a recuperação JavaScript de 180 s.

## UI, Realtime, RLS e envio

O estado visual usa a linha __autopilot_states__ em instagram_conversations e o broadcast vendeo_realtime_chat/autopilot_state_update. instagram_conversations e instagram_messages estão na publicação supabase_realtime.

As políticas atuais vendeo_anon_app_access permitem ALL a anon/authenticated para as tabelas públicas, inclusive instagram_conversations, instagram_messages, persona_memory, contact_memory_facts e audio_delivery_history. Isso foi restaurado por 20260925223542_restore_anonymous_app_access. As RPCs operacionais continuam service_role-only. guard_stage_completed_rules_integrity() impede que anon/authenticated alterem diretamente os campos operacionais, mas permite as mutações dos SECURITY DEFINER.

Não há evidência de falha de Realtime como causa do descarte do Agent. Nos ciclos analisados, o resultado morre no check de autoridade antes da outbox. A falha da pausa pode causar estado visual/operacional divergente por causa da assinatura e dos grants.

O fluxo browser não depende somente da RPC direta. Depois de saveChatState(), useAutoPilot.ts chama o endpoint oficial toggle-chat; ao desativar, também chama autopilot/pause. A chamada é fire-and-forget, mas existe no caminho atual e não há bug concreto de ausência desse endpoint após a falha da RPC browser. Por isso esta correção mantém o fail-closed do repositório e não abre a função privilegiada para anon.

verify_autopilot_cron_token(text) existe, lê autopilot_cron_token do Vault e é service_role-only. A Edge Function 348 não chama essa função; o cron envia o segredo no header, mas o endpoint antigo não mostra a validação da função.

## Mapa das migrations posteriores

| Migration | Evidência/efeito observado | Classificação |
|---|---|---|
| 20260925182415_atomic_stale_cycle_recovery | Criou as duas RPCs de recuperação stale atômica | Aditiva; não substitui a recuperação JavaScript |
| 20260925193449_protect_sensitive_inbound_messages | SQL não está no Git; o nome indica proteção de inbound | Não atribuir regra específica sem o SQL |
| 20260925193851_restrict_manual_review_rpc | SQL não está no Git; RPCs operacionais aparecem service_role-only | Pode afetar chamadas diretas |
| 20260925221536_restrict_single_operator_access | Revogou acesso público, habilitou RLS e criou política de operador | Políticas de tabela foram depois sobrepostas |
| 20260925221858_route_privileged_rpc_calls | Removeu wrappers e reteve execução privilegiada | Explica a restrição do browser |
| 20260925222041_harden_function_paths_and_indexes | Endureceu search_path/políticas e criou índices | Aditiva; não explica PGRST202 |
| 20260925223542_restore_anonymous_app_access | Restaurou políticas/grants de tabela anon/authenticated | Não restaurou EXECUTE de RPC |
| 20260925233201_autopilot_cron_vault_auth | Criou verify_autopilot_cron_token e configurou segredo do cron | Aditiva; endpoint antigo não usa a RPC |

Essas migrations podem permanecer aplicadas; não há justificativa para rollback remoto de dados. A compatibilidade explícita necessária é a assinatura de pausa. Os grants do browser exigem decisão de segurança separada e não devem ser reabertos automaticamente.

## Correção preparada

Foi criada a migration supabase/migrations/20260926100734_restore_pre_refactor_pause_rpc_compatibility.sql. Ela adiciona a sobrecarga de três argumentos, preserva a função de dois argumentos e mantém a mutação atômica. A migration existe no repositório, mas não foi aplicada, não faz rollback de dados e não foi enviada ao Supabase.

A migration libera a nova assinatura somente para service_role, corrigindo as chamadas da Edge Function sem reabrir uma RPC privilegiada para cliente anônimo. O frontend continuará usando o fallback até haver decisão explícita sobre como autorizar a chamada browser.

O problema late_agent_result_discarded requer correção da Edge Function: usar no mínimo o mesmo TTL efetivo de 300 s e evidência de outbox, ou chamar a recuperação atômica. Não é seguro mascará-lo com uma migration.

## Validação futura

1. Aplicar a proposta somente em staging.
2. Confirmar as duas assinaturas e grants em pg_proc.
3. Exercitar pausa/resume service-side com p_reason e conferir cancel_current_cycle, status, ai_auto_respond e retorno JSON.
4. Decidir separadamente se o browser terá RPC autorizada; sem isso, validar o fallback e o endpoint autorizado.
5. Executar um Agent acima de 180 s e verificar que o token não é limpo antes do retorno.
6. Confirmar Agent -> outbox -> claim/send/finalize e ausência de late_agent_result_discarded.
7. Validar Realtime e o caminho de áudio.
8. Só então decidir se o SQL vira migration aplicável. Nenhum desses passos remotos foi executado nesta tarefa.


## Validação local desta branch

- npx tsc --noEmit: aprovado.
- npm run build: aprovado com Next.js 16.3.4.
- git diff --check: aprovado.
- Testes executados: tests/test_strict_openai_pilot_propagation.mjs, tests/test_brain_objective_evidence.mjs, tests/test_conversational_progression.mjs e src/__tests__/resilience-and-queries.test.mjs.
- Resultado: 27 aprovados e 4 falhas preexistentes no estado antigo. As falhas são o contrato de DNA esperado 1.1.0 contra o valor atual 1.5.7 e casos legados que esperam delegate_mission/seleção de subagente; nenhum arquivo da auditoria altera esses contratos.
- Não existem no repositório suítes específicas separadas para durable outbox ou entrega de áudio; os contratos remotos dessas RPCs foram verificados por consulta de leitura.

## Correção implementada nesta branch

- supabase/functions/api/index.ts deixou de usar 180_000 e passou a usar getStaleCycleThresholdIso(), derivado de ACTIVE_CYCLE_TTL_SECONDS = 300; a consulta usa lte para permitir recuperação a partir de 300 s.
- supabase/functions/api/autopilot_cycle_safety.ts concentra o cálculo do threshold e expõe isCycleStaleAt() para teste determinístico.
- A migration supabase/migrations/20260926100734_restore_pre_refactor_pause_rpc_compatibility.sql adiciona a assinatura de três argumentos sem remover a assinatura antiga de dois.
- A nova assinatura usa FOR UPDATE, atualiza ai_auto_respond, limpa ai_debounce_until ao pausar, registra e remove os marcadores de pausa, e concede EXECUTE somente a service_role. PUBLIC, anon e authenticated não recebem EXECUTE.
- O fluxo browser continua chamando o endpoint oficial toggle-chat/pause depois de saveChatState(); não foi aberta RPC privilegiada para anon nem foi feita refatoração de frontend.
- tests/test_pre_refactor_runtime_compatibility.mjs cobre os limiares de 180/299/300 s, authority, superseded, outbox com e sem ownership, assinatura/grants SQL e autoridade do endpoint.

Validação final desta correção: npx tsc --noEmit aprovado; npm run build aprovado; teste novo 11/11 aprovado; suíte relevante combinada 38/42 aprovada, com 4 falhas antigas de contrato de DNA/subagente; git diff --check aprovado. Nenhuma migration foi aplicada e o Supabase remoto não foi alterado.

A consulta remota de verificação após as alterações locais ainda retornou somente patch_autopilot_pause_atomic(text, boolean), com anon=false, authenticated=false e service_role=true. Isso confirma que a migration não foi aplicada no projeto remoto.
