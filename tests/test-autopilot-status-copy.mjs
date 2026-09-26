import assert from "node:assert/strict";
import test from "node:test";
import { getAutoPilotStatusCopy, hasPendingManualResponse } from "../src/domain/entities/AutoPilotStatusCopy.ts";

test("status manual sem lote pendente não aparece como alerta", () => {
  const staleState = {
    conversationId: "stale-1",
    isEnabled: false,
    status: "needs_manual_response",
    pendingManualResponse: null,
  };

  assert.equal(hasPendingManualResponse(staleState), false);
  assert.notEqual(getAutoPilotStatusCopy(staleState).title, "Aguardando sua resposta");
  assert.equal(hasPendingManualResponse({
    ...staleState,
    pendingManualResponse: {
      inboundMessage: "Você pratica esporte?",
      inboundMessageIds: ["in-1"],
      reason: "Fato pessoal não confirmado",
      createdAt: "2026-09-26T01:00:00Z",
    },
  }), true);
});

test("falha com atividade antiga não aparece como mensagem enviada", () => {
  const state = {
    conversationId: "conv-1",
    isEnabled: true,
    status: "failed",
    activity: { phase: "completed", label: "Última resposta enviada", updatedAt: "2026-09-25T17:00:00Z" },
    lastThoughts: { atriaThought: "Raciocínio antigo" },
  };

  assert.equal(getAutoPilotStatusCopy(state).title, "Falha no Brain");
});

test("raciocínio ou ciclo concluído sem confirmação não afirma envio", () => {
  const state = {
    conversationId: "conv-2",
    isEnabled: true,
    status: "idle",
    activity: { phase: "completed", label: "Última resposta enviada", updatedAt: "2026-09-25T17:00:00Z" },
    lastThoughts: { brainThought: "Plano" },
  };

  assert.equal(getAutoPilotStatusCopy(state).title, "Brain concluiu o ciclo");
  assert.match(getAutoPilotStatusCopy(state).detail, /Não há confirmação de envio/);
  assert.equal(getAutoPilotStatusCopy({ ...state, activity: null }).title, "Último raciocínio do Brain");
  assert.equal(getAutoPilotStatusCopy({ ...state, lastThoughts: { sentAt: "2026-09-25T17:00:00Z" } }).title, "Última resposta enviada");
  assert.equal(getAutoPilotStatusCopy({
    ...state,
    activity: null,
    lastThoughts: { brainThought: "Plano", sentAt: "2026-09-25T17:00:00Z" },
    lastClientMessageAt: "2026-09-25T17:01:00Z",
  }).title, "Último raciocínio do Brain");
});

test("objetivos finais aguardam revisão e finalização sem parecer falha de envio", () => {
  const state = {
    conversationId: "conv-3",
    isEnabled: false,
    status: "awaiting_finalization",
    pendingObjectiveFinalization: {
      key: "stage_final:goal-a",
      stageId: "stage_final",
      stageName: "Compatibilidade",
      completedObjectivesCount: 1,
      createdAt: "2026-09-25T17:00:00Z",
    },
    activity: { phase: "completed", label: "Objetivos concluídos", updatedAt: "2026-09-25T17:00:00Z" },
  };

  assert.deepEqual(getAutoPilotStatusCopy(state), {
    title: "Objetivos finais concluídos",
    detail: "A IA concluiu os objetivos de “Compatibilidade”. Abra o chat para revisar e finalizar.",
  });
});
