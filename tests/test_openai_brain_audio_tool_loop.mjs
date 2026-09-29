import assert from "node:assert/strict";
import test from "node:test";
import { buildAppToolExecutionKey, runOpenAiBrainTurn } from "../supabase/functions/api/openai_brain.ts";
import {
  loadAndRevalidateRecoverableAudioToolState,
  loadRecoverableAudioToolState,
  persistRecoverableAudioToolState,
  readRecoverableAudioToolState,
} from "../supabase/functions/api/brain_audio_tool_recovery.ts";

const CONVERSATION_ID = "1409257273902588";
const OBJECTIVE_ID = "goal_1790089821922_2wamf";
const AUDIO_ID = "audio_1790186508570_ctlg1";
const INBOUND = "Sou entregador de ifood e motorista de caminhão e vc ?";

function createMarcosAgentProvider({
  actionSequence = [{ callId: "call-audio-profession", objectiveId: OBJECTIVE_ID }],
  finalAudioId = AUDIO_ID,
  includeAudio = true,
  initiallyComplete = false,
  finalizeDelaySessionReads = 0,
} = {}) {
  let shouldFinalize = initiallyComplete;
  let finalizeDelayRemaining = finalizeDelaySessionReads;
  let actionIndex = 0;
  const submittedToolResults = [];
  let createdSessionInput = "";
  const finalPlan = () => ({
    action: "reply",
    objectiveDecision: "pursue",
    reasoning: "A pergunta sobre profissão pode ser respondida pelo áudio autorizado.",
    responses: ["nossaa, vc não para mesmo kkk"],
    outboundActions: [
      { type: "text", text: "nossaa, vc não para mesmo kkk" },
      ...(includeAudio ? [{ type: "audio", audioId: finalAudioId }] : []),
    ],
    turnContract: {
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "react_and_answer",
      directQuestions: [],
      maxBalloons: 2,
    },
  });

  return {
    submittedToolResults,
    get createdSessionInput() { return createdSessionInput; },
    fetch: async (input, init = {}) => {
      const url = String(input);
      const method = init.method || "GET";
      if (url.endsWith("/agents/sessions") && method === "POST") {
        const payload = JSON.parse(String(init.body));
        createdSessionInput = payload.input?.[0]?.content?.[0]?.text || "";
        return Response.json({
          id: "session-marcos",
          status: shouldFinalize ? "completed" : "in_progress",
          current_turn: { id: "turn-marcos", status: shouldFinalize ? "completed" : "in_progress" },
        });
      }
      if (url.endsWith("/agents/sessions/session-marcos/turns/turn-marcos")) {
        return Response.json({
          id: "turn-marcos",
          session_id: "session-marcos",
          status: shouldFinalize && finalizeDelayRemaining <= 0 ? "completed" : "in_progress",
        });
      }
      if (url.endsWith("/agents/sessions/session-marcos") && method === "GET") {
        if (shouldFinalize && finalizeDelayRemaining <= 0) {
          return Response.json({ id: "session-marcos", status: "completed" });
        }
        if (shouldFinalize) finalizeDelayRemaining--;
        return Response.json({
              id: "session-marcos",
              status: "requires_action",
              required_actions: [{
                type: "function_call",
                call_id: actionSequence[Math.min(actionIndex, actionSequence.length - 1)].callId,
                turn_id: "turn-marcos",
                name: "cofre_audio_search",
                arguments: JSON.stringify({ objective_id: actionSequence[Math.min(actionIndex, actionSequence.length - 1)].objectiveId }),
              }],
            });
      }
      if (url.endsWith("/agents/sessions/session-marcos/events") && method === "POST") {
        const body = JSON.parse(String(init.body));
        const event = body.events?.[0];
        submittedToolResults.push(event);
        const output = JSON.parse(event.output);
        if (actionIndex < actionSequence.length - 1) {
          actionIndex++;
          shouldFinalize = false;
        } else {
          shouldFinalize = output.finalize_decision_after_tool === true || output.tool_already_resolved === true;
          if (shouldFinalize) finalizeDelayRemaining = finalizeDelaySessionReads;
        }
        return Response.json({ accepted: true }, { status: 202 });
      }
      if (url.endsWith("/agents/sessions/session-marcos/items")) {
        return Response.json({ data: [{
          id: "message-final-marcos",
          turn_id: "turn-marcos",
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: JSON.stringify(finalPlan()) }],
        }] });
      }
      if (url.includes("/traces") || url.includes("/turns?")) return Response.json({ data: [] });
      throw new Error(`Chamada OpenAI inesperada no fixture Marcos: ${method} ${url}`);
    },
  };
}

