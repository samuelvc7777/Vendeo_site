import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../../scripts/node-esm-npm-loader.mjs", import.meta.url);

const { activateTinderAutopilot } = await import(
  "./tinder-autopilot-activation.ts"
);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("responder imediatamente reinicia o runtime e enfileira a última mensagem sem resposta", async () => {
  const calls = [];
  const result = await activateTinderAutopilot(async (path, init) => {
    calls.push({ path, body: JSON.parse(init.body) });
    return response({
      success: true,
      isEnabled: true,
      retryMessageId: "inbound-123",
      queued: true,
    });
  }, "immediate", "tinder:match-123");

  assert.deepEqual(calls, [{
    path: "/api/autopilot/restart-chat",
    body: { conversationId: "tinder:match-123" },
  }]);
  assert.equal(result.immediateTriggered, true);
});

test("responder imediatamente sem mensagem pendente informa que deve aguardar a próxima", async () => {
  const result = await activateTinderAutopilot(async () => response({
    success: true,
    isEnabled: true,
    retryMessageId: null,
    queued: false,
  }), "immediate", "tinder:match-123");

  assert.equal(result.immediateTriggered, false);
});

test("modo aguardar próxima mensagem ativa o AutoPilot sem reiniciar a memória", async () => {
  const calls = [];
  await activateTinderAutopilot(async (path, init) => {
    calls.push({ path, body: JSON.parse(init.body) });
    return response({ success: true, isEnabled: true });
  }, "wait_next", "tinder:match-123");

  assert.deepEqual(calls, [{
    path: "/api/autopilot/toggle-chat",
    body: {
      conversationId: "tinder:match-123",
      isEnabled: true,
      mode: "wait_next",
      triggerImmediate: false,
    },
  }]);
});

test("falha ao enfileirar a mensagem pendente é mostrada como erro", async () => {
  await assert.rejects(
    () => activateTinderAutopilot(async () => response({
      success: true,
      isEnabled: true,
      retryMessageId: "inbound-123",
      queued: false,
      queueReason: "worker_unavailable",
    }), "immediate", "tinder:match-123"),
    /worker_unavailable/,
  );
});
