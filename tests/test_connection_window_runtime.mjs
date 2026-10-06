import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const connectionMigration = fs.readFileSync(
  new URL("../supabase/migrations/20261006060603_connection_window_arsenal.sql", import.meta.url),
  "utf8",
);
const hardeningMigration = fs.readFileSync(
  new URL("../supabase/migrations/20261006101932_harden_connection_window_runtime.sql", import.meta.url),
  "utf8",
);
const manualSwitchMigration = fs.readFileSync(
  new URL("../supabase/migrations/20261006033859_manual_conversation_schedule_switch.sql", import.meta.url),
  "utf8",
);
const connectionRuntime = fs.readFileSync(
  new URL("../supabase/functions/api/connection_window_runtime.ts", import.meta.url),
  "utf8",
);
const scheduleRuntime = fs.readFileSync(
  new URL("../supabase/functions/api/conversation_schedule_runtime.ts", import.meta.url),
  "utf8",
);
const orchestrator = fs.readFileSync(
  new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
  "utf8",
);
const sdkBrain = fs.readFileSync(
  new URL("../supabase/functions/api/openai_sdk_brain.ts", import.meta.url),
  "utf8",
);
const schedulesUi = fs.readFileSync(
  new URL("../src/presentation/components/config/ConversationSchedulesManager.tsx", import.meta.url),
  "utf8",
);
const connectionUi = fs.readFileSync(
  new URL("../src/presentation/components/config/ConnectionWindowManager.tsx", import.meta.url),
  "utf8",
);
const stageBar = fs.readFileSync(
  new URL("../src/presentation/components/chat/ChatStageBar.tsx", import.meta.url),
  "utf8",
);
const scheduleUseCase = fs.readFileSync(
  new URL("../src/application/use-cases/ManageConversationSchedulesUseCase.ts", import.meta.url),
  "utf8",
);

test("1. Venda permanece goal_driven em banco, domínio e UI", () => {
  assert.match(hardeningMigration, /id <> 'schedule_sales' or execution_mode = 'goal_driven'/);
  assert.match(scheduleUseCase, /id === "schedule_sales"[\s\S]*executionMode !== "goal_driven"/);
  assert.match(schedulesUi, /isSalesModeLocked = editing\?\.id === "schedule_sales"/);
});

test("2. connection_window não exige objetivos/checkpoints", () => {
  assert.match(connectionMigration, /connection_window is never semantically blocked by ChatStage checkpoints/);
  assert.match(connectionMigration, /set is_required = false,[\s\S]*goals = '\[\]'::jsonb/);
  assert.match(sdkBrain, /não existem checkpoints a cumprir neste modo/);
});

test("3. arsenal vazio não quebra runtime nem inferência", () => {
  assert.match(connectionRuntime, /if \(!items\.length\) return \[\]/);
  assert.match(sdkBrain, /ARSENAL_DISPONIVEL_AGORA: vazio\. Isso não impede a conversa/);
});

test("4. arsenal é opcional e não bloqueia conclusão", () => {
  assert.match(connectionMigration, /Optional semantic resources for connection_window schedules\. Not goals\/checkpoints/);
  assert.match(sdkBrain, /Itens não usados não são falha/);
});

test("5. recurso moment expirado é filtrado antes do Brain", () => {
  assert.match(connectionRuntime, /function validityAllowsNow/);
  assert.match(connectionRuntime, /if \(validity === "moment"\)/);
  assert.match(connectionRuntime, /if \(!validityAllowsNow\(item, now\)\) return \[\]/);
  assert.match(scheduleRuntime, /const arsenalCandidates = base\.runId[\s\S]*await loadConnectionWindowArsenal/);
});

