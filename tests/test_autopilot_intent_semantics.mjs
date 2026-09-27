import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20260927112607_separate_autopilot_runtime_pause_and_projection_patch.sql", import.meta.url), "utf8");
const api = await readFile(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");
const brain = await readFile(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
const manualSql = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.prepare_brain_manual_resolution("));
const runtimeSql = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.set_autopilot_runtime_state_atomic("), migration.indexOf("CREATE OR REPLACE FUNCTION public.disable_autopilot_explicitly_atomic("));
const projectionStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.patch_autopilot_projection_state_atomic(");
const projectionEnd = migration.indexOf("REVOKE ALL ON FUNCTION public.patch_autopilot_projection_state_atomic(", projectionStart);
const projectionSql = migration.slice(projectionStart, projectionEnd);

test("A: toggle ON grava intenção verdadeira e retorna versão canônica", () => {
  const armSql = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.arm_autopilot_with_watermark_atomic("));
  assert.match(armSql, /ai_auto_respond\s*=\s*true/);
  assert.match(armSql, /'oldValue', v_old_enabled/);
  assert.match(api, /select\("ai_auto_respond, updated_at"\)/);
  assert.match(api, /canonicalRow\.ai_auto_respond !== isEnabled/);
});

test("B: manual_resolution registra waiting_human sem desligar a intenção", () => {
  assert.match(brain, /p_status:\s*"waiting_human"/);
  assert.doesNotMatch(runtimeSql, /ai_auto_respond\s*=/);
  assert.match(manualSql, /v_rules->>'status' IN \('paused_manual', 'waiting_human'\)/);
});

test("C: responder ao Brain retoma o turno sem religar uma conversa desligada", () => {
  assert.match(manualSql, /IF NOT v_enabled THEN RAISE EXCEPTION 'autopilot disabled by explicit operator action'/);
  assert.doesNotMatch(manualSql, /ai_auto_respond\s*=\s*true/);
  assert.match(manualSql, /status = 'brain_running'/);
});

test("D: cancelar ciclo preserva habilitação e invalida o ciclo atual", () => {
  const pauseRoute = api.slice(api.indexOf("/autopilot/pause"), api.indexOf("/autopilot/toggle-chat"));
  assert.match(pauseRoute, /set_autopilot_runtime_state_atomic/);
  assert.match(pauseRoute, /p_cancel_current_cycle:\s*true/);
  assert.match(pauseRoute, /status:\s*"idle"/);
  assert.doesNotMatch(pauseRoute, /disable_autopilot_explicitly_atomic|ai_auto_respond:\s*false/);
});

test("E: apenas a rota de toggle OFF usa a RPC explícita de desligamento", () => {
  assert.match(api, /disable_autopilot_explicitly_atomic/);
  assert.match(migration, /SET ai_auto_respond = false/);
  assert.match(api, /reason: "operator_toggle_off"/);
  assert.doesNotMatch(api, /\.rpc\(\s*["']patch_autopilot_pause_atomic/);
});

test("F: pausas operacionais aceitam guardrail/handoff sem alterar ai_auto_respond", () => {
  assert.match(runtimeSql, /'paused_guardrail', 'paused_handoff'/);
  assert.doesNotMatch(runtimeSql, /ai_auto_respond\s*=/);
  assert.match(api, /convRules\.status === "paused_guardrail"/);
});

test("G: projeção usa lock por conversa, versão CAS e nunca substitui o mapa global", () => {
  assert.match(projectionSql, /FOR UPDATE/);
  assert.match(projectionSql, /p_expected_state_updated_at/);
  assert.match(projectionSql, /jsonb_set\(v_states, ARRAY\[p_conversation_id\]/);
  assert.match(projectionSql, /SELECT COALESCE\(ai_auto_respond, false\)/);
  assert.doesNotMatch(projectionSql, /stage_completed_rules\s*=\s*p_state_patch/);
});

test("H: evidência inválida não confirma objetivo nem lança falha semântica", () => {
  assert.match(brain, /brain_objective_reference_rejected/);
  assert.doesNotMatch(brain, /throw new Error\("BRAIN_PLAN_INVALID_OBJECTIVE_EVIDENCE"\)/);
  assert.match(brain, /candidateObjectiveEvidence\.push/);
  assert.match(brain, /evidenceMessageId: String\(message\.id\)/);
});
