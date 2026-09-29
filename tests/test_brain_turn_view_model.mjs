import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  brainTurnUiReducer,
  formatBrainEvent,
  formatBrainPhase,
  formatBrainStatus,
  formatVisibleBrainIdentity,
  groupBrainTurns,
  selectActiveBrainTurn,
  getVisibleBrainTurns,
  initialBrainTurnUiState,
} from "../src/presentation/components/chat/brain-turn-view-model.ts";

const uiSource = readFileSync(new URL("../src/presentation/components/chat/AutoPilotActivityIndicator.tsx", import.meta.url), "utf8");
const orchestratorSource = readFileSync(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");

const event = (turnId, name, timestamp, extra = {}) => ({
  turnId,
  sessionId: "session-shared",
  cycleId: `cycle-${turnId}`,
  conversationId: "conversation-1",
  sequence: Date.parse(timestamp),
  event: name,
  status: null,
  phase: "brain",
  label: name,
  timestamp,
  metadata: {},
  ...extra,
});

test("A: eventos de turnos diferentes ficam em grupos independentes", () => {
  const turns = groupBrainTurns([
    event("turn-12", "brain_started", "2026-09-27T12:00:00Z"),
    event("turn-13", "brain_started", "2026-09-27T12:01:00Z"),
    event("turn-12", "action_sent", "2026-09-27T12:00:05Z"),
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turnId, "turn-13");
  assert.deepEqual(turns.find((turn) => turn.turnId === "turn-12").events.map((item) => item.event), ["brain_started", "action_sent"]);
});

test("B e E: turno ativo abre automaticamente e um novo turno recebe o foco", () => {
  const running = groupBrainTurns([event("turn-15", "brain_started", "2026-09-27T12:00:00Z")])[0];
  assert.equal(running.status, "running");
  const first = brainTurnUiReducer(initialBrainTurnUiState, { type: "activate", turnId: running.id });
  assert.equal(first.expandedTurnIds.has("turn:turn-15"), true);
  const second = brainTurnUiReducer(first, { type: "activate", turnId: "turn:turn-16" });
  assert.equal(second.activeTurnId, "turn:turn-16");
  assert.equal(second.expandedTurnIds.has("turn:turn-16"), true);
  assert.equal(second.expandedTurnIds.has("turn:turn-15"), false);
});

test("um turno antigo aberto manualmente continua aberto quando outro turno começa", () => {
  let state = brainTurnUiReducer(initialBrainTurnUiState, { type: "toggle", turnId: "turn:turn-12" });
  state = brainTurnUiReducer(state, { type: "activate", turnId: "turn:turn-15" });
  assert.equal(state.expandedTurnIds.has("turn:turn-12"), true);
  assert.equal(state.expandedTurnIds.has("turn:turn-15"), true);
});

test("C e D: turno concluído recolhe após a janela final e pode ser reaberto", () => {
  let state = brainTurnUiReducer(initialBrainTurnUiState, { type: "activate", turnId: "turn:turn-12" });
  state = brainTurnUiReducer(state, { type: "collapse_finished", turnId: "turn:turn-12" });
  assert.equal(state.expandedTurnIds.has("turn:turn-12"), false);
  state = brainTurnUiReducer(state, { type: "toggle", turnId: "turn:turn-12" });
  assert.equal(state.expandedTurnIds.has("turn:turn-12"), true);
  assert.equal(state.manuallyExpandedTurnIds.has("turn:turn-12"), true);
});

test("F: waiting_human continua como o mesmo turno ativo", () => {
  const turns = groupBrainTurns([
    event("turn-15", "brain_started", "2026-09-27T12:00:00Z"),
    event("turn-15", "manual_resolution_required", "2026-09-27T12:00:03Z", { status: "waiting_human" }),
  ]);
  assert.equal(turns[0].id, "turn:turn-15");
  assert.equal(turns[0].status, "waiting_human");
  assert.equal(turns[0].finishedAt, undefined);
});

test("Robson: a view conclui só com os eventos, sem inbound novo", () => {
  const events = [
    ["decision_persisted", "20:27:43", undefined],
    ["response_ready", "20:27:44", undefined],
    ["action_sent", "20:27:46", "action-1"],
    ["action_sending", "20:27:48", "action-2"],
    ["cycle_completed", "20:27:48", undefined],
    ["action_sent", "20:27:49", "action-2"],
    ["fully_sent", "20:27:49", undefined],
    ["turn_completed", "20:27:49", undefined],
    ["phase_scheduled", "20:28:44", undefined],
  ].map(([name, time, actionId], index) => event(
    "turn-robson",
    name,
    `2026-09-27T${time}Z`,
    { sequence: index, actionId, phase: name === "phase_scheduled" ? "scheduled" : "brain" },
  ));

  const [turn] = groupBrainTurns(events);
  assert.equal(turn.status, "completed");
  assert.equal(turn.finishedAt, "2026-09-27T20:27:49Z");
  assert.equal(turn.summary.sentCount, 2);
  assert.equal(formatBrainStatus(turn.status), "Brain concluído");
  assert.equal(selectActiveBrainTurn([turn], { now: "2026-09-27T20:28:45Z", activeCycleToken: null }), null);
});

test("ciclo provisório órfão é ocultado depois de turnos reais mais novos", () => {
  const turns = groupBrainTurns([
    { ...event(undefined, "toggle_immediate_started", "2026-09-27T01:22:31Z"), turnId: undefined, cycleId: "corr_toggle_imm_1790482950802_824hv0", sessionId: "shared-session" },
    event("turn-3", "turn_completed", "2026-09-27T03:00:00Z"),
    event("turn-4", "turn_completed", "2026-09-27T03:10:00Z"),
  ]);
  const runtime = { now: "2026-09-27T03:11:00Z", activeCycleToken: null };
  assert.equal(selectActiveBrainTurn(turns, runtime), null);
  assert.equal(getVisibleBrainTurns(turns, runtime).some((turn) => turn.cycleId === "corr_toggle_imm_1790482950802_824hv0"), false);
});

test("turno antigo com progresso é superado por um turno real posterior", () => {
  const turns = groupBrainTurns([
    { ...event(undefined, "brain_started", "2026-09-27T01:22:31Z"), turnId: undefined, cycleId: "cycle-orphan-progress", sessionId: "shared-session" },
    event("turn-3", "turn_completed", "2026-09-27T03:00:00Z"),
    event("turn-4", "turn_completed", "2026-09-27T03:10:00Z"),
  ]);
  const runtime = { now: "2026-09-27T03:11:00Z", activeCycleToken: null };
  assert.equal(selectActiveBrainTurn(turns, runtime), null);
  assert.equal(getVisibleBrainTurns(turns, runtime).some((turn) => turn.id === "cycle:cycle-orphan-progress"), false);
});

test("ciclo provisório recente pode aparecer como Iniciando, mas expira sem progressão", () => {
  const turns = groupBrainTurns([
    { ...event(undefined, "toggle_immediate_started", "2026-09-27T03:00:00Z"), turnId: undefined, cycleId: "cycle-provisional", sessionId: "shared-session" },
  ]);
  const active = selectActiveBrainTurn(turns, { now: "2026-09-27T03:00:05Z", activeCycleToken: null });
  assert.equal(active?.cycleId, "cycle-provisional");
  assert.equal(active?.provisional, true);
  assert.equal(selectActiveBrainTurn(turns, { now: "2026-09-27T03:01:00Z", activeCycleToken: null }), null);
});

test("ciclos diferentes na mesma sessão mantêm identidades de turno distintas", () => {
  const turns = groupBrainTurns([
    { ...event(undefined, "brain_started", "2026-09-27T03:00:00Z"), turnId: undefined, cycleId: "cycle-a", sessionId: "shared-session" },
    { ...event(undefined, "brain_started", "2026-09-27T03:01:00Z"), turnId: undefined, cycleId: "cycle-b", sessionId: "shared-session" },
  ]);
  assert.equal(turns.length, 2);
  assert.deepEqual(new Set(turns.map((turn) => turn.cycleId)), new Set(["cycle-a", "cycle-b"]));
});

test("identidades históricas antigas são sanitizadas como Brain", () => {
  assert.doesNotMatch(orchestratorSource, /["']Atria (?:avaliou|respondeu)["']/);
  assert.match(orchestratorSource, /["']Brain (?:avaliou|respondeu)["']/);
  assert.equal(formatVisibleBrainIdentity("Atria avaliou · Atria respondeu"), "Brain avaliou · Brain respondeu");
  assert.equal(formatVisibleBrainIdentity("Atria-Dawn-Preview"), "Brain");
  assert.equal(formatBrainPhase("atria"), "Etapa atualizada");
  assert.match(uiSource, /formatVisibleBrainIdentity\(state\.activity\.label\)/);
});

test("texto histórico antigo permanece sanitizado sem registrar fase ativa obsoleta", () => {
  const historical = { phase: "atria", atriaThought: "Atria respondeu e concluiu o turno." };
  assert.equal(formatBrainPhase(historical.phase), "Etapa atualizada");
  assert.equal(formatVisibleBrainIdentity(historical.atriaThought), "Brain respondeu e concluiu o turno.");
});

test("G: status desconhecido usa texto seguro na camada principal", () => {
  assert.equal(formatBrainStatus("waiting_human"), "Aguardando operador");
  assert.equal(formatBrainStatus("some_new_internal_status"), "Estado atualizado");
});

test("H: eventos e fases técnicas têm rótulos amigáveis em português", () => {
  assert.equal(formatBrainEvent("action_sent"), "Mensagem enviada");
  assert.equal(formatBrainEvent("some_new_internal_event"), "Evento do sistema");
  assert.equal(formatBrainPhase("loading_context"), "Carregando contexto");
});

test("I: metadados e payloads originais continuam acessíveis nos detalhes técnicos", () => {
  const metadata = { model: "gpt-6-luna", usage: { totalTokens: 42 }, evidenceMessageId: "message-1" };
  const turn = groupBrainTurns([event("turn-15", "brain_decision", "2026-09-27T12:00:00Z", { metadata })])[0];
  assert.deepEqual(turn.events[0].metadata, metadata);
  assert.match(uiSource, /Ver detalhes técnicos/);
});

test("o console usa os formatadores e não apresenta state.status cru", () => {
  assert.match(uiSource, /formatBrainStatus\(/);
  assert.match(uiSource, /formatBrainEvent\(/);
  assert.match(uiSource, /formatBrainPhase\(/);
  assert.doesNotMatch(uiSource, /\{state\.status\}/);
});
