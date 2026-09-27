import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationBrainPrompt,
  resolveStageChecklistGoals,
  validateAndApplyBrainStageDecision,
  selectConfirmedBrainActions,
} from "../supabase/functions/api/brain_orchestrator.ts";
import { buildOpenAiBrainContextMessage } from "../supabase/functions/api/openai_brain.ts";
import { EPISODE_EVENT_TYPES, saveConversationEpisodes } from "../supabase/functions/api/conversation_episodic_memory.ts";
import { handleOperatorChatProgress } from "../supabase/functions/api/operator_chat_progress.ts";

const stages = [
  { id: "stage_1_conexao", name: "Conexão Inicial", stage_order: 0, goals: [
    { id: "goal_city", title: "Cidade", enabled: true, order: 1 },
    { id: "goal_job", title: "Trabalho", enabled: true, order: 2 },
  ] },
  { id: "stage_2_descoberta", name: "Descoberta", stage_order: 1, goals: [
    { id: "goal_age", title: "Idade", enabled: true, order: 1 },
  ] },
];

function stageCatalogClient(catalog = stages) {
  return { from(table) {
    assert.equal(table, "chat_stages");
    return { select: () => ({ order: async () => ({ data: catalog, error: null }) }) };
  } };
}

test("o Brain recebe objetivos pendentes e concluídos com valor e evidência", async () => {
  const resolved = await resolveStageChecklistGoals({
    supabase: stageCatalogClient(), conversationId: "conv-1", stageNameOrId: "stage_1_conexao",
    memoryProvider: {}, completedGoalIds: ["goal_city"],
    objectiveProgress: { goal_city: { status: "completed", value: "Barbacena", evidenceMessageId: "msg-city" } },
  });
  assert.equal(resolved.currentObjective.id, "goal_job");
  const prompt = buildConversationBrainPrompt({
    conversationId: "conv-1", currentStage: `${resolved.stage} [${resolved.stageId}]`, liveState: {},
    recentMessages: [], contactMemorySummary: "", landmarksSummary: "", speechActsSummary: "", personaMemorySummary: "",
    stageObjectives: resolved.goals, currentObjective: resolved.currentObjective,
  });
  assert.match(prompt, /goal_city[^\n]*status: completed[^\n]*Barbacena[^\n]*msg-city/);
  assert.match(prompt, /CONCLUÍDO — NÃO PERGUNTAR NOVAMENTE/);
  assert.match(prompt, /goal_job[^\n]*status: pending/);

  const agentContext = buildOpenAiBrainContextMessage({
    supabase: {}, conversationId: "conv-1", currentStageId: resolved.stageId,
    currentObjectiveId: resolved.currentObjective.id, currentObjectiveLabel: resolved.currentObjective.label,
    inboundMessages: [], recentMessages: [], stageObjectives: resolved.goals,
  });
  assert.match(agentContext, /goal_city \| CONCLUÍDO — NÃO PERGUNTAR NOVAMENTE \| valor: "Barbacena" \| evidenceMessageId: msg-city/);
  assert.match(agentContext, /goal_job \| PENDENTE — NÃO É OBRIGATÓRIO/);
});

test("conclusão exige objetivo habilitado e evidência existente; próxima etapa só avança se o Brain pedir", async () => {
  let queriedEvidence = false;
  const supabase = {
    from(table) {
      if (table === "chat_stages") return { select: () => ({ order: async () => ({ data: stages, error: null }) }) };
      if (table === "instagram_messages") return { select: () => ({
        eq() { return this; },
        maybeSingle: async () => { queriedEvidence = true; return { data: { id: "msg-city" }, error: null }; },
      }) };
      throw new Error(`Tabela inesperada: ${table}`);
    },
  };
  const result = await validateAndApplyBrainStageDecision({
    supabase, conversationId: "conv-1", currentPhase: "stage_1_conexao", currentStageId: "stage_1_conexao",
    decision: { objectiveCompletion: {
      objectiveId: "goal_city", value: "Barbacena", evidenceMessageId: "msg-city",
      evidence: { type: "message", id: "msg-city" },
    }, nextPhase: "stage_2_descoberta" },
  });
  assert.equal(queriedEvidence, true);
  assert.equal(result.updatedCompletedGoals.includes("goal_city"), true);
  assert.equal(result.updatedObjectiveProgress.goal_city.status, "completed");
  assert.equal(result.updatedObjectiveProgress.goal_city.value, "Barbacena");
  assert.equal(result.updatedObjectiveProgress.goal_city.evidenceMessageId, "msg-city");
  assert.equal(result.nextStageId, "stage_2_descoberta");

  const noBrainAdvance = await validateAndApplyBrainStageDecision({
    supabase, conversationId: "conv-1", currentPhase: "stage_1_conexao", currentStageId: "stage_1_conexao",
    decision: { nextPhase: "stage_1_conexao" },
  });
  assert.equal(noBrainAdvance.stageAdvanced, false);
});

