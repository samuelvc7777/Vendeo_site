import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAiAgentToolsForSession,
  extractWebSearchAudit,
  isWebSearchSessionConfigurationReady,
  runOpenAiBrainTurn,
  validateWebSearchOutputPrivacy,
} from "../supabase/functions/api/openai_brain.ts";

const AUDIO_ID = "audio_approved_profession";
const OBJECTIVE_ID = "goal_profession";

function plan(text = "Não consegui confirmar isso com segurança agora.", includeAudio = false) {
  return {
    action: "reply",
    objectiveDecision: "pursue",
    reasoning: "O Brain decide a resposta a partir do contexto e das evidências disponíveis.",
    responses: [text],
    outboundActions: [
      { type: "text", text, delay_before_send: 2 },
      ...(includeAudio ? [{ type: "audio", audioId: AUDIO_ID, delay_before_send: 2 }] : []),
    ],
    turnContract: {
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "react_and_answer",
      directQuestions: [],
    },
  };
}

async function runRuntimeTurn({ persistent = false, message = "oii, tudo bem?", webSearchItems = [], recoveredAudioToolState } = {}) {
  let captured;
  const result = await runOpenAiBrainTurn({
    conversationId: "conversation-public-search-test",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: OBJECTIVE_ID,
    currentObjectiveLabel: "Responder ao contexto",
    inboundMessages: [message],
    recentMessages: [{ sender: "user", text: message }],
    persistentSessionEnabled: persistent,
    recoveredAudioToolState,
    apiKey: "test-key",
    agentId: "agent-test",
    runtime: {
      async callOpenAiAgent(input) {
        captured = input;
        return {
          success: true,
          plan: plan(),
          webSearchItems,
          sessionId: "session-test",
          turnId: "turn-test",
          turnStatus: "completed",
          status: "completed",
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      },
    },
  });
  return { result, captured };
}

test("os dois modos habilitam web_search live e preservam suas ferramentas existentes", () => {
  const memoryTools = [
    { type: "function", name: "persona_memory_search", parameters: { type: "object", properties: {} } },
    { type: "function", name: "contact_memory_search", parameters: { type: "object", properties: {} } },
    { type: "function", name: "conversation_memory_search", parameters: { type: "object", properties: {} } },
    { type: "mcp", server_label: "vendeo_memory", transport: { type: "http", headers: { existing: "kept" } } },
    { type: "function", name: "cofre_audio_search", parameters: { type: "object", properties: {} } },
  ];

  const nonPersistent = buildOpenAiAgentToolsForSession({
    persistentMode: false,
    agentTools: memoryTools,
    memoryScopeId: "scope-123",
  });
  assert.deepEqual(nonPersistent.map((tool) => tool.name || tool.server_label || tool.type), memoryTools.map((tool) => tool.name || tool.server_label).concat("web_search"));
  assert.equal(nonPersistent.find((tool) => tool.server_label === "vendeo_memory").transport.headers.existing, "kept");
  assert.equal(nonPersistent.find((tool) => tool.server_label === "vendeo_memory").transport.headers["x-vendeo-memory-scope"], "scope-123");
  assert.deepEqual(nonPersistent.find((tool) => tool.type === "web_search"), { type: "web_search", mode: "live", context_size: "low" });

  const persistent = buildOpenAiAgentToolsForSession({
    persistentMode: true,
    agentTools: [{ type: "function", name: "cofre_audio_search", parameters: { type: "object", properties: {} } }],
  });
  assert.deepEqual(persistent.map((tool) => tool.name || tool.type), ["cofre_audio_search", "web_search"]);
  assert.equal(persistent.at(-1).mode, "live");
});

test("ferramenta web_search repetida é normalizada para uma única chamada live", () => {
  const tools = buildOpenAiAgentToolsForSession({
    persistentMode: false,
    agentTools: [
      { type: "web_search", mode: "cached", allowed_domains: ["example.com"] },
      { type: "web_search", mode: "disabled" },
    ],
  });
  const webTools = tools.filter((tool) => tool.type === "web_search");
  assert.equal(webTools.length, 1);
  assert.equal(webTools[0].mode, "live");
  assert.deepEqual(webTools[0].allowed_domains, ["example.com"]);
});

test("configuração de sessão antiga precisa ser recriada para receber ferramenta e política", () => {
  assert.equal(isWebSearchSessionConfigurationReady({ tools: [{ type: "web_search", mode: "live" }], instructions: "brain_web_search_policy_v1" }), true);
  assert.equal(isWebSearchSessionConfigurationReady({ tools: [{ type: "web_search", mode: "cached" }], instructions: "brain_web_search_policy_v1" }), false);
  assert.equal(isWebSearchSessionConfigurationReady({ tools: [{ type: "web_search", mode: "live" }], instructions: "instruções antigas" }), false);
});

test("entidade pública desconhecida relevante deve ser identificada por busca live, com ambiguidade contextual", async () => {
  const { result, captured } = await runRuntimeTurn({
    message: "vc torce pro Athletic?",
  });
  assert.equal(result.success, true, result.error);
  assert.ok(captured.tools.some((tool) => tool.type === "web_search" && tool.mode === "live"));
  assert.match(captured.context, /entidade pública desconhecida/i);
  assert.match(captured.context, /use web_search em modo live para identificá-la/i);
  assert.match(captured.context, /fatos pessoais não são alvo de busca/i);
  assert.match(captured.context, /nomes ambíguos.*desambigue pelo contexto/i);
  assert.match(captured.context, /no máximo uma chamada de web_search por turno/i);
});

test("consulta casual não registra busca e a política de privacidade/injeção chega ao Brain", async () => {
  const { result, captured } = await runRuntimeTurn({ message: "oii, tudo bem?" });
  assert.equal(result.success, true, result.error);
  assert.ok(captured.tools.some((tool) => tool.type === "web_search" && tool.mode === "live"));
  assert.ok(captured.tools.some((tool) => tool.name === "cofre_audio_search"));
  assert.match(captured.context, /não pesquise saudações|não pesquise.*conversa casual/i);
  assert.match(captured.context, /nunca inclua nome|identificadores/i);
  assert.match(captured.context, /conteúdo não confiável/i);
  assert.equal(result.telemetry.webSearchStatus, "not_used");
  assert.equal(result.telemetry.webSearchCallCount, 0);
});

test("pergunta atual pode gerar busca e as fontes reais entram na telemetria sem a consulta bruta", async () => {
  const queryWithPrivateData = "cotação atual do café + Samuel Vitor + @samuel_private";
  const webSearchItems = [{
    id: "web-search-1",
    type: "web_search_call",
    status: "completed",
    action: { type: "search", queries: [queryWithPrivateData] },
    sources: [
      { url: "https://dados.example.com/cafe?utm_source=brain&person=Samuel", title: "Indicador público do café" },
      { url: "https://dados.example.com/cafe?duplicate=1", title: "Indicador público do café" },
    ],
  }];
  const { result, captured } = await runRuntimeTurn({
    persistent: false,
    message: "qual é a cotação do café hoje?",
    webSearchItems,
  });
  assert.equal(result.success, true, result.error);
  assert.ok(captured.tools.some((tool) => tool.type === "web_search"));
  assert.equal(result.telemetry.webSearchStatus, "sources_found");
  assert.equal(result.telemetry.webSearchCallCount, 1);
  assert.deepEqual(result.telemetry.webSearchSources, ["https://dados.example.com/cafe"]);
  assert.doesNotMatch(JSON.stringify(result.telemetry), /Samuel Vitor|samuel_private|cotação atual/);
});

test("web_search vira conhecimento interno e nunca pode vazar citação ou URL na fala", async () => {
  const natural = plan("fica pertinho daqui kkk, eu conheço sim");
  assert.equal(validateWebSearchOutputPrivacy(natural, true).valid, true);

  const markdownLeak = plan("fica pertinho daqui ([gov.br](https://www.gov.br/exemplo?utm_source=openai))");
  const markdownResult = validateWebSearchOutputPrivacy(markdownLeak, true);
  assert.equal(markdownResult.valid, false);
  assert.match(markdownResult.error || "", /web_search_output_leak/);
  assert.equal(validateWebSearchOutputPrivacy(plan("[site](https://example.com)"), false).valid, true);

  const rawUrl = plan("olha https://example.com/info");
  assert.equal(validateWebSearchOutputPrivacy(rawUrl, true).valid, false);
  assert.equal(validateWebSearchOutputPrivacy(rawUrl, false).valid, true);

  const { result, captured } = await runRuntimeTurn({ message: "vc sabe onde fica essa cidade?" });
  assert.equal(result.success, true, result.error);
  assert.match(captured.context, /grounding INTERNO/i);
  assert.match(captured.context, /NUNCA exponha em outboundActions URL/i);
  assert.match(captured.context, /o pretendente não deve perceber que houve busca/i);
});

test("busca falha ou sem fontes não trava o Brain nem cria fontes", async () => {
  const failed = await runRuntimeTurn({
    persistent: true,
    message: "qual é a informação pública atual?",
    webSearchItems: [{ id: "web-failed", type: "web_search_call", status: "failed", error: { message: "provider unavailable" }, action: { type: "search", queries: ["query privada"] } }],
  });
  assert.equal(failed.result.success, true, failed.result.error);
  assert.equal(failed.result.telemetry.webSearchStatus, "failed");
  assert.deepEqual(failed.result.telemetry.webSearchSources, []);

  const empty = await runRuntimeTurn({
    persistent: true,
    message: "qual é a informação pública atual?",
    webSearchItems: [{ id: "web-empty", type: "web_search_call", status: "completed", action: { type: "search", queries: ["query privada"], sources: [] } }],
  });
  assert.equal(empty.result.success, true, empty.result.error);
  assert.equal(empty.result.telemetry.webSearchStatus, "no_sources");
  assert.deepEqual(empty.result.telemetry.webSearchSources, []);
});

test("busca repetida é contabilizada sem persistir consultas e recovery do áudio permanece disponível", async () => {
  const { result, captured } = await runRuntimeTurn({
    persistent: true,
    message: "o que há de atual sobre o assunto?",
    webSearchItems: [
      { id: "web-1", type: "web_search_call", status: "completed", sources: [{ url: "https://news.example.com/story" }] },
      { id: "web-2", type: "web_search_call", status: "completed", sources: [{ url: "https://news.example.com/story" }] },
    ],
    recoveredAudioToolState: {
      objectiveId: OBJECTIVE_ID,
      recoveredAt: "2026-09-27T12:00:00.000Z",
      candidates: [{ audioId: AUDIO_ID, title: "Profissão", transcript: "Trabalho com saúde", whenToUse: "Pergunta sobre profissão" }],
    },
  });
  assert.equal(result.success, true, result.error);
  assert.ok(captured.tools.some((tool) => tool.type === "web_search" && tool.mode === "live"));
  assert.ok(captured.tools.some((tool) => tool.name === "cofre_audio_search"));
  assert.equal(result.telemetry.audioToolStateRecovered, true);
  assert.equal(result.telemetry.authorizedCandidateAudios[0].audioId, AUDIO_ID);
  assert.equal(result.telemetry.webSearchCallCount, 2);
  assert.equal(result.telemetry.webSearchDuplicateCallCount, 1);
  assert.deepEqual(result.telemetry.webSearchSources, ["https://news.example.com/story"]);
});
