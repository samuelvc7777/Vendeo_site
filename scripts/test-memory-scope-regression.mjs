import assert from "node:assert/strict";
import fs from "node:fs";
import { createAgentMemoryScope } from "../supabase/functions/api/contact_memory.ts";
import { classifyMemorySearchStatus, prepareMemoryToolCall } from "../supabase/functions/_shared/memory_tool_context.ts";
import {
  buildOpenAiBrainContextMessage,
  buildSessionAgentToolsWithMemoryScope,
  runOpenAiBrainTurn,
  CONVERSATION_MEMORY_TOOL_DEFINITION,
  CONTACT_MEMORY_TOOL_DEFINITION,
} from "../supabase/functions/api/openai_brain.ts";
import { resolveMemoryScope, searchMcpContactMemory, searchMcpConversationMemory } from "../supabase/functions/vendeo-brain-mcp/_shared/mcp_memory_helpers.ts";

const calls = [];
const supabase = {
  from(table) {
    return {
      insert(row) {
        calls.push({ table, row });
        return Promise.resolve({ error: null });
      },
    };
  },
};

const scopeId = await createAgentMemoryScope({
  supabase,
  conversationId: "conversation_fixture",
  cycleId: "cycle_fixture",
  agentId: "agent_fixture",
  durationSeconds: 300,
});

assert.equal(typeof scopeId, "string", "createAgentMemoryScope retorna o próprio scope como string");
assert.equal(calls[0]?.row.scope_id, scopeId, "o scope retornado corresponde ao capability persistido");
const scopeDurationMs = Date.parse(calls[0].row.expires_at) - Date.parse(calls[0].row.created_at);
assert.ok(scopeDurationMs >= 300_000 && scopeDurationMs < 301_000, "o scope do ciclo respeita o TTL configurado de 300 segundos");

