import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const FIXTURE_ID = "__shadow_e2e_generalization__";

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

async function runScenario(supabase, orchestrator, text, label) {
  await cleanupFixture(supabase);

  await supabase.from("instagram_conversations").insert({
    id: FIXTURE_ID,
    username: "shadow_e2e_gen",
    full_name: "Shadow E2E Gen",
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

  const inboundId = `gen_${Date.now()}`;
  const now = new Date().toISOString();
  await supabase.from("instagram_messages").insert({
    id: inboundId,
    conversation_id: FIXTURE_ID,
    sender_id: "shadow_e2e_sender",
    text,
    direction: "inbound",
    is_mine: false,
    created_at: now,
    timestamp: now,
  });

  const agentItems = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url.includes("graph.facebook.com") || url.includes("graph.instagram.com")) {
      throw new Error("TEST_META_ACCESS_FORBIDDEN");
    }
    const response = await originalFetch(input, init);
    if (url.includes("/v1/agents/sessions/") && url.endsWith("/items") && response.ok) {
      try {
        const items = (await response.clone().json()).data || [];
        agentItems.push(...items);
      } catch {}
    }
    return response;
  };

  try {
    const startedAt = Date.now();
    const result = await orchestrator.runExperimentalOrchestration({
      supabase,
      conversationId: FIXTURE_ID,
      newMessage: { id: inboundId, text, timestamp: now, sender: "shadow_e2e_sender" },
      responseDelayMinutes: 0,
      runtime: {
        sendMetaTextMessage: async () => {
          throw new Error("TEST_META_ACCESS_FORBIDDEN");
        },
      },
    });

    const tools = extractToolEvidence(agentItems);
    const plan = planFromAgentItems(agentItems);
    const textAfter = result.decision?.suggestedResponse || "";

    const report = {
      label,
      text,
      durationMs: Date.now() - startedAt,
      tools,
      toolCount: tools.length,
      memoryConsulted: plan?.missionPackage?.memoryConsulted,
      relevantPersonaFacts: plan?.missionPackage?.relevantPersonaFacts || [],
      finalResponse: textAfter,
    };

    console.log(`\n=== GENERALIZAÇÃO: ${label} ===`);
    console.log(JSON.stringify(report, null, 2));

    return report;
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupFixture(supabase);
  }
}

async function main() {
  loadDotEnv();
  process.env.ENABLE_OPENAI_BRAIN_AGENT = "true";
  globalThis.Deno ??= { env: { get: (key) => process.env[key] } };

  const orchestrator = loadEdgeModule("supabase/functions/api/experimental_orchestrator.ts");
  const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"));

  // 1. Cenário: Praia / Viagem
  await runScenario(supabase, orchestrator, "Adoro viajar pra praia.", "Praia / Viagem");

  // 2. Cenário: Filme de terror
  await runScenario(supabase, orchestrator, "Gosto muito de filme de terror.", "Filme de Terror");

  console.log("\n✅ AMBOS OS TESTES DE GENERALIZAÇÃO CONCLUÍDOS!");
}

main().catch((err) => {
  console.error("ERRO GENERALIZAÇÃO:", err);
  process.exitCode = 1;
});
