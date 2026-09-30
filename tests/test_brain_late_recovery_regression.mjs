import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getExistingOpenAiTurn, recoverSafeBrainPlan } from "../supabase/functions/api/openai_brain.ts";

test("brain_late retrieve usa o contrato completo da Agents API", async () => {
  const requests = [];
  const result = await getExistingOpenAiTurn({
    apiKey: "test-key",
    sessionId: "session-existing",
    turnId: "turn-existing",
    fetcher: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "turn-existing", status: "completed" }), { status: 200 });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.source, "direct");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method ?? "GET", "GET");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(requests[0].init.headers["OpenAI-Beta"], "agents=v1");
  assert.equal(requests[0].init.headers["Content-Type"], "application/json");
});

test("HTTP 400 no retrieve direto cai para listagem read-only do mesmo turno", async () => {
  const requests = [];
  const result = await getExistingOpenAiTurn({
    apiKey: "test-key",
    sessionId: "session-existing",
    turnId: "turn-target",
    fetcher: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (requests.length === 1) {
        return new Response(JSON.stringify({ error: { message: "direct lookup rejected" } }), { status: 400 });
      }
      return new Response(JSON.stringify({
        data: [
          { id: "turn-other", status: "completed" },
          { id: "turn-target", status: "completed" },
        ],
      }), { status: 200 });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.source, "list_fallback");
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/turns\/turn-target$/);
  assert.match(requests[1].url, /\/turns\?limit=100&order=desc$/);
  assert.equal(requests[1].init.headers["OpenAI-Beta"], "agents=v1");
});

test("falha de autenticação não cria fallback nem nova inferência", async () => {
  let calls = 0;
  await assert.rejects(
    () => getExistingOpenAiTurn({
      apiKey: "bad-key",
      sessionId: "session-existing",
      turnId: "turn-existing",
      fetcher: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "unauthorized" } }), { status: 401 });
      },
    }),
    /existing_turn_lookup_failed:401/,
  );
  assert.equal(calls, 1);
});

test("migration canônica de profissão remove o ID legado e preserva goal_job", () => {
  const sql = fs.readFileSync(
    new URL("../supabase/migrations/20260928113937_migrate_legacy_profession_goal_progress.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /goal_1790089821922_2wamf/);
  assert.match(sql, /goal_job/);
  assert.match(sql, /completed_goals/);
  assert.match(sql, /completedGoalIds/);
  assert.match(sql, /objective_progress/);
  assert.match(sql, /objectiveProgress/);
});

test("brain_late reutiliza o snapshot original sem depender do ledger pendente", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const lateTurnInboundIds = new Set<string>/);
  assert.match(source, /const belongsToLateTurn = lateTurnInboundIds\.has\(String\(msg\.id\)\)/);
  assert.match(source, /collectedPendingRaw\.push\(\{ \.\.\.msg, status: "claimed" \}\)/);
  assert.match(source, /if \(lateTurnInboundIds\.has\(String\(msg\.id\)\)\) \{\s*freshPendingMessages\.push\(msg\)/s);
});

test("brain_late não reivindica novamente mensagens do provider turn existente", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(lateTurnForResume\) \{\s*currentCycle\.trace\.push\(/s);
  assert.match(source, /\} else \{\s*for \(const id of claimedMessageIds\)[\s\S]*claimExperimentalCycleMessagesAtomic/s);
  assert.match(source, /resumeTurnId: lateTurnForResume\?\.provider_turn_id \|\| null/);
  assert.match(source, /resumeExistingTurnOnly: Boolean\(lateTurnForResume\?\.provider_turn_id\)/);
});

test("recovery corrige responseIndex apenas quando o remapeamento é inequívoco", () => {
  const recovered = recoverSafeBrainPlan({
    action: "reply",
    responses: ["e vc curte fazer isso sempre?"],
    outboundActions: [
      { type: "text", text: "e vc curte fazer isso sempre?" },
      { type: "audio", audioId: "audio-hobbies" },
    ],
    questionIntents: [{
      responseIndex: 1,
      intentKey: "hobbies.frequency",
      canonicalMeaning: "saber se ele faz isso com frequência",
      kind: "follow_up",
      target: "pretendente",
    }],
  });

  assert.ok(recovered);
  assert.equal(recovered.questionIntents[0].responseIndex, 0);
  assert.equal(recovered.outboundActions[1].audioId, "audio-hobbies");
});

test("brain_late revalida somente o audioId já escolhido pelo Brain contra o objetivo atual", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(lateTurnForResume && !alreadyAuthorized\)/);
  assert.match(source, /objective_id: lateObjectiveId/);
  assert.match(source, /candidate\.audio_id === agentSelectedAudioId/);
  assert.match(source, /late_turn_audio_revalidated=/);
});

test("webhook não referencia flags legadas inexistentes", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /isExplicitlyDisabled=/);
  assert.doesNotMatch(source, /isPaused=\$\{isPaused\}/);
});

test("scanner de recovery libera lease sem ressuscitar turno concluído", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const finishRecoveredTurnLease = async \(restoreForRetry: boolean\)/);
  assert.match(source, /update = update\.in\("status", \["brain_late", "executing"\]\)/);
  assert.match(source, /if \(!recovery\.handled \|\| recovery\.error\)[\s\S]*finishRecoveredTurnLease\(true\)/s);
  assert.match(source, /else \{\s*await finishRecoveredTurnLease\(false\)/s);
  assert.doesNotMatch(source, /if \(!recovery\.handled && recovery\.error\)[\s\S]*await releaseLateTurn\("brain_late"\)/s);
});

test("cron drena outbox durável antes de bloquear novas inferências pelo toggle global", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/index.ts", import.meta.url),
    "utf8",
  );
  const dispatcherIndex = source.indexOf("list_due_brain_action_conversations");
  const globalGateIndex = source.indexOf("if (!isEnabledGlobally)");
  assert.ok(dispatcherIndex >= 0);
  assert.ok(globalGateIndex > dispatcherIndex);
  assert.match(source.slice(dispatcherIndex, globalGateIndex), /runDurableOutboxDispatcher/);
});
