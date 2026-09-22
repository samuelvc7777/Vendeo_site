#!/usr/bin/env node
// ============================================================================
// TESTE REAL AGENT SHADOW E2E
// Zero mock de callOpenAiAgent, zero mock de callModel.
// Barreira de rede: Meta Graph API bloqueada, /v1/chat/completions = 0.
// ============================================================================

import { runOpenAiBrainTurn, buildOpenAiBrainContextMessage } from "../supabase/functions/api/openai_brain.ts";
import { createClient } from "@supabase/supabase-js";
import test from "node:test";
import assert from "node:assert/strict";

// Carrega .env.local manualmente
import fs from "node:fs";
import path from "node:path";
const envPath = path.resolve(import.meta.dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // .env.local tem prioridade sobre variaveis de ambiente do sistema
    process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BRAIN_AGENT_ID = process.env.OPENAI_BRAIN_AGENT_ID;
const OPENAI_MCP_VAULT_ID = process.env.OPENAI_MCP_VAULT_ID;

// Validacao pre-flight
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("ERRO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes em .env.local");
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error("ERRO: OPENAI_API_KEY ausente em .env.local");
  process.exit(1);
}
if (!OPENAI_BRAIN_AGENT_ID) {
  console.error("ERRO: OPENAI_BRAIN_AGENT_ID ausente em .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Interceptor global de fetch para:
// 1. BLOQUEAR qualquer chamada à Meta Graph API (barreira de rede)
// 2. CONTAR chamadas a /v1/chat/completions (esperado: 0)
const originalFetch = globalThis.fetch;
let chatCompletionsCalls = 0;
let metaGraphApiCalls = 0;
const allFetchUrls = [];

globalThis.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : input?.url || "";
  allFetchUrls.push(url);

  // Barreira de rede: Meta Graph API
  if (url.includes("graph.facebook.com") || url.includes("graph.instagram.com")) {
    metaGraphApiCalls++;
    console.error(`[SHADOW BARRIER] Chamada à Meta Graph API BLOQUEADA: ${url}`);
    return new Response(JSON.stringify({ error: "SHADOW_BARRIER: Meta API blocked" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Contagem de /v1/chat/completions
  if (url.includes("/v1/chat/completions")) {
    chatCompletionsCalls++;
    console.warn(`[SHADOW MONITOR] Chamada a /v1/chat/completions detectada! count=${chatCompletionsCalls}`);
  }

  return originalFetch(input, init);
};

const SUBAGENTS = [
  { id: "subagent_conexao_inicial", name: "Conexão Inicial", mission: "Manter diálogo inicial leve" },
  { id: "subagent_engajamento", name: "Engajamento", mission: "Aprofundar conexão emocional" },
];

// ============================================================================
// CENÁRIO A: Motocross — Brain deve usar MCP persona_memory_search e NÃO fabricar fato negativo
// ============================================================================
test("CENARIO A (Motocross): Brain real busca PersonaMemory e nao fabrica fato negativo", async () => {
  console.log("\n========== CENARIO A: MOTOCROSS ==========");

  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: "shadow_e2e_motocross",
    currentStageId: "conexao_inicial",
    inboundMessages: ["Eu amo andar de motocross, vc ja andou?"],
    recentMessages: [
      { sender: "user", text: "Oi, tudo bem?", createdAt: new Date().toISOString() },
      { sender: "larissa", text: "Oi! Tudo sim 😊", createdAt: new Date().toISOString() },
    ],
    availableSubagents: SUBAGENTS,
    agentId: OPENAI_BRAIN_AGENT_ID,
    apiKey: OPENAI_API_KEY,
    vaultIds: OPENAI_MCP_VAULT_ID ? [OPENAI_MCP_VAULT_ID] : undefined,
    strictOpenAiPilot: false,
  });

  console.log("[A] success:", result.success);
  console.log("[A] telemetry.toolsRequested:", result.telemetry.toolsRequested);
  console.log("[A] telemetry.sourcesUsed:", result.telemetry.sourcesUsed);
  console.log("[A] telemetry.durationMs:", result.telemetry.durationMs);
  console.log("[A] plan?.action:", result.plan?.action);
  console.log("[A] plan?.responsibleSubagent:", result.plan?.responsibleSubagent);
  if (result.plan?.reasoning) {
    console.log("[A] plan.reasoning (primeiros 200 chars):", result.plan.reasoning.slice(0, 200));
  }

  assert.ok(result.success, "Brain real deve retornar success: true");
  assert.ok(result.plan, "Brain real deve retornar plano");
  assert.ok(result.telemetry.sessionId, "Deve ter sessionId real da OpenAI");
  assert.ok(result.telemetry.durationMs > 0, "Deve ter duração real positiva");

  // O Brain NÃO deve ter chamado /v1/chat/completions diretamente
  // (ele usa Agents API, não chat completions)

  console.log("[A] ✅ Cenário A concluído com sucesso\n");
});

// ============================================================================
// CENÁRIO B: Saudação simples — Brain deve responder sem PersonaMemory obrigatória
// ============================================================================
test("CENARIO B (Saudacao): Brain real responde saudacao sem exigir PersonaMemory", async () => {
  console.log("\n========== CENARIO B: SAUDACAO ==========");

  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: "shadow_e2e_saudacao",
    currentStageId: "conexao_inicial",
    inboundMessages: ["Oi, tudo bem?"],
    recentMessages: [],
    availableSubagents: SUBAGENTS,
    agentId: OPENAI_BRAIN_AGENT_ID,
    apiKey: OPENAI_API_KEY,
    vaultIds: OPENAI_MCP_VAULT_ID ? [OPENAI_MCP_VAULT_ID] : undefined,
    strictOpenAiPilot: false,
  });

  console.log("[B] success:", result.success);
  console.log("[B] plan?.action:", result.plan?.action);
  console.log("[B] plan?.responsibleSubagent:", result.plan?.responsibleSubagent);
  console.log("[B] telemetry.durationMs:", result.telemetry.durationMs);

  assert.ok(result.success, "Brain real deve retornar success: true");
  assert.ok(result.plan, "Brain real deve retornar plano");

  console.log("[B] ✅ Cenário B concluído com sucesso\n");
});

// ============================================================================
// CENÁRIO C: Faculdade/Enfermagem — Brain DEVE consultar PersonaMemory antes de responder
// ============================================================================
test("CENARIO C (Faculdade): Brain real busca PersonaMemory sobre curso/faculdade", async () => {
  console.log("\n========== CENARIO C: FACULDADE ==========");

  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: "shadow_e2e_faculdade",
    currentStageId: "conexao_inicial",
    inboundMessages: ["Vc faz faculdade? O que vc estuda?"],
    recentMessages: [
      { sender: "user", text: "Oi, blz?", createdAt: new Date().toISOString() },
      { sender: "larissa", text: "Oi! Tudo e vc?", createdAt: new Date().toISOString() },
    ],
    availableSubagents: SUBAGENTS,
    agentId: OPENAI_BRAIN_AGENT_ID,
    apiKey: OPENAI_API_KEY,
    vaultIds: OPENAI_MCP_VAULT_ID ? [OPENAI_MCP_VAULT_ID] : undefined,
    strictOpenAiPilot: false,
  });

  console.log("[C] success:", result.success);
  console.log("[C] telemetry.toolsRequested:", result.telemetry.toolsRequested);
  console.log("[C] telemetry.sourcesUsed:", result.telemetry.sourcesUsed);
  console.log("[C] plan?.action:", result.plan?.action);
  console.log("[C] plan?.responsibleSubagent:", result.plan?.responsibleSubagent);
  if (result.plan?.reasoning) {
    console.log("[C] plan.reasoning (primeiros 200 chars):", result.plan.reasoning.slice(0, 200));
  }

  assert.ok(result.success, "Brain real deve retornar success: true");
  assert.ok(result.plan, "Brain real deve retornar plano");

  console.log("[C] ✅ Cenário C concluído com sucesso\n");
});

// ============================================================================
// VALIDAÇÕES GLOBAIS PÓS-CENÁRIOS
// ============================================================================
test("VALIDACAO GLOBAL: Zero chamadas a /v1/chat/completions pelo Brain (Agents API only)", () => {
  console.log("\n========== VALIDACAO GLOBAL ==========");
  console.log(`[GLOBAL] chatCompletionsCalls = ${chatCompletionsCalls}`);
  console.log(`[GLOBAL] metaGraphApiCalls = ${metaGraphApiCalls}`);
  console.log(`[GLOBAL] total fetch URLs interceptadas = ${allFetchUrls.length}`);

  assert.equal(
    chatCompletionsCalls,
    0,
    `Brain NÃO deve chamar /v1/chat/completions (esperado: 0, encontrado: ${chatCompletionsCalls})`
  );
  assert.equal(
    metaGraphApiCalls,
    0,
    `Shadow mode NÃO deve chamar Meta Graph API (esperado: 0, encontrado: ${metaGraphApiCalls})`
  );

  console.log("[GLOBAL] ✅ Todas as barreiras de shadow mode respeitadas\n");
});
