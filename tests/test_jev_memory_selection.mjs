import test from "node:test";
import assert from "node:assert/strict";
import { createJevCircuitBreaker, readJevMemoryConfig, selectJevMemories } from "../supabase/functions/api/jev_memory_selector.ts";
import { loadPersonaMemoryCatalog } from "../supabase/functions/api/persona_memory_repository.ts";
import { prepareBrainMemoryContext } from "../supabase/functions/api/brain_memory_context.ts";
import { buildCanonicalAgentInstructions } from "../supabase/functions/api/openai_agent_instructions.ts";
import { LARISSA_OPTIONAL_MEMORIES, LARISSA_ESSENTIAL_PROMPT, LARISSA_CANONICAL_PROMPT } from "../supabase/functions/api/larissa_canonical_prompt.generated.ts";

const config = { mode: "active", apiKey: "test-only", threshold: 0.6, timeoutMs: 500 };
const memory = (id, text = "Gosta de filmes de terror.") => ({ id, text, source: "canonical", revision: "1" });
const transport = (score = 0.9, mutate = value => value) => async (_url, options) => {
  const body = JSON.parse(options.body);
  assert.equal(body.model, "jev-1.13.0");
  const optionsKeys = Object.keys(body.questions.review.criteria);
  return Response.json(mutate({ model: body.model, answers: { review: { type: "choice", choice: optionsKeys[0] }, second: { type: "choice", choice: optionsKeys[1] || "none" }, has_answer: { type: "noul", noul: score } }, usage: { input_tokens: 10, output_tokens: 0 } }));
};
function database(rows, failingPage = -1) {
  const calls = [];
  return { calls, from(table) {
    assert.equal(table, "persona_memory");
    const query = {
      select() { return query; },
      eq(key, value) { calls.push(["eq", key, value]); assert.equal(key, "persona_id"); assert.equal(value, "larissa"); return query; },
      order(key) { assert.equal(key, "id"); return query; },
      range(from, to) { calls.push(["range", from, to]); query.page = from; query.rows = rows.slice(from, to + 1); return query; },
      abortSignal(signal) { query.signal = signal; return query; },
      then(resolve, reject) { return Promise.resolve(query.page === failingPage ? { error: "failed" } : { data: query.rows }).then(resolve, reject); },
    };
    return query;
  } };
}
const row = (index, fields = {}) => ({ id: String(index).padStart(4, "0"), persona_id: "larissa", key: `fato_${index}`, value: { fact: `Fato original ${index}` }, source_type: "generated", confidence: 0.9, aliases: [], updated_at: "2026-10-08T00:00:00Z", ...fields });
const turn = supabase => ({ supabase, conversationId: "chat-A", sessionId: "session-A", currentStageId: "inicio", inboundMessages: ["Você pensa em ser mãe?"], recentMessages: [], manualSessionFacts: [{ id: "manual-1", question: "Confirma?", fact: "Resposta humana atual" }] });

test("revisão pelo Jev resolve textos originais e limita a duas memórias", async () => {
  const memories = Array.from({ length: 8 }, (_, index) => memory(String(index)));
  const result = await selectJevMemories({ memories, state: { query: "Que filmes você curte?" }, config, fetchImpl: transport() });
  assert.equal(result.status, "complete"); assert.deepEqual(result.memories, memories.slice(0, 2)); assert.equal(result.evaluatedCount, 8);
  assert.equal(result.inputTokens, 10);
});

test("nenhuma memória relevante é sucesso, distinto de indisponibilidade", async () => {
  const result = await selectJevMemories({ memories: [memory("1")], state: {}, config, fetchImpl: transport(0.1) });
  assert.equal(result.status, "complete"); assert.deepEqual(result.memories, []);
});

test("Jev pode dispensar segunda memória repetida sem backend comparar texto", async () => {
  const memories = [memory("A", "Conhecer alguém sem pressa."), memory("B", "Conhecer uma pessoa com calma.")];
  let reviews = 0;
  const result = await selectJevMemories({ memories, state: {}, config, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    if (!body.questions.review) return transport()(url, options);
    reviews++;
    assert.equal(body.state.selected.length, 0);
    return Response.json({ model: body.model, answers: { review: { type: "choice", choice: "1" }, second: { type: "choice", choice: "none" }, has_answer: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 1 } });
  } });
  assert.equal(result.status, "complete"); assert.deepEqual(result.memories, [memories[1]]); assert.equal(reviews, 1);
});

