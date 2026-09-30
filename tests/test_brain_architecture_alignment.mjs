import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { computeBoundedDebounce } from "../supabase/functions/api/debounce_policy.ts";
import {
  fetchSessionRecoveryBootstrap,
  validateConversationBrainPlan,
  validateResponseGenerationInvariant,
} from "../supabase/functions/api/openai_brain.ts";

function basicPlan(outboundActions) {
  return {
    action: "reply",
    objectiveDecision: "none",
    responses: outboundActions.filter((action) => action.type === "text").map((action) => action.text),
    outboundActions,
    turnContract: {
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "natural",
      directQuestions: [],
    },
  };
}

test("debounce nunca ultrapassa o teto contado da primeira mensagem do lote", () => {
  const start = Date.parse("2026-09-28T12:00:00.000Z");
  const first = computeBoundedDebounce({ nowMs: start, responseDelayMinutes: 1, maxDebounceWindowMinutes: 3 });
  assert.equal(first.scheduledAt, "2026-09-28T12:01:00.000Z");
  const almostAtCap = computeBoundedDebounce({
    nowMs: start + 170_000,
    responseDelayMinutes: 1,
    maxDebounceWindowMinutes: 3,
    batchStartedAt: first.batchStartedAt,
  });
  assert.equal(almostAtCap.scheduledAt, "2026-09-28T12:03:00.000Z");
  assert.equal(almostAtCap.capped, true);

  const atCap = computeBoundedDebounce({
    nowMs: start + 180_000,
    responseDelayMinutes: 1,
    maxDebounceWindowMinutes: 3,
    batchStartedAt: first.batchStartedAt,
  });
  assert.equal(atCap.dueNow, true);
});

test("teto menor que quiet period é elevado ao próprio quiet period", () => {
  const start = Date.parse("2026-09-28T12:00:00.000Z");
  const result = computeBoundedDebounce({
    nowMs: start,
    responseDelayMinutes: 10,
    maxDebounceWindowMinutes: 3,
  });
  assert.equal(result.maxWindowMs, 10 * 60_000);
  assert.equal(result.scheduledAt, "2026-09-28T12:10:00.000Z");
});

test("nova session recebe fatos manuais permanentes mesmo sem histórico recente", async () => {
  const query = (data) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => ({ data, error: null }),
    };
    return chain;
  };
  const supabase = {
    from(table) {
      if (table === "persona_memory") {
        return query([{
          key: "manual_resolution_viagem_eua",
          value: { question: "já foi aos Estados Unidos?", fact: "nunca fui aos Estados Unidos" },
          updated_at: "2026-09-28T11:00:00Z",
        }]);
      }
      if (table === "instagram_messages") return query([]);
      throw new Error(`tabela inesperada: ${table}`);
    },
  };

  const bootstrap = await fetchSessionRecoveryBootstrap(supabase, "conv-test");
  assert.equal(bootstrap.messageCount, 0);
  assert.equal(bootstrap.persistentFactCount, 1);
  assert.match(bootstrap.text, /FATOS MANUAIS PERMANENTES PARA NOVAS SESSÕES/);
  assert.match(bootstrap.text, /nunca fui aos Estados Unidos/);
});

test("cadência do Brain exige e preserva o tempo de toda mensagem", () => {
  const firstMissing = basicPlan([
    { type: "text", text: "balão um" },
  ]);
  const firstMissingResult = validateConversationBrainPlan(firstMissing);
  assert.equal(firstMissingResult.valid, false);
  assert.match(firstMissingResult.error || "", /delay_before_send é obrigatório/);

  const missing = basicPlan([
    { type: "text", text: "balão um", delay_before_send: 9 },
    { type: "text", text: "balão dois" },
  ]);
  const missingResult = validateConversationBrainPlan(missing);
  assert.equal(missingResult.valid, false);
  assert.match(missingResult.error || "", /delay_before_send é obrigatório/);
  assert.equal(missing.outboundActions[0].delayBeforeSendSeconds, 9);

  const valid = basicPlan([
    { type: "text", text: "balão um", delay_before_send: 31 },
    { type: "text", text: "balão dois", delay_before_send: 8 },
  ]);
  const validResult = validateConversationBrainPlan(valid);
  assert.equal(validResult.valid, true, validResult.error);
  assert.equal(valid.outboundActions[0].delayBeforeSendSeconds, 31);
  assert.equal(valid.outboundActions[1].delayBeforeSendSeconds, 8);
});

test("backend aceita quantidade dinâmica de mensagens decidida pelo Brain", () => {
  const actions = Array.from({ length: 10 }, (_, index) => ({
    type: "text",
    text: `balão ${index + 1}`,
    delay_before_send: index === 0 ? 0 : 2,
  }));
  const plan = basicPlan(actions);
  const contractResult = validateConversationBrainPlan(plan);
  const generationResult = validateResponseGenerationInvariant(plan);
  assert.equal(contractResult.valid, true, contractResult.error);
  assert.equal(generationResult.valid, true, generationResult.error);
  assert.equal(plan.outboundActions.length, 10);
});