test("etapa inexistente e evidência inválida não concluem objetivo nem avançam", async () => {
  const supabase = {
    from(table) {
      if (table === "chat_stages") return { select: () => ({ order: async () => ({ data: stages, error: null }) }) };
      if (table === "instagram_messages") return { select: () => ({ eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }) };
      throw new Error(`Tabela inesperada: ${table}`);
    },
  };
  const result = await validateAndApplyBrainStageDecision({
    supabase, conversationId: "conv-1", currentPhase: "stage_1_conexao", currentStageId: "stage_1_conexao",
    decision: { objectiveCompletion: {
      objectiveId: "goal_city", value: "Barbacena", evidenceMessageId: "inventada",
      evidence: { type: "message", id: "inventada" },
    }, nextPhase: "stage_404" },
  });
  assert.deepEqual(result.updatedCompletedGoals, []);
  assert.equal(result.updatedObjectiveProgress.goal_city, undefined);
  assert.equal(result.currentStageId, "stage_1_conexao");
  assert.equal(result.stageAdvanced, false);
});

test("catálogo episódico bloqueia regressão e grava pergunta com tipo canônico", async () => {
  assert.deepEqual(EPISODE_EVENT_TYPES, ["question", "answer", "statement", "self_disclosure", "fact_reveal", "topic", "audio_sent", "reaction", "plan", "preference_reveal"]);
  let saved;
  const supabase = { from: () => ({ upsert: (payload) => {
    saved = payload;
    return { select: async () => ({ data: [{ id: "ep-1" }], error: null }) };
  } }) };
  await saveConversationEpisodes({
    supabase, conversationId: "conv-1", episodes: [{
      conversation_id: "conv-1", actor: "larissa", event_type: "question", summary: "Perguntou a cidade.", source_message_id: "out-1",
    }],
  });
  assert.equal(saved[0].event_type, "question");
  await assert.rejects(() => saveConversationEpisodes({
    supabase, conversationId: "conv-1", episodes: [{
      conversation_id: "conv-1", actor: "larissa", event_type: "question_asked", summary: "inválido",
    }],
  }), /Tipo de evento episódico inválido/);
});

test("ação sem confirmação não é projetada para memória", () => {
  assert.deepEqual(selectConfirmedBrainActions([
    { id: "a1", action_type: "text", status: "pending", payload: { text: "Onde você mora?" } },
  ]), []);
});

test("endpoint de progresso exige sessão e chama a RPC privilegiada após validar", async () => {
  let rpcCalled = false;
  const supabase = {
    from(table) {
      if (table === "chat_stages") return { select: async () => ({ data: stages, error: null }) };
      if (table === "instagram_conversations") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { stage_completed_rules: {} }, error: null }) }) }) };
      throw new Error(`Tabela inesperada: ${table}`);
    },
    rpc: async (name, args) => { rpcCalled = true; assert.equal(name, "patch_chat_progress_atomic"); return { data: { success: true, patch: args.p_progress_patch }, error: null }; },
  };
  const request = () => new Request("https://edge.test/operator/chat-progress", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: "conv-1", progressPatch: {
      currentStageId: "stage_1_conexao", completedGoalIds: ["goal_city", "goal_city"], completedItemIds: [], objectiveProgress: {},
    } }),
  });
  const unauthorized = await handleOperatorChatProgress(request(), supabase, false, {});
  assert.equal(unauthorized.status, 401);
  assert.equal(rpcCalled, false);
  const authorized = await handleOperatorChatProgress(request(), supabase, true, {});
  assert.equal(authorized.status, 200);
  assert.equal(rpcCalled, true);
  assert.deepEqual((await authorized.json()).patch.completedGoalIds, ["goal_city"]);
});