const orchestrator = fs.readFileSync(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
assert.ok(
  /currentMemoryScopeId\s*=\s*scopeRes\s*;/.test(orchestrator),
  "o orquestrador deve propagar a string retornada, sem ler uma propriedade inexistente .scopeId",
);

const context = buildOpenAiBrainContextMessage({
  conversationId: "conversation_internal_fixture",
  currentStageId: "descoberta",
  currentObjectiveId: "idade",
  inboundMessages: ["vim pra cá com 18 anos"],
  recentMessages: [],
  memoryScopeId: scopeId,
});
assert.ok(!context.includes(scopeId), "o Agent não recebe o scope no prompt");
assert.ok(!context.includes("conversation_internal_fixture"), "o Agent não recebe o conversationId interno no prompt");

const prepared = prepareMemoryToolCall("conversation_memory_search", { query: "Larissa já perguntou a idade?" }, scopeId);
assert.equal(prepared.ok, true);
assert.deepEqual(prepared.arguments, { query: "Larissa já perguntou a idade?", scope: scopeId });
assert.equal(prepared.scopeApplied, true);

const secondCall = prepareMemoryToolCall("contact_memory_search", { query: "idade" }, scopeId);
assert.equal(secondCall.ok, true);
assert.equal(secondCall.arguments.scope, scopeId, "o mesmo scope permanece estável entre chamadas no ciclo");
const forgedScopeCall = prepareMemoryToolCall("conversation_memory_search", { query: "idade", scope: "scope_model_inventado" }, scopeId);
assert.equal(forgedScopeCall.arguments.scope, scopeId, "um scope enviado pelo Agent nunca substitui o scope de infraestrutura");
assert.deepEqual(CONVERSATION_MEMORY_TOOL_DEFINITION.function.parameters.required, ["query"]);
assert.deepEqual(CONTACT_MEMORY_TOOL_DEFINITION.function.parameters.required, ["query"]);

const personaCall = prepareMemoryToolCall("persona_memory_search", { query: "idade", scope: "scope_model_inventado" }, scopeId);
assert.equal(personaCall.ok, true);
assert.equal(personaCall.scopeApplied, false, "PersonaMemory não depende de scope no contrato real");
assert.deepEqual(personaCall.arguments, { query: "idade" }, "scope fornecido pelo Agent é removido");

const missingScope = prepareMemoryToolCall("conversation_memory_search", { query: "idade" }, undefined);
assert.deepEqual(missingScope, {
  ok: false,
  toolName: "conversation_memory_search",
  status: "tool_error",
  reasonCode: "memory_scope_missing",
  missingFields: ["scope"],
});

const savedTools = [
  { type: "mcp", server_label: "vendeo_memory", transport: { type: "http", server_url: "https://memory.example/mcp", headers: { "x-preserved": "yes" } }, required: true },
  { type: "mcp", server_label: "other_mcp", transport: { type: "http", server_url: "https://other.example/mcp" } },
];
const sessionTools = buildSessionAgentToolsWithMemoryScope(savedTools, scopeId);
assert.equal(sessionTools[0].transport.headers["x-vendeo-memory-scope"], scopeId);
assert.equal(sessionTools[0].transport.headers["x-preserved"], "yes");
assert.equal(sessionTools[0].transport.server_url, savedTools[0].transport.server_url);
assert.equal(sessionTools[1], savedTools[1], "outras ferramentas do Agent permanecem intactas");

assert.equal(classifyMemorySearchStatus({ found: false, resultCount: 0 }), "success_no_results");
assert.equal(classifyMemorySearchStatus({ isError: true, found: false, resultCount: 0 }), "tool_error");

const scopeRows = new Map(calls.map(({ row }) => [row.scope_id, row]));
const observedConversationIds = [];
const queryDb = {
  from(table) {
    return {
      select() { return this; },
      eq(column, value) {
        if (table === "agent_memory_scopes" && column === "scope_id") this.scopeId = value;
        if (column === "conversation_id") observedConversationIds.push(value);
        return this;
      },
      neq() { return this; },
      maybeSingle() {
        const row = scopeRows.get(this.scopeId);
        return Promise.resolve({ data: row ? { conversation_id: row.conversation_id, cycle_id: row.cycle_id, agent_id: row.agent_id, expires_at: row.expires_at, revoked_at: null } : null, error: null });
      },
      order() { return this; },
      limit() { return this; },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
    };
  },
};
const resolvedScope = await resolveMemoryScope(queryDb, prepared.arguments.scope);
assert.equal(resolvedScope.conversationId, "conversation_fixture");
const resolvedContactScope = await resolveMemoryScope(queryDb, secondCall.arguments.scope);
const emptyContactSearch = await searchMcpContactMemory({
  supabase: queryDb,
  conversationId: resolvedContactScope.conversationId,
  query: String(secondCall.arguments.query),
  scopes: ["facts"],
});
assert.deepEqual(emptyContactSearch, { found: false, results: [] });
const emptySearch = await searchMcpConversationMemory({
  supabase: queryDb,
  conversationId: resolvedScope.conversationId,
  query: String(prepared.arguments.query),
  scopes: ["episodes"],
});
assert.deepEqual(emptySearch, { found: false, results: [] });
assert.deepEqual(observedConversationIds, ["conversation_fixture", "conversation_fixture"], "ContactMemory e ConversationMemory usam a conversa vinculada ao mesmo scope");

const resumedToolResults = [];
const runtimeResult = await runOpenAiBrainTurn({
  supabase: queryDb,
  conversationId: "conversation_fixture",
  currentStageId: "descoberta",
  currentObjectiveId: "idade",
  currentObjectiveLabel: "Descobrir idade",
  inboundMessages: ["vim pra cá com 18 anos"],
  recentMessages: [],
  memoryScopeId: scopeId,
  runtime: {
    async callOpenAiAgent({ executeTool }) {
      resumedToolResults.push(await executeTool("conversation_memory_search", { query: "" }));
      resumedToolResults.push(await executeTool("persona_memory_search", { query: "" }));
      resumedToolResults.push(await executeTool("conversation_memory_search", { query: "" }));
      return { plan: { action: "wait", memoryConsulted: true, memoryRationale: "fixture técnico" } };
    },
  },
});
assert.equal(runtimeResult.success, true, "a execução de teste retorna o resultado das tools à mesma execução do Agent");
assert.equal(runtimeResult.telemetry.memoryToolResults.length, 3);
assert.equal(runtimeResult.telemetry.memoryToolResults[0].status, "success_no_results");
assert.equal(runtimeResult.telemetry.memoryToolResults[1].status, "success_no_results");
assert.equal(runtimeResult.telemetry.memoryToolResults[2].status, "success_no_results");
assert.equal(runtimeResult.telemetry.toolsRequested.length, 3, "a segunda chamada ocorre após o resultado da primeira sem perder o scope");

const scopeB = await createAgentMemoryScope({
  supabase,
  conversationId: "conversation_b_fixture",
  cycleId: "cycle_b_fixture",
  agentId: "agent_fixture",
  durationSeconds: 300,
});
const scopeRowsWithB = new Map(calls.map(({ row }) => [row.scope_id, row]));
const isolatedDb = {
  ...queryDb,
  from(table) {
    const builder = queryDb.from(table);
    builder.maybeSingle = function () {
      const row = scopeRowsWithB.get(this.scopeId);
      return Promise.resolve({ data: row ? { conversation_id: row.conversation_id, cycle_id: row.cycle_id, expires_at: row.expires_at, revoked_at: null } : null, error: null });
    };
    return builder;
  },
};
const [resolvedA, resolvedB] = await Promise.all([
  resolveMemoryScope(isolatedDb, scopeId),
  resolveMemoryScope(isolatedDb, scopeB),
]);
assert.equal(resolvedA.conversationId, "conversation_fixture");
assert.equal(resolvedB.conversationId, "conversation_b_fixture", "scopes concorrentes permanecem isolados por conversa/ciclo");
assert.equal(prepareMemoryToolCall("conversation_memory_search", { query: "idade" }, undefined).reasonCode, "memory_scope_missing", "scope ausente não reutiliza o scope anterior");

const failedSearchDb = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      order() { return this; },
      limit() { return Promise.resolve({ data: null, error: new Error("fixture database outage") }); },
    };
  },
};
await assert.rejects(
  searchMcpConversationMemory({ supabase: failedSearchDb, conversationId: "conversation_fixture", query: "idade", scopes: ["episodes"] }),
);
assert.equal(classifyMemorySearchStatus({ error: new Error("fixture database outage"), found: false, resultCount: 0 }), "tool_error");

const orchestratorLower = orchestrator.toLowerCase();
assert.ok(orchestratorLower.includes("objectivebridgedetected"), "telemetria da bridge permanece no Brain Decision");
assert.ok(orchestratorLower.includes("coveredhooks") && orchestratorLower.includes("ignoredrelevanthooks"), "telemetria dos hooks permanece intacta");
assert.ok(orchestrator.includes("cycleOpenAiUsage.addAgentSession(sessionUsage)"), "agregação de usage do Agent permanece no ciclo");

console.log("OK: capability scope retornado pelo helper é propagado pelo orquestrador.");