test("ID inventado na revisão descarta seleção e conserva fallback", async () => {
  const result = await selectJevMemories({ memories: [memory("A")], state: {}, config, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    if (!body.questions.review) return transport()(url, options);
    return Response.json({ model: body.model, answers: { review: { type: "choice", choice: "inventado" }, second: { type: "choice", choice: "none" }, has_answer: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 1 } });
  } });
  assert.equal(result.status, "unavailable"); assert.equal(result.reason, "invalid_answer"); assert.deepEqual(result.memories, []);
});

for (const [name, mutate] of [
  ["ID ausente", value => ({ ...value, answers: {} })],
  ["ID substituído", value => ({ ...value, answers: { unknown: { type: "noul", noul: 0.9 } } })],
  ["ID adicional", value => ({ ...value, answers: { ...value.answers, unknown: { type: "noul", noul: 0.9 } } })],
  ["tipo errado", value => ({ ...value, answers: { has_answer: { type: "text", noul: 0.9 } } })],
  ["número fora do intervalo", value => ({ ...value, answers: { has_answer: { type: "noul", noul: 1.1 } } })],
  ["número como string", value => ({ ...value, answers: { has_answer: { type: "noul", noul: "0.9" } } })],
  ["modelo diferente", value => ({ ...value, model: "other" })],
  ["uso ausente", value => ({ ...value, usage: undefined })],
]) test(`retorno inválido: ${name} nunca vira seleção vazia bem-sucedida`, async () => {
  const result = await selectJevMemories({ memories: [memory("1")], state: {}, config, fetchImpl: transport(0.9, mutate) });
  assert.equal(result.status, "unavailable"); assert.deepEqual(result.memories, []);
});

for (const status of [401, 422, 429, 529]) test(`HTTP ${status}: sem retries longos nem exposição do corpo`, async () => {
  let calls = 0;
  const result = await selectJevMemories({ memories: [memory("1")], state: {}, config, fetchImpl: async () => { calls++; return new Response("segredo", { status }); } });
  assert.equal(result.reason, `http_${status}`); assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes("segredo"), false);
});

test("cancelamento antes da chamada não consulta o provedor", async () => {
  const controller = new AbortController(); controller.abort();
  const result = await selectJevMemories({ memories: [memory("1")], state: {}, config, signal: controller.signal, fetchImpl: () => assert.fail("não deveria chamar") });
  assert.equal(result.reason, "cancelled");
});

test("timeout cancela transporte e não entrega seleção parcial", async () => {
  const result = await selectJevMemories({ memories: [memory("1")], state: {}, config: { ...config, timeoutMs: 10 }, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("abort")))) });
  assert.equal(result.reason, "timeout"); assert.equal(result.status, "unavailable");
});

test("catálogo duplicado não chama provedor", async () => {
  const result = await selectJevMemories({ memories: [memory("1"), memory("1")], state: {}, config, fetchImpl: () => assert.fail() });
  assert.equal(result.reason, "invalid_catalog");
});

test("lotes cobrem todo catálogo além de 120 sem cortar fatos", async () => {
  let calls = 0;
  const memories = Array.from({ length: 250 }, (_, index) => memory(String(index), "a".repeat(400)));
  const result = await selectJevMemories({ memories, state: {}, config, fetchImpl: async (...args) => { calls++; return transport()(...args); } });
  assert.equal(result.status, "complete"); assert.equal(result.evaluatedCount, 250); assert.equal(result.memories.length, 2); assert.ok(calls > 1);
});

test("falha em lote posterior descarta seleção parcial e conserva tokens já medidos", async () => {
  let calls = 0;
  const memories = Array.from({ length: 150 }, (_, index) => memory(String(index), "a".repeat(500)));
  const result = await selectJevMemories({ memories, state: {}, config, fetchImpl: async (...args) => ++calls === 1 ? transport()(...args) : new Response("erro", { status: 529 }) });
  assert.equal(result.status, "unavailable"); assert.equal(result.memories.length, 0); assert.equal(result.inputTokens, 10);
});

