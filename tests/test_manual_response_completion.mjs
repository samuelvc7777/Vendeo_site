import test from "node:test";
import assert from "node:assert/strict";
import {
  completeManualResponseAfterSend,
  completePendingManualReplyForEvent,
  findConfirmedReplyAfterPendingManualResponse,
} from "../src/presentation/components/chat/manual-response-completion.ts";

test("reconcilia uma revisão antiga só quando a última mensagem é resposta de texto enviada", () => {
  const pending = { inboundMessageIds: ["in-1"], createdAt: "2026-09-25T10:00:00.000Z" };
  const inbound = { id: "in-1", is_mine: false, status: "sent", timestamp: "2026-09-25T10:00:00.000Z", text: "Pergunta" };
  assert.equal(findConfirmedReplyAfterPendingManualResponse(pending, [
    { ...inbound, timestamp: "2026-09-25T10:10:00.000Z" },
    { id: "out-1", is_mine: true, status: "sent", timestamp: "2026-09-25T10:05:00.000Z", text: "Resposta" },
  ]), null);
  assert.equal(findConfirmedReplyAfterPendingManualResponse(pending, [
    inbound,
    { id: "out-1", is_mine: true, status: "sending", timestamp: "2026-09-25T10:05:00.000Z", text: "Resposta" },
  ]), null);
  assert.equal(findConfirmedReplyAfterPendingManualResponse(pending, [
    inbound,
    { id: "out-1", is_mine: true, status: "sent", timestamp: "2026-09-25T10:05:00.000Z", text: "Resposta" },
  ])?.id, "out-1");
});

test("conclui a revisão quando a resposta enfileirada chega como enviada", async () => {
  let completed = 0;
  const deliveries = new Map([[
    "chat-1:queued-1",
    { conversationId: "chat-1", messageId: "queued-1", pending: { inboundMessageIds: ["in-1"] }, responseText: "Resposta", complete: async () => { completed += 1; } },
  ]]);
  assert.equal(await completePendingManualReplyForEvent(deliveries, {
    conversationId: "chat-1", id: "final-1", oldId: "queued-1", status: "sent",
  }), true);
  assert.equal(completed, 1);
  assert.equal(deliveries.size, 0);
});

test("mantém revisão enquanto resposta enfileirada falha ou pertence a outro chat", async () => {
  let completed = 0;
  const deliveries = new Map([[
    "chat-1:queued-1",
    { conversationId: "chat-1", messageId: "queued-1", pending: { inboundMessageIds: ["in-1"] }, responseText: "Resposta", complete: async () => { completed += 1; } },
  ]]);
  assert.equal(await completePendingManualReplyForEvent(deliveries, {
    conversationId: "chat-1", id: "final-1", oldId: "queued-1", status: "failed",
  }), false);
  assert.equal(await completePendingManualReplyForEvent(deliveries, {
    conversationId: "chat-2", id: "final-1", oldId: "queued-1", status: "sent",
  }), false);
  assert.equal(completed, 0);
  assert.equal(deliveries.size, 1);
});

test("preserva a entrega para nova tentativa se a limpeza do estado falhar", async () => {
  const deliveries = new Map([[
    "chat-1:queued-1",
    { conversationId: "chat-1", messageId: "queued-1", pending: { inboundMessageIds: ["in-1"] }, responseText: "Resposta", complete: async () => { throw new Error("falha de persistência"); } },
  ]]);
  await assert.rejects(() => completePendingManualReplyForEvent(deliveries, {
    conversationId: "chat-1", id: "final-1", oldId: "queued-1", status: "sent",
  }));
  assert.equal(deliveries.size, 1);
});

test("qualquer envio confirmado no chat salva memória e encerra a pendência manual", async () => {
  const calls = [];
  const result = await completeManualResponseAfterSend({
    deliveryStatus: "sent",
    responseText: "  Sim, já fui!  ",
    pending: { inboundMessageIds: ["in-1"], source: "uncertain_response" },
    saveMemory: async (pending, response) => {
      calls.push(["memory", pending.inboundMessageIds, response]);
      return true;
    },
    clearPending: async () => calls.push(["clear"]),
  });

  assert.equal(result, "resolved");
  assert.deepEqual(calls, [["memory", ["in-1"], "Sim, já fui!"], ["clear"]]);
});

test("não limpa a pendência antes de a mensagem ser enviada", async () => {
  let clearCount = 0;
  let memoryCount = 0;
  const pending = { inboundMessageIds: ["in-1"] };
  for (const deliveryStatus of ["sending", "failed"]) {
    const result = await completeManualResponseAfterSend({
      deliveryStatus,
      responseText: "Resposta",
      pending,
      saveMemory: async () => { memoryCount += 1; return true; },
      clearPending: async () => { clearCount += 1; },
    });
    assert.equal(result, null);
  }
  assert.equal(memoryCount, 0);
  assert.equal(clearCount, 0);
});

test("falha da memória não deixa a IA presa aguardando o modal", async () => {
  let cleared = false;
  const result = await completeManualResponseAfterSend({
    deliveryStatus: "sent",
    responseText: "Resposta manual",
    pending: { inboundMessageIds: ["in-1"] },
    saveMemory: async () => false,
    clearPending: async () => { cleared = true; },
  });

  assert.equal(result, "memory_failed");
  assert.equal(cleared, true);
});
