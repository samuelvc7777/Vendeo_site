import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  brainTurnUiReducer,
  formatBrainEvent,
  formatBrainPhase,
  formatBrainStatus,
  groupBrainTurns,
  initialBrainTurnUiState,
} from "../src/presentation/components/chat/brain-turn-view-model.ts";

const uiSource = readFileSync(new URL("../src/presentation/components/chat/AutoPilotActivityIndicator.tsx", import.meta.url), "utf8");

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
