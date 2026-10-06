import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20261006022055_conversation_schedules.sql", import.meta.url), "utf8");
const orchestrator = fs.readFileSync(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
const sdkBrain = fs.readFileSync(new URL("../supabase/functions/api/openai_sdk_brain.ts", import.meta.url), "utf8");
const progress = fs.readFileSync(new URL("../src/application/use-cases/ManageChatProgressUseCase.ts", import.meta.url), "utf8");
const schedulesUi = fs.readFileSync(new URL("../src/presentation/components/config/ConversationSchedulesManager.tsx", import.meta.url), "utf8");
const autoPilotUi = fs.readFileSync(new URL("../src/presentation/components/config/AutoPilotConfigManager.tsx", import.meta.url), "utf8");
const inboundQueue = fs.readFileSync(new URL("../supabase/functions/api/autopilot_inbound_queue.ts", import.meta.url), "utf8");

test("migração preserva o cronograma de venda atual", () => {
  assert.match(migration, /'schedule_sales'[\s\S]*?'Venda'/);
  assert.match(migration, /'fixed'[\s\S]*?180/);
  assert.match(migration, /set schedule_id = 'schedule_sales'/);
  assert.match(migration, /required', true/);
});

test("cronogramas têm duração, modelo e delay fixo ou por intervalo", () => {
  assert.match(migration, /duration_minutes integer/);
  assert.match(migration, /response_delay_mode text/);
  assert.match(migration, /response_delay_min_seconds integer/);
  assert.match(migration, /response_delay_max_seconds integer/);
  assert.match(migration, /brain_model text/);
  assert.match(migration, /gpt-6-luna/);
  assert.match(migration, /gpt-6\.1-sol/);
  assert.match(migration, /persisted_choice/);
});

test("delay variável é persistido e reutilizado", () => {
  assert.match(migration, /v_existing_started_at = v_first_pending/);
  assert.match(migration, /v_existing_until is not null/);
  assert.match(migration, /v_scheduled_at := v_existing_until/);
  assert.match(migration, /set ai_debounce_started_at = v_first_pending,[\s\S]*ai_debounce_until = v_scheduled_at/);
});

test("objetivos opcionais não bloqueiam o progresso", () => {
  assert.match(progress, /requiredPendingCount = objectives\.filter\([\s\S]*o\.required !== false/);
  assert.match(progress, /optionalPendingCount = objectives\.filter\([\s\S]*o\.required === false/);
  assert.match(progress, /is100Percent =[\s\S]*requiredPendingCount === 0/);
  assert.match(orchestrator, /stageComplete: requiredRemainingObjectives\.length === 0/);
});

test("Brain recebe cronograma, obrigatoriedade e modelo específico", () => {
  assert.match(orchestrator, /ensureConversationScheduleRuntime/);
  assert.match(orchestrator, /scheduleRuntime\.brainModel/);
  assert.match(orchestrator, /currentScheduleId: scheduleRuntime\.scheduleId/);
  assert.match(orchestrator, /currentStageRequired: scheduleRuntime\.executionMode === "connection_window" \? false : stageObjectivesForRouter\.stageRequired/);
  assert.match(sdkBrain, /CRONOGRAMA_ATUAL_ID/);
  assert.match(sdkBrain, /ETAPA_ATUAL_OBRIGATORIA/);
  assert.match(sdkBrain, /REGRA_OPCIONAIS/);
});

test("venda e finalização global são estados separados", () => {
  assert.match(migration, /sale conversion is no longer synonymous/i);
  assert.match(migration, /v_workflow_finalized := coalesce\(\(v_final_rules->>'workflow_finalized'\)::boolean, false\)/);
  assert.match(migration, /is_converted = case when v_is_converted then true else is_converted end/);
  assert.match(orchestrator, /finalWorkflowComplete = deliveryAwareWorkflowComplete && !hasNextSchedule/);
  assert.match(orchestrator, /salesScheduleCompleted/);
});

test("transição é recuperável e expiração não inventa conclusão", () => {
  assert.match(migration, /process_conversation_schedule_ready_transitions_atomic/);
  assert.match(migration, /process_conversation_schedule_expirations_atomic/);
  assert.match(migration, /expired_incomplete/);
  assert.match(migration, /Cronograma expirou com requisito obrigatório pendente/);
  assert.match(migration, /status = 'expired'/);
  assert.doesNotMatch(migration, /expired_incomplete'[\s\S]{0,300}status[^\n]*completed[^\n]*goal/i);
});

test("UI permite criar cronograma e configurar tempo/modelo", () => {
  assert.match(schedulesUi, /Novo cronograma/);
  assert.match(schedulesUi, /responseDelayMode/);
  assert.match(schedulesUi, /responseDelayMinSeconds/);
  assert.match(schedulesUi, /responseDelayMaxSeconds/);
  assert.match(schedulesUi, /SCHEDULE_BRAIN_MODELS/);
});


test("tempo e modelo globais não são mais autoridades", () => {
  assert.doesNotMatch(autoPilotUi, /Modelo do Brain/);
  assert.doesNotMatch(autoPilotUi, /Tempo de Espera antes de Responder/);
  assert.doesNotMatch(autoPilotUi, /responseDelayMinutes/);
  assert.doesNotMatch(autoPilotUi, /maxDebounceWindowMinutes/);
  assert.match(inboundQueue, /ensureConversationScheduleRuntime/);
  assert.doesNotMatch(inboundQueue, /config\?\.responseDelayMinutes/);
  assert.doesNotMatch(inboundQueue, /config\?\.maxDebounceWindowMinutes/);
  assert.doesNotMatch(orchestrator, /eq\("id", "openai_brain_model"\)/);
});


test("chat exibe o mesmo cronograma autoritativo sem iniciar run na leitura", () => {
  const runtimeModule = fs.readFileSync(new URL("../supabase/functions/api/conversation_schedule_runtime.ts", import.meta.url), "utf8");
  const apiIndex = fs.readFileSync(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");
  const stageBar = fs.readFileSync(new URL("../src/presentation/components/chat/ChatStageBar.tsx", import.meta.url), "utf8");
  const direct = fs.readFileSync(new URL("../src/presentation/components/chat/InstagramDirect.tsx", import.meta.url), "utf8");

  assert.match(runtimeModule, /readConversationScheduleRuntimeSnapshot/);
  assert.doesNotMatch(runtimeModule.match(/readConversationScheduleRuntimeSnapshot[\s\S]*$/)?.[0] || "", /ensure_conversation_schedule_run_atomic/);
  assert.match(apiIndex, /\/operator\/chat-runtime/);
  assert.match(apiIndex, /readConversationScheduleRuntimeSnapshot/);
  assert.match(stageBar, /Cronograma · \{scheduleName\}/);
  assert.match(stageBar, /Obrigatória/);
  assert.match(stageBar, /Opcional/);
  assert.match(stageBar, /brainModelLabel/);
  assert.match(direct, /scheduleRuntime\?\.scheduleName/);
  assert.match(direct, /scheduleRuntime=\{scheduleRuntime\}/);
});


test("operador pode trocar cronograma manualmente de forma atômica", () => {
  const manualMigration = fs.readFileSync(new URL("../supabase/migrations/20261006033859_manual_conversation_schedule_switch.sql", import.meta.url), "utf8");
  const stageBar = fs.readFileSync(new URL("../src/presentation/components/chat/ChatStageBar.tsx", import.meta.url), "utf8");
  const hook = fs.readFileSync(new URL("../src/presentation/hooks/useChatStages.ts", import.meta.url), "utf8");
  const apiIndex = fs.readFileSync(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");

  assert.match(manualMigration, /set_conversation_schedule_atomic/);
  assert.match(manualMigration, /status = 'cancelled'/);
  assert.match(manualMigration, /completedGoalIds.*\[\]/s);
  assert.match(manualMigration, /current_schedule_id/);
  assert.match(manualMigration, /- 'scheduledResponseAt'/);
  assert.match(manualMigration, /revoke all on function public\.set_conversation_schedule_atomic/);
  assert.match(apiIndex, /\/operator\/chat-schedule/);
  assert.match(hook, /const setSchedule = async/);
  assert.match(stageBar, /Mudar cronograma/);
  assert.match(stageBar, /availableSchedules\.map/);
  assert.match(stageBar, /Atual/);
});


test("cronograma sem etapas não falha silenciosamente no chat", () => {
  const stageBar = fs.readFileSync(new URL("../src/presentation/components/chat/ChatStageBar.tsx", import.meta.url), "utf8");
  const hook = fs.readFileSync(new URL("../src/presentation/hooks/useChatStages.ts", import.meta.url), "utf8");

  assert.match(stageBar, /Sem etapas/);
  assert.match(stageBar, /Configure/);
  assert.match(stageBar, /toast\.warning\("Esse cronograma ainda não tem etapas/);
  assert.match(hook, /schedule_has_no_stage/);
  assert.match(hook, /Adicione pelo menos uma etapa antes de selecioná-lo/);
});
