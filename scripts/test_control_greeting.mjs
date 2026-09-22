import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const FIXTURE_ID = "__shadow_e2e_brain_control__";
const fixtureMessagePrefix = "__shadow_e2e_ctrl__";

function loadDotEnv() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error(".env.local não encontrado.");
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
  if (!value) throw new Error(`${name} ausente.`);
  return value;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16)}`;
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

async function cleanupFixture(supabase) {
  await supabase.from("audio_delivery_history").delete().eq("conversation_id", FIXTURE_ID);
  await supabase.from("conversation_episodic_memory").delete().eq("conversation_id", FIXTURE_ID);
  await supabase.from("instagram_messages").delete().eq("conversation_id", FIXTURE_ID);
  await supabase.from("instagram_conversations").delete().eq("id", FIXTURE_ID);
  const { data: remaining } = await supabase.from("instagram_conversations").select("id").eq("id", FIXTURE_ID);
  return remaining?.length || 0;
}

async function main() {
  loadDotEnv();
  process.env.ENABLE_OPENAI_BRAIN_AGENT = "true";
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
      } catch {}
    }
    return response;
  };

  const { runExperimentalOrchestration } = loadEdgeModule("supabase/functions/api/experimental_orchestrator.ts");
  const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"));

  let fixtureCreated = false;
  try {
    // 1. Limpa qualquer residuo anterior
    await cleanupFixture(supabase);

    // 2. Insere conversa fixture
    await supabase.from("instagram_conversations").insert({
      id: FIXTURE_ID,
      username: "shadow_e2e_ctrl",
      full_name: "Shadow E2E Control",
      ai_auto_respond: true,
      stage_completed_rules: {
        current_stage_id: "conexao_inicial",
        responseDelayMinutes: 0,
        orchestration: {
          version: 1,
          mode: "shadow",
          brainProvider: "openai_agent",
          strictOpenAiPilot: true,
          currentPhase: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          updatedAt: new Date().toISOString(),
          memory: { entities: {}, snippets: [] },
        },
      },
    });
    fixtureCreated = true;

    const inboundId = `${fixtureMessagePrefix}_${Date.now()}`;
    const now = new Date().toISOString();
    await supabase.from("instagram_messages").insert({
      id: inboundId,
      conversation_id: FIXTURE_ID,
      sender_id: "shadow_e2e_sender",
      text: "Oii, tudo bem?",
      direction: "inbound",
      is_mine: false,
      created_at: now,
      timestamp: now,
    });

    const startedAt = Date.now();
    const result = await runExperimentalOrchestration({
      supabase,
      conversationId: FIXTURE_ID,
      newMessage: { id: inboundId, text: "Oii, tudo bem?", timestamp: now, sender: "shadow_e2e_sender" },
      responseDelayMinutes: 0,
      runtime: {
        sendMetaTextMessage: async () => {
          telemetry.metaSendAttempts++;
          throw new Error("TEST_META_ACCESS_FORBIDDEN");
        },
      },
    });

    const plan = telemetry.agentPlans.at(-1) || null;
    const tools = extractToolEvidence(telemetry.agentItems);
    const textAfter = result.decision?.suggestedResponse || "";

    const report = {
      conversationId: FIXTURE_ID,
      scenario: "Controle (Oii, tudo bem?)",
      durationMs: Date.now() - startedAt,
      personaMemoryCalls: tools.length,
      personaMemoryQuery: tools[0]?.query || null,
      memoryConsulted: Boolean(plan?.missionPackage?.memoryConsulted),
      memoryRationale: plan?.missionPackage?.memoryRationale || null,
      relevantPersonaFacts: plan?.missionPackage?.relevantPersonaFacts || [],
      responsibleSubagent: plan?.responsibleSubagent,
      objectiveDecision: plan?.objectiveDecision,
      missionPackage: plan?.missionPackage,
      finalResponse: textAfter,
      brainModelUsed: "gpt-5.6-terra (Agents API)",
      executorModelUsed: "gpt-4o-mini",
      brainAgentsApiCalls: telemetry.brainAgentsApiCalls,
      brainChatCompletionsCalls: telemetry.brainChatCompletionsCalls,
      executorChatCompletionsCalls: telemetry.executorChatCompletionsCalls,
      metaApiAttempts: telemetry.metaApiAttempts,
      metaSendAttempts: telemetry.metaSendAttempts,
    };

    console.log("\n=== RELATÓRIO DO TESTE DE CONTROLE ===");
    console.log(JSON.stringify(report, null, 2));

    // Validações mandatórias do controle:
    assert.equal(report.personaMemoryCalls, 0, `Esperado personaMemoryCalls = 0, recebido ${report.personaMemoryCalls}`);
    assert.equal(report.memoryConsulted, false, `Esperado memoryConsulted = false, recebido ${report.memoryConsulted}`);
    assert.equal(report.personaMemoryQuery, null, `Esperado personaMemoryQuery = null, recebido ${report.personaMemoryQuery}`);
    assert.equal(report.relevantPersonaFacts.length, 0, `Esperado relevantPersonaFacts = [], recebido ${report.relevantPersonaFacts.length}`);
    assert.equal(telemetry.brainChatCompletionsCalls, 0, "Brain chamou chat completions");
    assert.equal(telemetry.metaApiAttempts, 0, "Meta Graph chamada");

    console.log("\n✅ TESTE DE CONTROLE APROVADO COM SUCESSO!");
  } finally {
    globalThis.fetch = originalFetch;
    if (fixtureCreated) {
      const remaining = await cleanupFixture(supabase);
      console.log(`Fixture cleanup: remaining = ${remaining}`);
    }
  }
}

main().catch((err) => {
  console.error("ERRO NO CONTROLE:", err);
  process.exitCode = 1;
});
