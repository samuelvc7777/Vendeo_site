import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GREETING_REPEAT_WINDOW_MINUTES,
  deriveRecentGreetingState,
  detectGreetingRepeat,
  formatRecentGreetingStateForPrompt,
  normalizeGreetingPrefix,
} from "../supabase/functions/api/greeting_repeat_guard.ts";
import {
  buildTurnContract,
  runConversationQualityGate,
} from "../supabase/functions/api/ConversationQualityGate.ts";
import { buildPersistentTurnContext } from "../supabase/functions/api/openai_brain.ts";

const confirmedGreeting = (timestamp, text = "bom diaa, tudo bem?") => ({
  text,
  timestamp,
  status: "sent",
});

test("A — bloqueia ping-pong imediato de saudação", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T13:00:00.000Z", "bom diaa")],
    referenceAt: "2026-09-27T13:13:00.000Z",
    inboundMessages: ["Bom diaa"],
  });
  assert.equal(state.larissaAlreadyGreeted, true);
  assert.equal(state.minutesAgo, 13);
  assert.equal(detectGreetingRepeat({ candidateBalloons: ["bom diaa"], state }).blocked, true);
});

test("B — saudação repetida não ocupa o foco do lote substantivo", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T13:00:00.000Z")],
    referenceAt: "2026-09-27T13:13:00.000Z",
    confirmedLastTurn: ["bom diaa, tô bem simm", "vc é de onde?"],
    inboundMessages: ["Bom diaa", "Sou de Nova Resende", "E vc?"],
  });
  const substantiveResponse = ["sou de São João del-Rei", "nossaa, que interessante esse circuito do café aí"];
  assert.equal(detectGreetingRepeat({ candidateBalloons: substantiveResponse, state }).blocked, false);
  assert.match(substantiveResponse.join(" "), /São João del-Rei/);
});

test("C — permite saudação numa primeira troca", () => {
  const state = deriveRecentGreetingState({ confirmedOutbounds: [], referenceAt: "2026-09-27T13:13:00.000Z" });
  const candidate = ["bom diaa, tudo bem com vc?"];
  const contract = buildTurnContract(["bom dia"], { freshGreetingExchange: true });
  assert.equal(state.larissaAlreadyGreeted, false);
  assert.equal(detectGreetingRepeat({ candidateBalloons: candidate, state }).blocked, false);
  assert.equal(runConversationQualityGate({ inboundMessages: ["bom dia"], candidateBalloons: candidate, turnContract: contract }).passed, true);
});

test("D — permite nova saudação em outro dia", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-26T13:00:00.000Z")],
    referenceAt: "2026-09-27T13:13:00.000Z",
  });
  assert.equal(state.larissaAlreadyGreeted, false);
});

test("E — permite saudação após gap real e mudança de período", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T13:00:00.000Z")],
    referenceAt: "2026-09-27T22:00:00.000Z",
  });
  assert.equal(state.larissaAlreadyGreeted, false);
  assert.equal(state.greetingPeriodChanged, true);
});

test("mudança de período em menos de 90 minutos continua dentro da mesma troca", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T14:50:00.000Z")],
    referenceAt: "2026-09-27T15:10:00.000Z",
  });
  assert.equal(state.greetingPeriodChanged, true);
  assert.equal(state.larissaAlreadyGreeted, true);
});

test("F — não pede outra pergunta de bem-estar quando ele devolve a pergunta respondida", () => {
  const inbound = "tô bem e vc?";
  const contract = buildTurnContract([inbound], { freshGreetingExchange: false });
  const result = runConversationQualityGate({
    inboundMessages: [inbound],
    candidateBalloons: ["tô bem tambémm"],
    turnContract: contract,
    freshGreetingExchange: false,
  });
  assert.equal(result.passed, true);
  assert.ok(!result.issues.some((issue) => issue.code === "MISSING_WELLBEING_QUESTION"));
});

test("G — guard rejeita sem editar o texto e pede regeneração", async () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T13:00:00.000Z")],
    referenceAt: "2026-09-27T13:13:00.000Z",
  });
  const original = "bom diaa, sou de São João";
  const candidate = [original];
  const result = detectGreetingRepeat({ candidateBalloons: candidate, state });
  assert.equal(result.code, "GREETING_REPEAT_GUARD");
  assert.deepEqual(candidate, [original]);
  const quality = runConversationQualityGate({
    inboundMessages: ["Bom diaa"],
    candidateBalloons: candidate,
    turnContract: buildTurnContract(["Bom diaa"], { freshGreetingExchange: false }),
    freshGreetingExchange: false,
    greetingRepeatBlocked: result.blocked,
  });
  assert.ok(quality.issues.some((issue) => issue.code === "GREETING_REPEAT_GUARD"));
  const source = await readFile(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /greeting_repeat_regeneration_requested=true/);
  assert.match(source, /GREETING_REPEAT_GUARD: Você já cumprimentou este pretendente/);
});