test("6. maxUses vale por conversa inteira e é protegido atomicamente", () => {
  assert.match(connectionRuntime, /\.eq\("conversation_id", params\.conversationId\)[\s\S]*\.order\("created_at"/);
  assert.doesNotMatch(
    connectionRuntime.match(/from\("conversation_arsenal_usage"\)[\s\S]*?if \(usageError\)/)?.[0] || "",
    /schedule_run_id/,
  );
  assert.match(hardeningMigration, /status in \('reserved','sending','sent'\)/);
  assert.match(hardeningMigration, /arsenal_item_max_uses_reached/);
});

test("7. cooldown vale por conversa e é revalidado no backend", () => {
  assert.match(connectionRuntime, /cooldownMinutes/);
  assert.match(connectionRuntime, /eligibleAt = lastUsedAt\.getTime\(\) \+ cooldownMinutes/);
  assert.match(hardeningMigration, /arsenal_item_cooldown_active/);
});

test("8. Brain só pode escolher item autorizado para o turno", () => {
  assert.match(sdkBrain, /const arsenalById = new Map/);
  assert.match(sdkBrain, /const candidate = arsenalById\.get\(arsenalItemId\)/);
  assert.match(sdkBrain, /arsenal_item_not_authorized_for_this_turn/);
});

test("9. backend não escolhe recurso por semântica/palavra-chave", () => {
  assert.match(sdkBrain, /semanticContent/);
  assert.match(sdkBrain, /quando_usar/);
  assert.doesNotMatch(connectionRuntime, /semanticContent\?\.includes|usageInstruction\?\.includes|title\?\.includes/);
  assert.match(orchestrator, /(?:candidate|item)\.itemId === act\.arsenalItemId/);
});

test("10. entrega confirmada registra uso sent", () => {
  assert.match(orchestrator, /params\.status === "sent"[\s\S]*projectConfirmedBrainAction/);
  assert.match(orchestrator, /p_status: "sent"/);
  assert.match(hardeningMigration, /when v_effective_status = 'sent' then coalesce\(used_at, v_now\)/);
});

test("11. falha de entrega não conta como uso bem-sucedido", () => {
  assert.match(orchestrator, /params\.status === "failed_confirmed"[\s\S]*\? "failed"/);
  assert.match(hardeningMigration, /case when p_status = 'sent' then v_now else null end/);
});

test("12. retry é idempotente e não duplica mídia", () => {
  assert.match(connectionMigration, /conversation_arsenal_usage_action_uidx/);
  assert.match(hardeningMigration, /where action_id = p_action_id[\s\S]*for update/);
  assert.match(hardeningMigration, /'idempotent', true/);
  assert.match(orchestrator, /idempotencyKey: actions\.length === 1/);
});

test("13. fase temporal é derivada do relógio", () => {
  assert.match(connectionRuntime, /computeScheduleElapsedPercent/);
  assert.match(connectionRuntime, /resolveTemporalPhase/);
  assert.match(connectionRuntime, /fromPercent: 0,[\s\S]*toPercent: 30/);
  assert.match(connectionRuntime, /fromPercent: 30,[\s\S]*toPercent: 75/);
  assert.match(connectionRuntime, /fromPercent: 75,[\s\S]*toPercent: 100/);
});

test("14. ação final só fica disponível na janela configurada", () => {
  assert.match(connectionRuntime, /activationThresholdPercent/);
  assert.match(connectionRuntime, /availableNow = !delivered && !manual && !failed && params\.elapsedPercent >= threshold/);
});

test("15. ação final entregue encerra/avança pelo worker normal", () => {
  assert.match(connectionMigration, /final_action_status = 'delivered'/);
  assert.match(connectionMigration, /expires_at = least\(coalesce\(expires_at, v_now\), v_now\)/);
  assert.match(orchestrator, /mark_connection_final_action_delivered_atomic/);
  assert.match(orchestrator, /process_conversation_schedule_expirations_atomic/);
});

test("16. expiração sem oportunidade gera manual_required", () => {
  assert.match(connectionMigration, /final_action_status = 'manual_required'/);
  assert.match(connectionMigration, /Ação manual pendente/);
});

test("17. expiração não dispara o áudio automaticamente", () => {
  assert.match(sdkBrain, /nunca envie por conta da expiração sem novo turno do contato/);
  const expirationWrapper = connectionMigration.slice(
    connectionMigration.indexOf("create or replace function public.process_conversation_schedule_expirations_atomic"),
  );
  assert.doesNotMatch(expirationWrapper, /sendMetaTextMessage|graph\.instagram|enqueueAndWaitWhatsApp2Delivery/);
});

test("18. run vira completed_with_manual_action", () => {
  assert.match(connectionMigration, /status = 'completed_with_manual_action'/);
  assert.match(connectionMigration, /'completed_with_manual_action'/);
});

test("19. abrir chat não inicia nem altera run", () => {
  const snapshot = scheduleRuntime.slice(scheduleRuntime.indexOf("export async function readConversationScheduleRuntimeSnapshot"));
  assert.doesNotMatch(snapshot, /ensure_conversation_schedule_run_atomic/);
  assert.doesNotMatch(snapshot, /\.insert\(/);
  assert.match(snapshot, /completed_with_manual_action/);
});

test("20. troca manual de cronograma continua atômica", () => {
  assert.match(manualSwitchMigration, /set_conversation_schedule_atomic/);
  assert.match(manualSwitchMigration, /status = 'cancelled'/);
  assert.match(manualSwitchMigration, /current_schedule_id/);
});

test("21. contexto do Brain muda conforme executionMode", () => {
  assert.match(scheduleRuntime, /if \(schedule\.executionMode === "connection_window"\)/);
  assert.match(scheduleRuntime, /ARSENAL_REGRA/);
  assert.match(sdkBrain, /currentScheduleExecutionMode === "connection_window"/);
  assert.match(sdkBrain, /CONNECTION_WINDOW_REGRA_CENTRAL/);
});

test("22. recursos expirados/recorrentes são filtrados antes da inferência", () => {
  assert.match(connectionRuntime, /validityAllowsNow\(item, now\)/);
  assert.match(connectionRuntime, /recurringRuleAllowsNow/);
  assert.match(connectionRuntime, /valid_until/);
});

test("ledger de uso é backend-only", () => {
  assert.match(hardeningMigration, /drop policy if exists vendeo_anon_app_access on public\.conversation_arsenal_usage/);
  assert.match(hardeningMigration, /create policy conversation_arsenal_usage_service_role/);
  assert.match(hardeningMigration, /revoke all privileges on table public\.conversation_arsenal_usage from anon, authenticated/);
  assert.match(hardeningMigration, /grant select, insert, update, delete on table public\.conversation_arsenal_usage to service_role/);
  assert.match(hardeningMigration, /create index if not exists conversation_arsenal_usage_item_idx/);
});

test("arsenal é reservado antes do dispatch e liberado se a decisão não persistir", () => {
  assert.match(orchestrator, /reserveConnectionWindowArsenalBatch/);
  assert.match(orchestrator, /p_status: "reserved"/);
  assert.match(orchestrator, /releaseConnectionWindowArsenalReservations/);
  assert.match(orchestrator, /brain_decision_outbox_atomic_persist_failed/);
});

test("foto do arsenal usa attachment image também no Instagram", () => {
  assert.match(orchestrator, /outboxEntry\.messageType === "image"[\s\S]*type: "image"[\s\S]*url: imageUrl/);
});

test("UI de connection_window não exibe a etapa técnica como progresso", () => {
  assert.match(stageBar, /isConnectionWindow && scheduleRuntime/);
  assert.match(stageBar, /Fase temporal/);
  assert.match(stageBar, /Tempo restante/);
  assert.match(stageBar, /Ação manual pendente/);
});

test("configuração da janela reaproveita persona_audios sem objectiveId", () => {
  assert.match(connectionUi, /usePersonaAudios/);
  assert.match(connectionUi, /assetId: finalAudioId/);
  const finalActionBlock = connectionUi.slice(connectionUi.indexOf("const finalAction:"), connectionUi.indexOf("setSavingRules"));
  assert.doesNotMatch(finalActionBlock, /objectiveId:/);
});