function createEmptySupabase() {
  return {
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() { return { data: null, error: null }; },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
}

async function executeMarcosTurn({
  provider = createMarcosAgentProvider(),
  recoveredAudioToolState,
  searchCofreAudios,
  currentObjectiveId = OBJECTIVE_ID,
  currentObjectiveLabel = "Descobrir profissão",
} = {}) {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let audioSearchCount = 0;
  globalThis.fetch = provider.fetch;
  globalThis.setTimeout = (callback) => {
    queueMicrotask(callback);
    return 0;
  };

  try {
    const result = await runOpenAiBrainTurn({
      supabase: createEmptySupabase(),
      conversationId: CONVERSATION_ID,
      currentStageId: "stage_1_conexao",
      currentObjectiveId,
      currentObjectiveLabel,
      inboundMessages: [INBOUND],
      recentMessages: [{ sender: "user", text: INBOUND }],
      persistentSessionEnabled: true,
      apiKey: "test-openai-key",
      agentId: "agent-test-marcos",
      recoveredAudioToolState,
      searchCofreAudios: async ({ conversationId, objective_id }) => {
        audioSearchCount++;
        assert.equal(conversationId, CONVERSATION_ID);
        const candidateId = objective_id === "goal_other" ? "audio_other" : AUDIO_ID;
        return searchCofreAudios
          ? searchCofreAudios({ objective_id, candidateId })
          : [{
              audio_id: candidateId,
              title: objective_id === "goal_other" ? "Outro áudio autorizado" : "Áudio sobre oque faço da vida",
              transcript: "Faço Enfermagem, tenho estágio no hospital e trabalho com vendas online.",
              when_to_use: "Usar quando perguntar sobre minha profissão.",
            }];
      },
    });
    return { result, audioSearchCount };
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}

test("Marcos: um resultado do Cofre leva à decisão final sem repetir a busca", async () => {
  const provider = createMarcosAgentProvider({ finalizeDelaySessionReads: 6 });
  const { result, audioSearchCount } = await executeMarcosTurn({ provider });
  assert.equal(result.success, true, result.error);
  assert.equal(audioSearchCount, 1);
  assert.equal(provider.submittedToolResults.length, 1);
  assert.equal(result.telemetry.authorizedCandidateAudios?.[0]?.audioId, AUDIO_ID);
  assert.ok(result.plan.outboundActions.some((action) => action.type === "audio" && action.audioId === AUDIO_ID));
  assert.equal(result.telemetry.audioToolDecisionFinalized, true);
  assert.equal(result.telemetry.audioSelected, true);
  assert.ok((result.telemetry.audioToolDuplicateRequestBlockedCount || 0) >= 4);
  assert.equal(/Enfermagem|estágio no hospital|vendas online/i.test(result.plan.outboundActions[0].text), false);
});

test("objetivo temático concluído continua elegível para o Cofre mesmo com outro objetivo ativo", async () => {
  const provider = createMarcosAgentProvider();
  const { result, audioSearchCount } = await executeMarcosTurn({
    provider,
    currentObjectiveId: "goal_age",
    currentObjectiveLabel: "Descobrir idade",
  });

  assert.equal(result.success, true, result.error);
  assert.equal(audioSearchCount, 1, "o backend não deve bloquear a consulta de profissão só porque idade está ativa");
  assert.equal(result.telemetry.authorizedCandidateAudios?.[0]?.audioId, AUDIO_ID);
  assert.equal(result.telemetry.authorizedCandidateAudios?.[0]?.objectiveId, OBJECTIVE_ID);
  assert.ok(result.plan.outboundActions.some((action) => action.type === "audio" && action.audioId === AUDIO_ID));
});

test("B: mesma ferramenta e argumentos com outro call_id reutilizam o resultado autorizado", async () => {
  const provider = createMarcosAgentProvider({
    actionSequence: [
      { callId: "call-audio-first", objectiveId: OBJECTIVE_ID },
      { callId: "call-audio-repeat", objectiveId: OBJECTIVE_ID },
    ],
  });
  const { result, audioSearchCount } = await executeMarcosTurn({ provider });
  assert.equal(result.success, true, result.error);
  assert.equal(audioSearchCount, 1);
  assert.equal(provider.submittedToolResults.length, 2);
  const reusedResult = JSON.parse(provider.submittedToolResults[1].output);
  assert.equal(reusedResult.tool_already_resolved, true);
  assert.equal(reusedResult.reuse_previous_result, true);
  assert.equal(reusedResult.candidates[0].audioId, AUDIO_ID);
  assert.equal(result.telemetry.audioToolResultReusedCount, 1);
  assert.equal(result.telemetry.status, "completed");
  assert.doesNotMatch(result.error || "", /max_rounds_exceeded/);
});

test("N: objective_id diferente produz uma chamada semântica distinta permitida", async () => {
  const provider = createMarcosAgentProvider({
    actionSequence: [
      { callId: "call-audio-profession", objectiveId: OBJECTIVE_ID },
      { callId: "call-audio-other-objective", objectiveId: "goal_other" },
    ],
    finalAudioId: "audio_other",
  });
  const { result, audioSearchCount } = await executeMarcosTurn({ provider });
  assert.equal(result.success, true, result.error);
  assert.equal(audioSearchCount, 2);
  assert.equal(provider.submittedToolResults.length, 2);
  assert.deepEqual(result.telemetry.authorizedCandidateAudios?.map((candidate) => candidate.audioId), [AUDIO_ID, "audio_other"]);
  assert.deepEqual(result.telemetry.authorizedCandidateAudiosByObjective?.map((group) => group.objectiveId), [OBJECTIVE_ID, "goal_other"]);
  assert.ok(result.plan.outboundActions.some((action) => action.type === "audio" && action.audioId === "audio_other"));
});

test("a identidade inclui conversa, turno, nome e argumentos estáveis", () => {
  const base = {
    sessionId: "session-1",
    turnId: "turn-1",
    conversationId: CONVERSATION_ID,
    toolName: "cofre_audio_search",
    toolArgs: { objective_id: OBJECTIVE_ID, query: "profissão" },
  };
  assert.equal(
    buildAppToolExecutionKey(base),
    buildAppToolExecutionKey({ ...base, toolArgs: { query: "profissão", objective_id: OBJECTIVE_ID } }),
  );
  assert.notEqual(buildAppToolExecutionKey(base), buildAppToolExecutionKey({ ...base, toolArgs: { objective_id: "goal_other", query: "profissão" } }));
  assert.notEqual(buildAppToolExecutionKey(base), buildAppToolExecutionKey({ ...base, conversationId: "another-conversation" }));
  assert.notEqual(buildAppToolExecutionKey(base), buildAppToolExecutionKey({ ...base, turnId: "turn-2" }));
});

test("recovery persiste candidatos por conversa, limita por objetivo/TTL e preserva o contexto existente", async () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  let sessionRow = {
    id: "bs_session-marcos",
    conversation_id: CONVERSATION_ID,
    provider: "openai",
    provider_session_id: "session-marcos",
    status: "active",
    bootstrap_context: { unrelatedContext: "preserve-me" },
  };
  const supabase = {
    from(table) {
      assert.equal(table, "brain_sessions");
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          const matches = Object.entries(filters).every(([key, value]) => sessionRow[key] === value);
          return { data: matches ? sessionRow : null, error: null };
        },
        async upsert(value) { sessionRow = value; return { error: null }; },
      };
      return {
        select: (...args) => query.select(...args),
        eq: (...args) => query.eq(...args),
        order: (...args) => query.order(...args),
        limit: (...args) => query.limit(...args),
        maybeSingle: (...args) => query.maybeSingle(...args),
        upsert: (...args) => query.upsert(...args),
      };
    },
  };
  const candidates = [{
    audioId: AUDIO_ID,
    title: "Áudio sobre oque faço da vida",
    transcript: "Faço Enfermagem, tenho estágio no hospital e trabalho com vendas online.",
    whenToUse: "Pergunta sobre profissão.",
  }];

  await persistRecoverableAudioToolState({
    supabase,
    conversationId: CONVERSATION_ID,
    sessionId: "session-marcos",
    objectiveId: OBJECTIVE_ID,
    candidates,
    sourceTurnId: "turn-marcos",
    sourceCycleId: "cycle-marcos",
    now,
  });
  assert.equal(sessionRow.bootstrap_context.unrelatedContext, "preserve-me");
  const recovered = await loadRecoverableAudioToolState({ supabase, conversationId: CONVERSATION_ID, objectiveId: OBJECTIVE_ID, nowMs: now.getTime() });
  assert.equal(recovered.candidates[0].audioId, AUDIO_ID);
  assert.equal(recovered.sourceTurnId, "turn-marcos");
  let eligibilityCheckCount = 0;
  const revalidated = await loadAndRevalidateRecoverableAudioToolState({
    supabase,
    conversationId: CONVERSATION_ID,
    objectiveId: OBJECTIVE_ID,
    nowMs: now.getTime(),
    searchCofreAudios: async () => {
      eligibilityCheckCount++;
      return [
        { audio_id: AUDIO_ID, title: "Áudio revalidado", full_transcript: "Transcrição atual", when_to_use: "Uso atual" },
        { audio_id: "audio_new_not_previously_authorized", title: "Novo áudio", full_transcript: "Não deve ser injetado", when_to_use: "Outro" },
      ];
    },
  });
  assert.equal(eligibilityCheckCount, 1);
  assert.deepEqual(revalidated.candidates.map((candidate) => candidate.audioId), [AUDIO_ID]);
  assert.equal(revalidated.candidates[0].transcript, "Transcrição atual");
  assert.equal(await loadRecoverableAudioToolState({ supabase, conversationId: CONVERSATION_ID, objectiveId: "goal_other", nowMs: now.getTime() }), null);
  assert.equal(readRecoverableAudioToolState(sessionRow.bootstrap_context.audioToolRecovery, OBJECTIVE_ID, now.getTime() + 16 * 60 * 1000), null);
});