test("H — regeneração preserva cidade e próximo gancho", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T13:00:00.000Z")],
    referenceAt: "2026-09-27T13:13:00.000Z",
  });
  const regenerated = ["sou de São João del-Rei", "nossaa, que interessante esse circuito do café aí, vc trabalha com isso também?"];
  assert.equal(detectGreetingRepeat({ candidateBalloons: regenerated, state }).blocked, false);
  assert.match(regenerated[0], /São João del-Rei/);
  assert.match(regenerated[1], /circuito do café/);
});

test("I — outbound não confirmado não abre a janela de saudação", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [
      { text: "bom diaa", timestamp: "2026-09-27T13:00:00.000Z", status: "pending" },
      { text: "oii", timestamp: "2026-09-27T13:01:00.000Z", status: "dispatch_uncertain" },
    ],
    referenceAt: "2026-09-27T13:13:00.000Z",
  });
  assert.equal(state.larissaAlreadyGreeted, false);
});

test("J — estado chega também no contexto de sessão persistente", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T13:00:00.000Z")],
    referenceAt: "2026-09-27T13:13:00.000Z",
    confirmedLastTurn: ["bom diaa, tô bem simm", "vc é de onde?"],
  });
  const context = buildPersistentTurnContext({
    supabase: {},
    conversationId: "fixture-jhonathan-1575908440939908",
    currentStageId: "conexao_inicial",
    inboundMessages: ["Bom diaa", "Sou de Nova Resende", "E vc?"],
    recentMessages: [],
    persistentSessionEnabled: true,
    recentGreetingState: state,
  });
  assert.match(context, /larissaAlreadyGreeted=true/);
  assert.match(context, /greetingType=bom_dia/);
  assert.match(context, /ÚLTIMA FALA CONFIRMADA DA LARISSA:[\s\S]*"vc é de onde\?"/);
});

test("Fixture Jhonathan — 13 minutos depois, bom diaa repetido nunca passa ao despacho", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T12:08:00.000Z", "bom diaa, tô bem simm\nvc é de onde?")],
    referenceAt: "2026-09-27T12:21:00.000Z",
    inboundMessages: ["Bom diaa", "Que bom", "Sou de Nova Resende", "E vc?"],
  });
  const brainCandidate = ["bom diaa, sou de São João del-Rei", "nossaa, que interessante esse circuito do café aí"];
  assert.equal(GREETING_REPEAT_WINDOW_MINUTES >= 13, true);
  assert.equal(normalizeGreetingPrefix(brainCandidate[0]), "bom_dia");
  assert.equal(detectGreetingRepeat({ candidateBalloons: brainCandidate, state }).blocked, true);
  const dispatchCandidate = ["sou de São João del-Rei", "nossaa, que interessante esse circuito do café aí"];
  assert.equal(detectGreetingRepeat({ candidateBalloons: dispatchCandidate, state }).blocked, false);
});

test("A trava final fica entre a formação das ações e a preparação da outbox", async () => {
  const source = await readFile(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
  const guardIndex = source.indexOf("const dispatchGreetingRepeat = detectGreetingRepeat");
  const outboxIndex = source.indexOf("OUTBOX PATTERN: Sequência Canônica de Ações de Saída");
  const persistIndex = source.indexOf("persistCanonicalBrainDecision", outboxIndex);
  assert.ok(guardIndex > outboxIndex && guardIndex < persistIndex);
  assert.match(source, /GREETING_REPEAT_GUARD_DISPATCH_BLOCKED/);
});

test("Saudações no corpo da resposta não acionam o guard conservador", () => {
  const state = deriveRecentGreetingState({
    confirmedOutbounds: [confirmedGreeting("2026-09-27T13:00:00.000Z")],
    referenceAt: "2026-09-27T13:13:00.000Z",
  });
  assert.equal(detectGreetingRepeat({ candidateBalloons: ["eita bom dia corrido viu kkk"], state }).blocked, false);
  assert.equal(detectGreetingRepeat({ candidateBalloons: ["seu bom dia chegou tarde demais kkk"], state }).blocked, false);
  assert.match(formatRecentGreetingStateForPrompt(state), /não repita o cumprimento/);
});
