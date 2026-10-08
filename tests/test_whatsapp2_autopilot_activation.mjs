import test from "node:test";
import assert from "node:assert/strict";
import { activateWhatsApp2Autopilot } from "../src/presentation/components/chat/whatsapp2-autopilot-activation.ts";

test("mensagem visível sem histórico é persistida antes de iniciar a resposta", async () => {
  let persisted = false;
  const events = [];
  await activateWhatsApp2Autopilot("immediate", async () => {
    events.push("sync");
    await Promise.resolve();
    persisted = true;
    return { latestInbound: true, persisted };
  }, async (mode) => {
    assert.equal(persisted, true);
    events.push(mode);
  });
  assert.deepEqual(events, ["sync", "immediate"]);
});

test("resposta recente no celular impede reprocessar inbound antigo do banco", async () => {
  const modes = [];
  await activateWhatsApp2Autopilot("immediate", async () => ({ latestInbound: false, persisted: false }), async mode => { modes.push(mode); });
  assert.deepEqual(modes, ["wait_next"]);
});

test("sincronização incompleta não confirma ativação imediata", async () => {
  let activated = false;
  await assert.rejects(activateWhatsApp2Autopilot("immediate", async () => ({ latestInbound: true, persisted: false }), async () => { activated = true; }), /ainda não chegou/);
  assert.equal(activated, false);
});

test("erro de sincronização mantém a falha visível e não ativa", async () => {
  let activated = false;
  await assert.rejects(activateWhatsApp2Autopilot("immediate", async () => { throw new Error("gateway indisponível"); }, async () => { activated = true; }), /gateway indisponível/);
  assert.equal(activated, false);
});

test("aguardar próxima mensagem não importa histórico", async () => {
  const modes = [];
  await activateWhatsApp2Autopilot("wait_next", async () => { throw new Error("não deveria sincronizar"); }, async mode => { modes.push(mode); });
  assert.deepEqual(modes, ["wait_next"]);
});

test("ativa o ID canônico retornado pelo gateway após resolver alias", async () => {
  let activatedId;
  await activateWhatsApp2Autopilot("immediate", async () => ({
    latestInbound: true, persisted: true, conversationId: "wa2:account-5511:phone@c.us",
  }), async (_mode, conversationId) => { activatedId = conversationId; });
  assert.equal(activatedId, "wa2:account-5511:phone@c.us");
});
