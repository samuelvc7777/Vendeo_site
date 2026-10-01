import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  COFRE_AUDIO_SEARCH_TOOL_DEFINITION,
  COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION,
  brainLateRecoveryDisposition,
  getExistingOpenAiTurn,
} from "../supabase/functions/api/openai_brain.ts";
import { objectiveEvidenceExists } from "../supabase/functions/api/objective_evidence.ts";

const root = process.cwd();
const migration = fs.readFileSync(`${root}/supabase/migrations/20260926235806_brain_late_recovery_and_manual_facts.sql`, "utf8");
const orchestrator = fs.readFileSync(`${root}/supabase/functions/api/brain_orchestrator.ts`, "utf8");
const apiIndex = fs.readFileSync(`${root}/supabase/functions/api/index.ts`, "utf8");
const openAiBrain = fs.readFileSync(`${root}/supabase/functions/api/openai_brain.ts`, "utf8");
const canonicalPrompt = fs.readFileSync(`${root}/supabase/functions/api/larissa_canonical_prompt.md`, "utf8");

test("turno late concluído é consultado por GET e recuperação não cria inferência", async () => {
  const requests = [];
  const result = await getExistingOpenAiTurn({
    apiKey: "test-key", sessionId: "session-existing", turnId: "turn-existing",
    fetcher: async (url, init) => {
      requests.push({ url: String(url), method: init.method || "GET" });
      return new Response(JSON.stringify({ id: "turn-existing", status: "completed" }), { status: 200 });
    },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(requests.map(({ method }) => method), ["GET"]);
  assert.match(requests[0].url, /turn-existing$/);
});

test("turno ainda ativo permanece brain_late sem despacho", async () => {
  let dispatches = 0;
  const providerStatus = "in_progress";
  if (brainLateRecoveryDisposition(providerStatus) === "recover") dispatches++;
  assert.equal(dispatches, 0);
  assert.equal(brainLateRecoveryDisposition(providerStatus), "wait");
  assert.equal(brainLateRecoveryDisposition("completed"), "recover");
  assert.equal(brainLateRecoveryDisposition("failed"), "fail");
  assert.match(migration, /SET status = p_status[\s\S]*status = 'brain_late'[\s\S]*recovery_lease_token = p_worker_token/);
});

test("inbound novo exige revisão do Brain antes de permitir despacho tardio", async () => {
  const order = [];
  const inbound = ["old", "new"];
  const original = new Set(["old"]);
  const deferred = inbound.filter((id) => !original.has(id));
  if (deferred.length) order.push("brain_keep_cancel_replace_review");
  order.push("persist_outbox");
  const brain = orchestrator.slice(orchestrator.indexOf("export function selectMessagesForLateTurn"), orchestrator.indexOf("export function formatConversationContextForModel"));
  assert.deepEqual(order, ["brain_keep_cancel_replace_review", "persist_outbox"]);
  assert.match(brain, /deferredIds: messages\.filter/);
  assert.match(orchestrator, /pending_inbound_requires_brain_review/);
});

test("lease SQL impede dois workers de reivindicarem o mesmo turno late", () => {
  const claim = migration.slice(migration.indexOf("FUNCTION public.claim_brain_late_turns"), migration.indexOf("FUNCTION public.release_brain_late_turn"));
  assert.match(claim, /FOR UPDATE SKIP LOCKED/);
  assert.match(claim, /recovery_lease_token = p_worker_token/);
  assert.match(claim, /recovery_lease_expires_at/);
});

test("fato session-only é persistido fora de persona_memory e continua disponível após reinicialização", async () => {
  const insertFact = migration.indexOf("INSERT INTO public.brain_manual_facts");
  const permanentPromotion = migration.indexOf("IF p_save_for_future THEN", insertFact);
  const personaInsert = migration.indexOf("INSERT INTO public.persona_memory", permanentPromotion);
  assert.ok(insertFact >= 0 && permanentPromotion > insertFact && personaInsert > permanentPromotion);
  assert.match(migration.slice(permanentPromotion, personaInsert), /p_save_for_future/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.brain_manual_facts/);
  // A sessão seguinte continua lendo o armazenamento durável pelo id de sessão;
  // a leitura não depende de estado em memória do processo.
  assert.match(orchestrator, /\.from\("brain_manual_facts"\)[\s\S]*\.eq\("session_id", brainSessionRow\.id\)/);
});

test("fato permanente também é promovido para a memória disponível em novas sessões", () => {
  const permanentBranch = migration.slice(migration.indexOf("IF p_save_for_future THEN"), migration.indexOf("SELECT stage_completed_rules", migration.indexOf("IF p_save_for_future THEN")));
  assert.match(permanentBranch, /INSERT INTO public\.persona_memory/);
  assert.match(permanentBranch, /ON CONFLICT \(persona_id, key\) DO UPDATE/);
});

test("resolução manual aceita resposta parcial e proíbe perguntar novamente no mesmo turno", () => {
  assert.match(canonicalPrompt, /RESOLUÇÃO MANUAL É UMA ÚNICA INTERVENÇÃO POR TURNO/);
  assert.match(canonicalPrompt, /Mesmo que o operador responda somente parte da pergunta original/);
  assert.match(openAiBrain, /manual_resolution_reask_forbidden_after_operator_answer/);
  assert.match(openAiBrain, /params\.manualResolutionAnswer && parsedPlan\?\.action === "manual_resolution"/);
});

test("endpoint de resolução manual responde rápido e continua o Brain em background", () => {
  const start = apiIndex.indexOf('path === "/autopilot/manual-resolution"');
  const end = apiIndex.indexOf("// 8.11. AUTOPILOT: RETRY MANUAL ÚNICO", start);
  const endpoint = apiIndex.slice(start, end);
  assert.match(endpoint, /EdgeRuntime\?\.waitUntil/);
  assert.match(endpoint, /status: 202/);
  assert.match(endpoint, /status: "processing"/);
  assert.doesNotMatch(endpoint, /const result = await runBrainOrchestration/);
});

test("questionIntents inválido não descarta resposta nem abre nova inferência", () => {
  assert.match(openAiBrain, /question_intents_metadata_dropped/);
  assert.match(openAiBrain, /parsedPlan\.questionIntents = \[\]/);
  assert.match(openAiBrain, /parsedPlan\.resolvedQuestionIntentIds = \[\]/);
  const validationBlock = openAiBrain.slice(
    openAiBrain.indexOf("const questionIntentsValidation = validateQuestionIntentsInvariant"),
    openAiBrain.indexOf("if (params.strictOpenAiPilot)", openAiBrain.indexOf("const questionIntentsValidation = validateQuestionIntentsInvariant")),
  );
  assert.doesNotMatch(validationBlock, /: questionIntentsValidation/);
});

test("manual_fact só valida dentro da conversa e da sessão durável", async () => {
  const db = {
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() {
          const rows = table === "brain_sessions"
            ? [{ id: "session-1", conversation_id: "conv-1", provider_session_id: "provider-1" }]
            : [{ id: "fact-1", conversation_id: "conv-1", session_id: "session-1" }];
          return { data: rows.find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)) || null, error: null };
        },
      };
    },
  };
  const evidence = { type: "manual_fact", id: "fact-1" };
  assert.equal(await objectiveEvidenceExists(db, "conv-1", evidence, "provider-1"), true);
  assert.equal(await objectiveEvidenceExists(db, "conv-1", evidence, "provider-other"), false);
  assert.equal(await objectiveEvidenceExists(db, "conv-other", evidence, "provider-1"), false);
});

test("contratos de áudio exigem objective_id e backend não seleciona semanticamente", () => {
  for (const description of [
    COFRE_AUDIO_SEARCH_TOOL_DEFINITION.function.description,
    COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.description,
  ]) {
    assert.match(description, /somente/i);
    assert.match(description, /objective_id solicitado/);
    assert.match(description, /não faz seleção semântica/);
  }
  const audioCode = fs.readFileSync(`${root}/supabase/functions/api/openai_brain.ts`, "utf8");
  assert.match(audioCode, /query = query\.eq\("objective_id", objective_id\.trim\(\)\)/);
});

test("backend não calcula nextStage a partir da conclusão de objetivos", () => {
  assert.doesNotMatch(orchestrator, /processDeterministicStageProgression/);
  const start = orchestrator.indexOf("export async function validateAndApplyBrainStageDecision");
  const end = orchestrator.indexOf("export function selectMessagesForLateTurn", start);
  const implementation = orchestrator.slice(start, end);
  assert.match(implementation, /decision\.nextPhase/);
  assert.doesNotMatch(implementation, /completed\.length\s*===|order\s*ASC|nextStageFromObjectives/);
});