test("após áudio o Brain ainda precisa informar a pausa humana", () => {
  const missing = basicPlan([
    { type: "audio", audioId: "audio_test", delay_before_send: 0 },
    { type: "text", text: "e vc?" },
  ]);
  const missingResult = validateConversationBrainPlan(missing);
  assert.equal(missingResult.valid, false);
  assert.match(missingResult.error || "", /delay_before_send é obrigatório/);

  const valid = basicPlan([
    { type: "audio", audioId: "audio_test", delay_before_send: 0 },
    { type: "text", text: "e vc?", delay_before_send: 7 },
  ]);
  const validResult = validateConversationBrainPlan(valid);
  assert.equal(validResult.valid, true, validResult.error);
  assert.equal(valid.outboundActions[1].delayBeforeSendSeconds, 7);

  const source = fs.readFileSync(
    new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const stepDelay = previousAudioDuration \+ humanDelay/);
});

test("migration fecha debounce e duplicidade de profissão sem criar semântica no backend", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20260928100551_finalize_brain_architecture_alignment.sql", import.meta.url), "utf8");
  assert.match(sql, /ai_debounce_started_at/);
  assert.match(sql, /maxDebounceWindowMinutes/);
  assert.match(sql, /goal_job/);
  assert.match(sql, /persona_audios/);
  assert.doesNotMatch(sql, /UPDATE[\s\S]{0,100}brain_decisions[\s\S]{0,100}SET[\s\S]{0,100}payload/i);
});


test("bridge de áudio revalida pelo objective_id que autorizou o candidato, não pelo objetivo ativo", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
    "utf8",
  );
  const sdkSource = fs.readFileSync(
    new URL("../supabase/functions/api/openai_sdk_brain.ts", import.meta.url),
    "utf8",
  );
  const canonicalPrompt = fs.readFileSync(
    new URL("../supabase/functions/api/larissa_canonical_prompt.md", import.meta.url),
    "utf8",
  );
  const dispatchStart = source.indexOf("// Trava de autorização e resolução de áudio na sequência canônica");
  assert.ok(dispatchStart >= 0);
  const dispatchBlock = source.slice(dispatchStart, dispatchStart + 7000);
  assert.match(dispatchBlock, /authorizedAudioObjectiveId/);
  assert.match(dispatchBlock, /objectiveId:\s*authorizedAudioObjectiveId/);
  assert.doesNotMatch(dispatchBlock, /objectiveId:\s*stageChecklistForRouter\.currentObjective\?\.id/);
  assert.match(source, /brainAudioObjectiveById/);
  assert.match(sdkSource, /Objetivo completed significa somente não perguntar esse dado novamente ao pretendente; NÃO desabilita áudio/);
  assert.match(canonicalPrompt, /completed.*não perguntar novamente esse dado ao pretendente[\s\S]{0,180}NÃO significa "desabilitar os áudios/);
  assert.match(source, /executor_audio_id_not_authorized/);
});

test("Brain SDK aplica service_tier configurável sem fallback silencioso para Standard", () => {
  const orchestrator = fs.readFileSync(
    new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
    "utf8",
  );
  const sdkSource = fs.readFileSync(
    new URL("../supabase/functions/api/openai_sdk_brain.ts", import.meta.url),
    "utf8",
  );
  assert.match(orchestrator, /openai_brain_service_tier/);
  assert.match(orchestrator, /serviceTier:\s*configuredServiceTier/);
  assert.match(sdkSource, /providerData:\s*\{[\s\S]{0,100}service_tier:\s*serviceTier/);
  assert.match(sdkSource, /serviceTierActual/);
  assert.doesNotMatch(sdkSource, /service_tier:\s*["']default["']/);
});

test("decisão canônica é persistida antes do dispatcher e backend não ressuscita subagente", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
    "utf8",
  );
  const persistence = source.indexOf("const decisionPersisted = await persistCanonicalBrainDecision");
  const dispatcher = source.indexOf("const dispatchResult = await runDurableOutboxDispatcher", persistence);
  assert.ok(persistence >= 0 && dispatcher > persistence);
  assert.doesNotMatch(source, /responsibleSubagent|delegate_mission|CANONICAL_SUBAGENTS/);
});

test("inbox mantém a linha operacional da IA sem depender do hook legado removido", () => {
  const source = fs.readFileSync(
    new URL("../src/presentation/components/chat/InstagramDirect.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /useBrainInboxOverview/);
  assert.match(source, /const brainInboxOverview = useMemo/);
  assert.match(source, />IA<\/span>/);
  assert.match(source, /Objetivo/);
  assert.match(source, /actionTypes/);
});
