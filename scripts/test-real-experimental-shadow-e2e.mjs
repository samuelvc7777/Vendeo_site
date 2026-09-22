#!/usr/bin/env node
/**
 * Harness E2E remoto e seguro do Conversation Brain em shadow.
 *
 * Executar:
 *   node --experimental-strip-types scripts/test-real-experimental-shadow-e2e.mjs
 *   node --experimental-strip-types scripts/test-real-experimental-shadow-e2e.mjs --all
 *
 * Não passa por webhook, não cria endpoint produtivo e não possui bypass de
 * segurança. A barreira local de fetch falha fechada para Meta e Chat
 * Completions; somente a Agents API oficial pode atravessá-la.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const FIXTURE_ID = "__shadow_e2e_brain_test__";
const fixtureMessagePrefix = "__shadow_e2e_msg__";
const runAll = process.argv.includes("--all");
const scenarios = [
  { id: "nurse", label: "Sou enfermeiro", text: "Sou enfermeiro.", requiresPersonaMemory: true },
  { id: "greeting", label: "Saudação", text: "Oii, tudo bem?", requiresPersonaMemory: false },
  { id: "motocross", label: "Motocross", text: "Eu gosto muito de motocross.", requiresPersonaMemory: false },
  { id: "nurse_motocross", label: "Enfermeiro e motocross", text: "Sou enfermeiro e curto motocross.", requiresPersonaMemory: true },
  { id: "vent", label: "Desabafo", text: "Meu dia foi péssimo, meu chefe me estressou demais.", requiresPersonaMemory: false, expectedObjective: "defer" },
  { id: "city", label: "Cidade espontânea", text: "Sou de Barbacena.", requiresPersonaMemory: false },
  { id: "subagent", label: "Escolha de subagente", text: "Eu adoro conversar sobre viagens e lugares diferentes.", requiresPersonaMemory: false },
  { id: "question", label: "Pergunta natural", text: "Hoje foi corrido, mas consegui terminar tudo no trabalho.", requiresPersonaMemory: false },
];

function loadDotEnv() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error(".env.local não encontrado; o harness não pode obter credenciais.");
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente; nenhum ciclo será iniciado.`);
  return value;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16)}`;
}

function sanitizeFact(fact) {
  if (!fact || typeof fact !== "object") return fact;
  return {
    fact: typeof fact.fact === "string" ? fact.fact.slice(0, 240) : undefined,
    memoryId: fact.memoryId || fact.id || undefined,
    origin: fact.origin || undefined,
    reason: typeof fact.reason === "string" ? fact.reason.slice(0, 240) : undefined,
  };
}

function extractToolEvidence(items) {
  const tools = [];
  for (const item of Array.isArray(items) ? items : []) {
    const name = item?.name || item?.tool_name || item?.tool?.name;
    if (!name || !String(name).includes("persona_memory_search")) continue;
    const args = item.arguments || item.input || item.parameters || {};
    const output = item.output || item.result || item.response || {};
    const parsedOutput = typeof output === "string" ? (() => { try { return JSON.parse(output); } catch { return {}; } })() : output;
    const results = Array.isArray(parsedOutput?.results) ? parsedOutput.results : [];
    tools.push({
      name: "persona_memory_search",
      query: typeof args?.query === "string" ? args.query.slice(0, 200) : undefined,
      resultCount: results.length,
      factProvenance: results.slice(0, 8).map((result) => ({
        memoryId: result.id || result.memory_id || result.key,
        origin: result.origin || result.source_type || "persona_memory",
      })),
    });
  }
  return tools;
}

function planFromAgentItems(items) {
  const final = [...(Array.isArray(items) ? items : [])].reverse().find(
    (item) => item?.type === "message" && item?.role === "assistant" && (item?.phase === "final_answer" || !item?.phase),
  );
  const text = final?.content?.[0]?.text || "";
  try { return JSON.parse(text); } catch { return null; }
}

function makeStageRules(scenario) {
  const objective = scenario.id === "city"
    ? { id: "goal_city", label: "Cidade", description: "Descobrir a cidade do pretendente", status: "pending", allowedSubagents: ["conexao_inicial", "descoberta"] }
    : scenario.id === "vent"
      ? { id: "goal_work", label: "Rotina de trabalho", description: "Conhecer a rotina", status: "pending", allowedSubagents: ["conexao_inicial", "descoberta"] }
      : null;
  return {
    current_stage_id: "conexao_inicial",
    responseDelayMinutes: 0,
    orchestration: {
      version: 1,
      mode: "shadow",
      brainProvider: "openai_agent",
      strictOpenAiPilot: true,
      currentPhase: "conexao_inicial",
      checkpoint: "chk_saudacao_feita",
      lastProcessedMessageId: null,
      lastProcessedAt: null,
      lastProcessingStatus: "idle",
      lastCorrelationId: null,
      lastDecision: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
      memory: { entities: {}, snippets: [] },
    },
    ...(objective ? { objectives: [objective] } : {}),
  };
}

// O runtime produtivo é Deno/TypeScript. Este carregador existe somente no
// processo do teste para remover tipos TS antes da execução Node; não altera
// módulos, imports ou comportamento do Edge Function.
function loadEdgeModule(entryFile) {
  const cache = new Map();
  const nativeRequire = createRequire(import.meta.url);
  const load = (file) => {
    let resolved = path.resolve(file);
    if (!path.extname(resolved)) resolved += ".ts";
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} };
    cache.set(resolved, module);
    const source = fs.readFileSync(resolved, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: resolved,
    }).outputText;
    const scopedRequire = (specifier) => {
      if (specifier.startsWith(".")) return load(path.resolve(path.dirname(resolved), specifier));
      return nativeRequire(specifier);
    };
    vm.runInNewContext(compiled, {
      module,
      exports: module.exports,
      require: scopedRequire,
      fetch: globalThis.fetch,
      console,
      Deno: globalThis.Deno,
      Request: globalThis.Request,
      Response: globalThis.Response,
      Headers: globalThis.Headers,
      URL: globalThis.URL,
      URLSearchParams: globalThis.URLSearchParams,
      AbortSignal: globalThis.AbortSignal,
      TextEncoder: globalThis.TextEncoder,
      TextDecoder: globalThis.TextDecoder,
      crypto: globalThis.crypto,
      structuredClone: globalThis.structuredClone,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Set,
      Map,
      Error,
      Promise,
    }, { filename: resolved });
    return module.exports;
  };
  return load(entryFile);
}

async function deleteIfPresent(supabase, table, column = "conversation_id") {
  const { error } = await supabase.from(table).delete().eq(column, FIXTURE_ID);
  // A instalação pode não possuir todas as tabelas auxiliares; isso não é uma
  // razão para apagar outro dado nem para esconder falha em tabelas existentes.
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw new Error(`Limpeza de ${table} falhou: ${error.message}`);
}

async function ensureFixtureAbsent(supabase) {
  const { data, error } = await supabase.from("instagram_conversations").select("id").eq("id", FIXTURE_ID);
  if (error) throw new Error(`Preflight da fixture falhou: ${error.message}`);
  if (data?.length) throw new Error(`Fixture ${FIXTURE_ID} já existe; interrompido sem alterar registros existentes.`);
}

async function cleanupFixture(supabase) {
  await deleteIfPresent(supabase, "audio_delivery_history");
  await deleteIfPresent(supabase, "conversation_episodic_memory");
  await deleteIfPresent(supabase, "instagram_messages");
  const { error } = await supabase.from("instagram_conversations").delete().eq("id", FIXTURE_ID);
  if (error) throw new Error(`Limpeza de instagram_conversations falhou: ${error.message}`);
  const { data: remaining, error: remainingError } = await supabase.from("instagram_conversations").select("id", { count: "exact" }).eq("id", FIXTURE_ID);
  if (remainingError) throw new Error(`Verificação final da limpeza falhou: ${remainingError.message}`);
  if (remaining?.length) throw new Error("fixtureRemainingCount diferente de zero");
  return 0;
}

async function createFixture(supabase, scenario, onConversationInserted) {
  await ensureFixtureAbsent(supabase);
  const { error } = await supabase.from("instagram_conversations").insert({
    id: FIXTURE_ID,
    username: "shadow_e2e_brain_test",
    full_name: "Shadow E2E Brain Test",
    contact_id: null,
    ai_auto_respond: true,
    stage_completed_rules: makeStageRules(scenario),
  });
  if (error) throw new Error(`Criação da fixture falhou: ${error.message}`);
  onConversationInserted();
  const id = `${fixtureMessagePrefix}${scenario.id}_${Date.now()}`;
  const now = new Date().toISOString();
  const { error: messageError } = await supabase.from("instagram_messages").insert({
    id,
    conversation_id: FIXTURE_ID,
    sender_id: "shadow_e2e_sender",
    text: scenario.text,
    direction: "inbound",
    is_mine: false,
    created_at: now,
    timestamp: now,
  });
  if (messageError) throw new Error(`Criação da mensagem inbound falhou: ${messageError.message}`);
  return { id, timestamp: now };
}

async function main() {
  loadDotEnv();
  process.env.ENABLE_OPENAI_BRAIN_AGENT = "true";
  required("NEXT_PUBLIC_SUPABASE_URL");
  required("SUPABASE_SERVICE_ROLE_KEY");
  required("OPENAI_API_KEY");
  required("OPENAI_BRAIN_AGENT_ID");

  // Compatibilidade explícita com módulos Edge sem escrever em credenciais.
  globalThis.Deno ??= { env: { get: (key) => process.env[key] } };
  const telemetry = {
    brainAgentsApiCalls: 0,
    brainChatCompletionsCalls: 0,
    executorChatCompletionsCalls: 0,
    metaApiAttempts: 0,
    metaSendAttempts: 0,
    agentItems: [],
    agentPlans: [],
  };
  const originalFetch = globalThis.fetch;

  // Instalada ANTES do carregamento TS: o VM recebe esta referência, não a
  // implementação original. Meta continua fail-closed; Chat Completions do
  // executor é observada e atribuída, sem ser confundida com o Brain.
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url.includes("graph.facebook.com") || url.includes("graph.instagram.com")) {
      telemetry.metaApiAttempts++;
      throw new Error("TEST_META_ACCESS_FORBIDDEN");
    }
    const stack = new Error().stack || "";
    if (url.includes("/v1/agents/")) telemetry.brainAgentsApiCalls++;
    if (url.includes("/v1/chat/completions")) {
      if (stack.includes("callModelOrOpenAi")) telemetry.executorChatCompletionsCalls++;
      else telemetry.brainChatCompletionsCalls++;
    }
    const response = await originalFetch(input, init);
    if (url.includes("/v1/agents/sessions/") && url.endsWith("/items") && response.ok) {
      try {
        const items = (await response.clone().json()).data || [];
        telemetry.agentItems.push(...items);
        const plan = planFromAgentItems(items);
        if (plan) telemetry.agentPlans.push(plan);
      } catch { /* telemetria nunca altera a resposta real */ }
    }
    return response;
  };
  const { runExperimentalOrchestration } = loadEdgeModule("supabase/functions/api/experimental_orchestrator.ts");
  const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"));
  let fixtureCreated = false;

  let exitError;
  try {
    const activeScenarios = runAll ? scenarios : scenarios.slice(0, 1);
    for (const scenario of activeScenarios) {
      const inbound = await createFixture(supabase, scenario, () => { fixtureCreated = true; });
      const startedAt = Date.now();
      const result = await runExperimentalOrchestration({
        supabase,
        conversationId: FIXTURE_ID,
        newMessage: { id: inbound.id, text: scenario.text, timestamp: inbound.timestamp, sender: "shadow_e2e_sender" },
        responseDelayMinutes: 0,
        runtime: {
          sendMetaTextMessage: async () => {
            telemetry.metaSendAttempts++;
            throw new Error("TEST_META_ACCESS_FORBIDDEN");
          },
        },
      });
      const cycle = (await supabase.from("instagram_conversations").select("stage_completed_rules").eq("id", FIXTURE_ID).maybeSingle()).data?.stage_completed_rules?.orchestration?.recentCycles?.[0];
      const plan = telemetry.agentPlans.at(-1) || null;
      const tools = extractToolEvidence(telemetry.agentItems);
      const textAfter = result.decision?.suggestedResponse || "";
      const qualityTrace = (result.trace || []).filter((entry) => entry.includes("quality") || entry.includes("fallback") || entry.includes("retry"));
      const report = {
        conversationId: FIXTURE_ID,
        scenario: scenario.label,
        durationMs: Date.now() - startedAt,
        tools,
        toolCount: tools.length,
        objectiveDecision: plan?.objectiveDecision,
        candidateObjectiveEvidence: (result.trace || []).filter((entry) => entry.startsWith("objective_candidate_evidence:")),
        responsibleSubagent: plan?.responsibleSubagent,
        bestHook: plan?.missionPackage?.bestHook,
        curiosityOpportunity: plan?.missionPackage?.curiosityOpportunity,
        questionRecommendation: plan?.missionPackage?.questionRecommendation,
        relevantPersonaFacts: (plan?.missionPackage?.relevantPersonaFacts || []).map(sanitizeFact),
        turnContract: plan?.missionPackage?.turnContract,
        missionPackage: plan?.missionPackage,
        textBeforeQualityGate: textAfter,
        hashBeforeQualityGate: digest(textAfter),
        textAfterQualityGate: textAfter,
        hashAfterQualityGate: digest(textAfter),
        qualityWarnings: qualityTrace,
        shadowState: cycle?.shadowSimulation || result.mode,
        finalResponse: textAfter,
        brainModelUsed: cycle?.brainModel || "gpt-5.6-terra",
        executorModelUsed: cycle?.executorModel || "gpt-5.6-terra",
        brainAgentsApiCalls: telemetry.brainAgentsApiCalls,
        brainChatCompletionsCalls: telemetry.brainChatCompletionsCalls,
        executorChatCompletionsCalls: telemetry.executorChatCompletionsCalls,
        metaApiAttempts: telemetry.metaApiAttempts,
        metaSendAttempts: telemetry.metaSendAttempts,
      };
      console.log(JSON.stringify(report, null, 2));

      assert.equal(telemetry.metaApiAttempts, 0, "Meta Graph foi tentada");
      assert.equal(telemetry.metaSendAttempts, 0, "runtime.sendMetaTextMessage foi tentado");
      assert.equal(telemetry.brainChatCompletionsCalls, 0, "Brain chamou Chat Completions");
      assert.equal(telemetry.executorChatCompletionsCalls, 0, "Executor chamou Chat Completions na arquitetura de turno único");
      assert.equal(result.handled, true, `Ciclo não foi concluído: ${result.error || "erro não informado"}`);
      assert.ok(plan, "Plano final da Agents API não foi capturado");
      assert.equal(report.hashBeforeQualityGate, report.hashAfterQualityGate, "QualityGate alterou resposta válida");
      assert.ok(!qualityTrace.some((entry) => entry.includes("safe_fallback") || entry.includes("quality_retry=true")), "QualityGate aplicou fallback/retry semântico");
      if (scenario.requiresPersonaMemory) {
        assert.ok(tools.some((tool) => tool.name === "persona_memory_search"), "persona_memory_search não foi chamada no ciclo");
        const memoryTool = tools.find((tool) => tool.name === "persona_memory_search");
        if (memoryTool && memoryTool.resultCount > 0) {
          assert.ok(report.relevantPersonaFacts.length > 0, "Plano não carregou fatos relevantes da PersonaMemory");
        }
      }
      if (scenario.expectedObjective) assert.equal(plan?.objectiveDecision, scenario.expectedObjective, "Decisão de objetivo divergente");

      await cleanupFixture(supabase);
      fixtureCreated = false;
    }
  } catch (error) {
    exitError = error;
  } finally {
    globalThis.fetch = originalFetch;
    if (fixtureCreated) {
      try {
        const remaining = await cleanupFixture(supabase);
        console.log(JSON.stringify({ conversationId: FIXTURE_ID, fixtureRemainingCount: remaining }, null, 2));
      } catch (cleanupError) {
        exitError = new Error(`${exitError?.message || "Falha no E2E"}; limpeza obrigatória falhou: ${cleanupError.message}`);
      }
    }
  }
  if (exitError) throw exitError;
}

main().catch((error) => {
  console.error(`NO-GO: ${error.message || String(error)}`);
  process.exitCode = 1;
});