test("F: contexto recuperado autoriza candidato e permite ao Brain rejeitar o áudio", async () => {
  const recoveredAudioToolState = {
    objectiveId: OBJECTIVE_ID,
    recoveredAt: "2026-09-27T11:59:00.000Z",
    sourceTurnId: "turn-prior-marcos",
    candidates: [{
      audioId: AUDIO_ID,
      title: "Áudio sobre oque faço da vida",
      transcript: "Faço Enfermagem, tenho estágio no hospital e trabalho com vendas online.",
      whenToUse: "Pergunta sobre profissão.",
    }],
  };
  const provider = createMarcosAgentProvider({ initiallyComplete: true, includeAudio: false });
  const { result, audioSearchCount } = await executeMarcosTurn({ provider, recoveredAudioToolState });
  assert.equal(result.success, true, result.error);
  assert.equal(audioSearchCount, 0);
  assert.match(provider.createdSessionInput, /RESULTADO AUTORIZADO RECUPERADO DO COFRE/);
  assert.match(provider.createdSessionInput, new RegExp(AUDIO_ID));
  assert.equal(result.telemetry.audioToolStateRecovered, true);
  assert.equal(result.telemetry.authorizedCandidateAudios?.[0]?.audioId, AUDIO_ID);
  assert.equal(result.telemetry.audioSelected, false);
  assert.equal(result.plan.outboundActions.some((action) => action.type === "audio"), false);
});