test("orçamento excedido não trunca estado ou candidato", async () => {
  const result = await selectJevMemories({ memories: [memory("1")], state: "a".repeat(25000), config, fetchImpl: () => assert.fail() });
  assert.equal(result.reason, "state_budget_exceeded");
});

test("repositório pagina todas as memórias sem categoria temática", async () => {
  const db = database(Array.from({ length: 401 }, (_, index) => row(index)));
  const memories = await loadPersonaMemoryCatalog({ supabase: db, personaId: "larissa" });
  assert.equal(memories.length, 401); assert.equal(db.calls.filter(call => call[0] === "range").length, 3);
  assert.equal(memories[0].source, "persona_memory:generated");
});

test("validade exclui futuro e vencido, mantendo negações originais", async () => {
  const db = database([row(1, { value: { fact: "Não quer filhos" } }), row(2, { valid_until: "2026-10-08T08:00:00Z" }), row(3, { valid_from: "2026-10-09T00:00:00Z" })]);
  const memories = await loadPersonaMemoryCatalog({ supabase: db, personaId: "larissa", now: new Date("2026-10-08T08:00:00Z") });
  assert.equal(memories.length, 1); assert.match(memories[0].text, /Não quer filhos/);
});

test("persona incorreta ou paginação falha não entrega catálogo parcial", async () => {
  await assert.rejects(loadPersonaMemoryCatalog({ supabase: database([row(1, { persona_id: "other" })]), personaId: "larissa" }), /inconsistent/);
  await assert.rejects(loadPersonaMemoryCatalog({ supabase: database(Array.from({ length: 201 }, (_, index) => row(index)), 200), personaId: "larissa" }), /unavailable/);
});

test("modo desligado não consulta banco nem Jev", async () => {
  const prepared = await prepareBrainMemoryContext(turn({ from: () => assert.fail() }), { ...config, mode: "off" });
  assert.equal(prepared.useSelectedPrompt, false); assert.equal(prepared.selection, undefined);
});

test("orçamento evita nova leitura cara no mesmo turno sem inventar memória", async () => {
  let calls = 0;
  const prepared = await prepareBrainMemoryContext(turn(database([row(1)])), config, { fetchImpl: async (...args) => {
    calls++;
    return transport(0.9, payload => ({ ...payload, usage: { input_tokens: 30000, output_tokens: 0 } }))(...args);
  } });
  assert.equal(prepared.useSelectedPrompt, true);
  const lookup = JSON.parse(await prepared.lookup("Qual outra informação?"));
  assert.equal(lookup.reason, "turn_memory_budget"); assert.equal(calls, 1);
  assert.match(lookup.instruction, /Não invente/);
});

test("compactação envia todos os fatos e preserva negação sem aliases de busca", async () => {
  const input = memory("A", JSON.stringify({ key: "children", value: "Não quer filhos", aliases: ["alias que não deve ir"], confidence: 0.9 }));
  const result = await selectJevMemories({ memories: [input], state: {}, config, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.state.memories["0"], { children: "Não quer filhos" });
    assert.equal(options.body.includes("alias que não deve ir"), false);
    return transport()(url, options);
  } });
  assert.deepEqual(result.memories, [input]);
});

test("modo sombra avalia, mas conserva prompt completo e não habilita ferramenta", async () => {
  const prepared = await prepareBrainMemoryContext(turn(database([row(1)])), { ...config, mode: "shadow" }, { fetchImpl: transport() });
  assert.equal(prepared.selection.status, "complete"); assert.equal(prepared.useSelectedPrompt, false); assert.equal(prepared.lookup, undefined);
});

test("modo ativo consulta todos e mantém fatos da sessão separados no contexto", async () => {
  const params = turn(database([row(1)]));
  const prepared = await prepareBrainMemoryContext(params, config, { fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.state.context.sessionFacts, params.manualSessionFacts);
    return transport()(url, options);
  } });
  assert.equal(prepared.useSelectedPrompt, true); assert.equal(prepared.selection.memories.length, 2);
  assert.equal(JSON.parse(await prepared.lookup("filhos")).status, "complete");
  assert.equal(JSON.parse(await prepared.lookup("filmes")).status, "complete");
  assert.equal(JSON.parse(await prepared.lookup("música")).reason, "turn_lookup_limit");
});

