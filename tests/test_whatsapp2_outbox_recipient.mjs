import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

try {
  register("../scripts/node-esm-npm-loader.mjs", import.meta.url);
} catch {}

const { dispatchOutboxEntry } = await import("../supabase/functions/api/brain_orchestrator.ts");

const LID_CHAT_ID = "23475687654320123@lid";

function createMockDb({ conversation, identity = null }) {
  return {
    from(table) {
      if (table === "instagram_conversations") {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: conversation, error: null }),
        };
        return query;
      }

      if (table === "conversation_channel_identities") {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({ data: identity, error: null }),
        };
        return query;
      }

      throw new Error(`Tabela inesperada no teste: ${table}`);
    },
  };
}

async function dispatchWhatsApp2Message({ conversationId, conversation, identity = null }) {
  const db = createMockDb({ conversation, identity });
  const calls = [];

  const result = await dispatchOutboxEntry({
    supabase: db,
    recipientId: conversationId,
    outboxEntry: {
      id: "outbox-lid-regression",
      conversationId,
      channel: "whatsapp2",
      messageType: "text",
      content: "Oi!",
      status: "pending",
      payload: { channel: "whatsapp2" },
    },
    runtime: {
      sendWhatsApp2Delivery: async (params) => {
        calls.push(params);
        return { success: true, providerMessageId: "wam-lid-delivered" };
      },
    },
  });

  return { result, calls };
}

test("envia para um LID ativo vinculado à conversa canônica sem exigir telefone E.164", async () => {
  const { result, calls } = await dispatchWhatsApp2Message({
    conversationId: "tinder:match_lid_01",
    conversation: { channel: "tinder", contact_id: "match_lid_01" },
    identity: {
      external_identity_id: LID_CHAT_ID,
      metadata: {},
    },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].recipientId, LID_CHAT_ID);
});

test("usa o JID LID do contato em conversa WhatsApp legada sem vínculo canônico", async () => {
  const { result, calls } = await dispatchWhatsApp2Message({
    conversationId: `wa2:${LID_CHAT_ID}`,
    conversation: { channel: "whatsapp2", contact_id: LID_CHAT_ID },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].recipientId, LID_CHAT_ID);
});

test("não usa o ID de Tinder como destinatário quando não existe identidade WhatsApp vinculada", async () => {
  const { result, calls } = await dispatchWhatsApp2Message({
    conversationId: "tinder:match_without_whatsapp",
    conversation: { channel: "tinder", contact_id: "match_without_whatsapp" },
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "whatsapp2_recipient_identity_unresolved");
  assert.equal(calls.length, 0);
});

test("não trata um identificador LID inválido como endereço de envio", async () => {
  const { result, calls } = await dispatchWhatsApp2Message({
    conversationId: "tinder:match_invalid_whatsapp_identity",
    conversation: { channel: "tinder", contact_id: "match_invalid_whatsapp_identity" },
    identity: {
      external_identity_id: "opaque-contact@lid",
      metadata: {},
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "whatsapp2_recipient_identity_unresolved");
  assert.equal(calls.length, 0);
});
