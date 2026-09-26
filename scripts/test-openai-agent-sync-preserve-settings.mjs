#!/usr/bin/env node
/**
 * scripts/test-openai-agent-sync-preserve-settings.mjs
 * 
 * Bateria de testes para validação da política de sincronização do OpenAI Agent:
 * 1. Preservação estrita de configurações remotas: GPT-6 Luna, Extra High, Verbosity Medium
 * 2. Injeção segura de cofre_audio_search sem remover ferramentas MCP existentes
 * 3. Preservação de reasoning 'max' quando o remoto estiver em 'max' (regra de preservação remota, sem forçar valor estático)
 * 4. Fail-closed: se as configurações de reasoning do remoto forem desconhecidas/ausentes, aborta com erro
 * 5. Fail-closed: se o model do remoto for desconhecido/ausente, aborta com erro
 * 6. Assert de segurança: detecção e bloqueio de sobrescrita acidental de extra_high para max
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentSyncPayload } from "./sync_openai_agent.mjs";
import {
  buildCanonicalAgentInstructions,
  VENDEO_AGENT_INSTRUCTIONS_VERSION,
} from "../supabase/functions/api/openai_agent_instructions.ts";
import { COFRE_AUDIO_SEARCH_TOOL_DEFINITION } from "../supabase/functions/api/openai_brain.ts";

test("1. Fixture remoto com Extra High: preserva GPT-6 Luna, extra_high e verbosity medium", () => {
  const remoteFixture = {
    id: "agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482",
    model: "gpt-6-luna",
    reasoning: "extra_high",
    verbosity: "medium",
    instructions: "VENDEO_AGENT_INSTRUCTIONS_VERSION: 2.8.2\nInstruções antigas...",
    tools: [
      {
        type: "mcp",
        server_label: "vendeo_memory",
        required: true,
        allowed_tools: [
          "persona_memory_search",
          "contact_memory_search",
          "conversation_memory_search",
        ],
      },
    ],
  };

  const canonicalInstructions = buildCanonicalAgentInstructions();
  const payload = buildAgentSyncPayload(remoteFixture, canonicalInstructions, COFRE_AUDIO_SEARCH_TOOL_DEFINITION);

  // Asserts de preservação de configurações essenciais
  assert.equal(payload.model, "gpt-6-luna", "Model deve permanecer gpt-6-luna");
  assert.equal(payload.reasoning, "extra_high", "Reasoning deve permanecer extra_high");
  assert.notEqual(payload.reasoning, "max", "Reasoning NUNCA pode ser sobrescrito para max");
  assert.equal(payload.verbosity, "medium", "Verbosity deve permanecer medium");

  // Asserts de atualização de instruções
  assert.ok(payload.instructions.includes(`VENDEO_AGENT_INSTRUCTIONS_VERSION: ${VENDEO_AGENT_INSTRUCTIONS_VERSION}`));
  assert.ok(payload.instructions.includes("COFRE DE ÁUDIOS"));

  // Asserts de ferramentas: memórias existentes preservadas + cofre_audio_search injetado
  assert.equal(payload.tools.length, 2, "Deve conter 2 ferramentas (mcp + cofre_audio_search)");
  const mcpTool = payload.tools.find((t) => t.server_label === "vendeo_memory");
  assert.ok(mcpTool, "Ferramenta MCP vendeo_memory deve existir intacta");
  assert.deepEqual(mcpTool.allowed_tools, [
    "persona_memory_search",
    "contact_memory_search",
    "conversation_memory_search",
  ]);

  const cofreTool = payload.tools.find((t) => t.function?.name === "cofre_audio_search");
  assert.ok(cofreTool, "Ferramenta cofre_audio_search deve ser adicionada");
});

test("2. Fixture remoto com Max: preserva 'max' (regra de preservação remota sem forçar extra_high)", () => {
  const remoteFixtureMax = {
    id: "agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482",
    model: "gpt-6-luna",
    reasoning: "max",
    verbosity: "high",
    instructions: "VENDEO_AGENT_INSTRUCTIONS_VERSION: 2.8.2",
    tools: [
      {
        type: "mcp",
        server_label: "vendeo_memory",
        allowed_tools: ["persona_memory_search"],
      },
    ],
  };

  const canonicalInstructions = buildCanonicalAgentInstructions();
  const payload = buildAgentSyncPayload(remoteFixtureMax, canonicalInstructions, COFRE_AUDIO_SEARCH_TOOL_DEFINITION);

  assert.equal(payload.model, "gpt-6-luna");
  assert.equal(payload.reasoning, "max", "Se o remoto estiver em max, deve preservar max fielmente");
  assert.equal(payload.verbosity, "high");
  assert.ok(payload.tools.some((t) => t.function?.name === "cofre_audio_search"));
});

test("3. Suporte a reasoning_effort aninhado no formato alternativo da OpenAI", () => {
  const remoteFixtureNested = {
    model: "gpt-6-luna",
    reasoning_effort: "extra_high",
    tools: [],
  };

  const canonicalInstructions = buildCanonicalAgentInstructions();
  const payload = buildAgentSyncPayload(remoteFixtureNested, canonicalInstructions, COFRE_AUDIO_SEARCH_TOOL_DEFINITION);

  assert.equal(payload.reasoning, "extra_high");
  assert.equal(payload.reasoning_effort, "extra_high");
});

test("4. Fail-closed: remoto com reasoning ausente ou desconhecido deve lançar erro e abortar", () => {
  const invalidRemoteFixture = {
    id: "agent_test",
    model: "gpt-6-luna",
    // reasoning ausente!
    tools: [],
  };

  const canonicalInstructions = buildCanonicalAgentInstructions();
  assert.throws(
    () => {
      buildAgentSyncPayload(invalidRemoteFixture, canonicalInstructions, COFRE_AUDIO_SEARCH_TOOL_DEFINITION);
    },
    /FAIL_CLOSED: Configurações de reasoning do Agent remoto não puderam ser verificadas/,
    "Deve abortar fail-closed se o reasoning remoto for desconhecido"
  );
});

test("5. Fail-closed: remoto com model ausente deve lançar erro e abortar", () => {
  const invalidRemoteFixture = {
    id: "agent_test",
    reasoning: "extra_high",
    tools: [],
  };

  const canonicalInstructions = buildCanonicalAgentInstructions();
  assert.throws(
    () => {
      buildAgentSyncPayload(invalidRemoteFixture, canonicalInstructions, COFRE_AUDIO_SEARCH_TOOL_DEFINITION);
    },
    /FAIL_CLOSED: Não foi possível identificar o model do Agent remoto/,
    "Deve abortar fail-closed se o model remoto for desconhecido"
  );
});

test("6. Idempotência de tools: se cofre_audio_search já estiver presente, não duplica", () => {
  const remoteFixtureWithCofre = {
    model: "gpt-6-luna",
    reasoning: "extra_high",
    tools: [
      COFRE_AUDIO_SEARCH_TOOL_DEFINITION,
    ],
  };

  const canonicalInstructions = buildCanonicalAgentInstructions();
  const payload = buildAgentSyncPayload(remoteFixtureWithCofre, canonicalInstructions, COFRE_AUDIO_SEARCH_TOOL_DEFINITION);

  assert.equal(payload.tools.length, 1, "Não deve duplicar cofre_audio_search se já presente");
  assert.equal(payload.tools[0].function.name, "cofre_audio_search");
});

console.log("Suíte test-openai-agent-sync-preserve-settings carregada com sucesso.");