test("falta de chave e falha de catálogo mantêm prompt completo", async () => {
  const prepared = await prepareBrainMemoryContext(turn(database([])), { ...config, apiKey: "" });
  assert.equal(prepared.useSelectedPrompt, false); assert.equal(prepared.selection.reason, "missing_key");
  const failed = await prepareBrainMemoryContext(turn(database([], 0)), config);
  assert.equal(failed.useSelectedPrompt, false); assert.equal(failed.selection.reason, "catalog_unavailable");
});

test("prompt essencial mantém rotina/regras e todo fato retirado tem origem canônica", () => {
  assert.equal(buildCanonicalAgentInstructions(), LARISSA_CANONICAL_PROMPT);
  assert.equal(buildCanonicalAgentInstructions({ selectedMemoryMode: true }), LARISSA_ESSENTIAL_PROMPT);
  for (const text of ["06:00–11:00", "12:00–17:00", "19:00–22:00", "ROTINA CADASTRADA É SUFICIENTE", "Telefone e WhatsApp", "Instagram / Arrobas", "SUSPEITA DE ROBÔ"]) assert.ok(LARISSA_ESSENTIAL_PROMPT.includes(text));
  for (const item of LARISSA_OPTIONAL_MEMORIES) { assert.ok(LARISSA_CANONICAL_PROMPT.includes(item.text)); assert.equal(LARISSA_ESSENTIAL_PROMPT.includes(item.text), false); }
});

test("configuração exige ativação explícita; limiar antigo não decide fatos", () => {
  const get = values => key => values[key];
  assert.equal(readJevMemoryConfig(get({})).mode, "off");
  assert.equal(readJevMemoryConfig(get({ JEV_MEMORY_MODE: "active" })).mode, "active");
  assert.equal(readJevMemoryConfig(get({ JEV_MEMORY_MODE: "active", JEV_MEMORY_THRESHOLD: "0.6" })).mode, "active");
});

test("circuit breaker suspende falhas recorrentes por prazo limitado", async () => {
  let now = 0;
  const breaker = createJevCircuitBreaker(() => now);
  let calls = 0;
  const params = { memories: [memory("1")], state: {}, config, circuitBreaker: breaker, fetchImpl: async () => { calls++; return new Response("erro", { status: 529 }); } };
  for (let index = 0; index < 3; index++) await selectJevMemories(params);
  assert.equal((await selectJevMemories(params)).reason, "circuit_open"); assert.equal(calls, 3);
  now = 30001;
  assert.equal((await selectJevMemories({ ...params, fetchImpl: transport() })).status, "complete");
  assert.equal(breaker.allows(), true);
});

test("seleção grande demais usa fallback sem recortar memórias relevantes", async () => {
  const db = database(Array.from({ length: 60 }, (_, index) => row(index, { value: { fact: "x".repeat(500) } })));
  const prepared = await prepareBrainMemoryContext(turn(db), { ...config, brainMaxBytes: 1000 }, { fetchImpl: transport() });
  assert.equal(prepared.useSelectedPrompt, false); assert.equal(prepared.selection.reason, "brain_context_budget_exceeded");
  assert.equal(prepared.selection.memories.length, 0); assert.equal(prepared.selection.evaluatedCount, 60 + LARISSA_OPTIONAL_MEMORIES.length);
});

test("falha da consulta complementar entrega fatos canônicos de fallback", async () => {
  let calls = 0;
  const params = { ...turn(database([row(1)])), loadLegacyPersistentManualFacts: async () => [{ key: "manual", question: "Filhos?", fact: "Fato humano" }] };
  const prepared = await prepareBrainMemoryContext(params, config, { fetchImpl: async (...args) => ++calls === 1 ? transport()(...args) : new Response("erro", { status: 422 }) });
  const lookup = JSON.parse(await prepared.lookup("Qual comida?"));
  assert.equal(lookup.status, "unavailable"); assert.deepEqual(lookup.fallbackMemories, LARISSA_OPTIONAL_MEMORIES);
  assert.equal(lookup.fallbackManualFacts[0].fact, "Fato humano");
});
