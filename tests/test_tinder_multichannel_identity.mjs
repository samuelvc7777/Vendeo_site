import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeChannel,
  normalizePhoneNumber,
  isChannelTransferPermitted,
  classifyTransferOutcome,
  matchesWhatsAppIdentity,
  resolveWhatsAppChatIdForIdentity,
} from "../src/domain/entities/ChannelIdentity.ts";

import {
  resolveCanonicalConversationId,
  linkExternalChannelIdentity,
  checkPhoneCollision,
} from "../supabase/functions/api/multichannel_identity_service.ts";

test("normalização de canal suportado identifica canais válidos e rejeita desconhecidos", () => {
  assert.equal(normalizeChannel("tinder"), "tinder");
  assert.equal(normalizeChannel("TINDER "), "tinder");
  assert.equal(normalizeChannel("whatsapp2"), "whatsapp2");
  assert.equal(normalizeChannel("instagram"), "instagram");
  assert.equal(normalizeChannel("whatsapp"), "whatsapp");

  assert.equal(normalizeChannel("telegram"), null);
  assert.equal(normalizeChannel("sms"), null);
  assert.equal(normalizeChannel(""), null);
  assert.equal(normalizeChannel(null), null);
  assert.equal(normalizeChannel(undefined), null);
});

test("normalização de telefone trata números brasileiros e adiciona DDI +55 determinístico", () => {
  // Celular com 9 dígitos com DDD
  const r1 = normalizePhoneNumber("(11) 98765-4321");
  assert.notEqual(r1, null);
  assert.equal(r1.e164, "+5511987654321");
  assert.equal(r1.ddd, "11");
  assert.equal(r1.countryCode, "55");
  assert.equal(r1.nationalNumber, "11987654321");

  // Telefone com 8 dígitos com DDD
  const r2 = normalizePhoneNumber("31 3222-1234");
  assert.notEqual(r2, null);
  assert.equal(r2.e164, "+553132221234");
  assert.equal(r2.ddd, "31");

  // Número já com DDI 55
  const r3 = normalizePhoneNumber("+55 21 99999-8888");
  assert.notEqual(r3, null);
  assert.equal(r3.e164, "+5521999998888");
  assert.equal(r3.ddd, "21");

  // Rejeições de dados inválidos (não telefônicos)
  assert.equal(normalizePhoneNumber("não tenho zap"), null);
  assert.equal(normalizePhoneNumber("123"), null);
  assert.equal(normalizePhoneNumber("00 9999-9999"), null); // DDD 00 inválido
  assert.equal(normalizePhoneNumber("05 9999-9999"), null); // DDD 05 inválido
  assert.equal(normalizePhoneNumber(""), null);
  assert.equal(normalizePhoneNumber(null), null);
});

test("vínculo WhatsApp canônico resolve o ID JID exibido pelo gateway", () => {
  assert.equal(matchesWhatsAppIdentity("+5511987654321", "5511987654321@c.us"), true);
  assert.equal(matchesWhatsAppIdentity("5511987654321@c.us", "5511987654321"), true);
  assert.equal(matchesWhatsAppIdentity("5511987654321@lid", "5511987654321@lid"), true);
  assert.equal(matchesWhatsAppIdentity("+5511987654321", "999999999999@lid"), false);
  assert.equal(matchesWhatsAppIdentity("+5511987654321", "5511999998888@c.us"), false);
  assert.equal(matchesWhatsAppIdentity("short-id-1", "short-id-2"), false);
});

test("identidade E.164 resolve chat LID somente com telefone comprovado pelo gateway", () => {
  const chatIds = ["opaque-contact@lid", "5511987654321@c.us"];
  assert.equal(
    resolveWhatsAppChatIdForIdentity("+5511987654321", chatIds),
    "5511987654321@c.us",
  );
  assert.equal(
    resolveWhatsAppChatIdForIdentity("+5511987654321", ["opaque-contact@lid"], [
      { chatId: "opaque-contact@lid", phoneNumber: "+55 11 98765-4321" },
    ]),
    "opaque-contact@lid",
  );
  assert.equal(
    resolveWhatsAppChatIdForIdentity("+5511987654321", ["opaque-contact@lid"], [
      { chatId: "opaque-contact@lid", phoneNumber: "+55 11 90000-0000" },
    ]),
    null,
  );
});

test("rotas de transferência permitidas seguem a política de produto", () => {
  assert.equal(isChannelTransferPermitted("tinder", "whatsapp2"), true);
  assert.equal(isChannelTransferPermitted("instagram", "whatsapp2"), true);
  assert.equal(isChannelTransferPermitted("tinder", "tinder"), false);
  assert.equal(isChannelTransferPermitted("whatsapp2", "tinder"), false);
});

test("classificação de entrega retorna estado durável e fato semântico neutro para o Brain", () => {
  // 1. Sucesso
  const s = classifyTransferOutcome({
    success: true,
    providerMessageId: "msg_12345",
  });
  assert.equal(s.status, "confirmed");
  assert.equal(s.brainFact.event, "transfer_confirmed");

  // 2. Incerteza (timeout)
  const u = classifyTransferOutcome({
    success: false,
    isUncertain: true,
    error: "gateway_timeout_18s",
  });
  assert.equal(u.status, "uncertain");
  assert.equal(u.brainFact.event, "transfer_uncertain");

  // 3. Falha técnica confirmada (o backend NÃO declara o número inválido)
  const f = classifyTransferOutcome({
    success: false,
    isUncertain: false,
    error: "number_not_registered_on_whatsapp",
  });
  assert.equal(f.status, "failed");
  assert.equal(f.brainFact.event, "transfer_failed");
  assert.equal(f.brainFact.technicalCode, "number_not_registered_on_whatsapp");
});

test("resolveCanonicalConversationId retorna conversa canônica quando vínculo existe", async () => {
  const mockDb = {
    identities: [
      {
        id: "link-1",
        conversation_id: "conv-canon-42",
        channel: "tinder",
        external_identity_id: "match_xyz_99",
      },
    ],
    from(table) {
      assert.equal(table, "conversation_channel_identities");
      return {
        select: () => ({
          eq: (field1, val1) => ({
            eq: (field2, val2) => ({
              maybeSingle: async () => {
                const found = mockDb.identities.find(
                  (i) => i.channel === val1 && i.external_identity_id === val2
                );
                return { data: found || null, error: null };
              },
            }),
          }),
        }),
      };
    },
  };

  const resolved = await resolveCanonicalConversationId({
    supabase: mockDb,
    channel: "tinder",
    externalIdentityId: "match_xyz_99",
  });

  assert.equal(resolved.found, true);
  assert.equal(resolved.conversationId, "conv-canon-42");
  assert.equal(resolved.isLegacyFallback, false);
});

test("resolveCanonicalConversationId falha fechado no Tinder quando não consegue consultar o vínculo", async () => {
  const mockDb = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "database unavailable" } }),
            }),
          }),
        }),
      };
    },
  };

  const resolved = await resolveCanonicalConversationId({
    supabase: mockDb,
    channel: "tinder",
    externalIdentityId: "match_unavailable_1",
  });

  assert.equal(resolved.found, false);
  assert.equal(resolved.conversationId, null);
  assert.match(resolved.error, /database unavailable/);
});

test("resolveCanonicalConversationId aplica fallback legado wa2:<chatId> quando WhatsApp2 não tem vínculo", async () => {
  const mockDb = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    },
  };

  const resolved = await resolveCanonicalConversationId({
    supabase: mockDb,
    channel: "whatsapp2",
    externalIdentityId: "5511999998888@c.us",
  });

  assert.equal(resolved.found, false);
  assert.equal(resolved.conversationId, "wa2:5511999998888@c.us");
  assert.equal(resolved.isLegacyFallback, true);
});

test("resolveCanonicalConversationId não inventa fallback WhatsApp2 quando a consulta falha", async () => {
  const mockDb = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "database unavailable" } }),
            }),
          }),
        }),
      };
    },
  };

  const resolved = await resolveCanonicalConversationId({
    supabase: mockDb,
    channel: "whatsapp2",
    externalIdentityId: "5511987654321@c.us",
  });

  assert.equal(resolved.conversationId, null);
  assert.equal(resolved.isLegacyFallback, false);
  assert.match(resolved.error, /database unavailable/);
});

test("linkExternalChannelIdentity cria vínculo novo e bloqueia merge silencioso em caso de colisão", async () => {
  let dbRows = [];
  let updateCalledWith = null;

  const mockDb = {
    from(table) {
      assert.equal(table, "conversation_channel_identities");
      return {
        select: () => ({
          eq: (f1, v1) => ({
            eq: (f2, v2) => ({
              maybeSingle: async () => {
                const found = dbRows.find(
                  (r) => r.channel === v1 && r.external_identity_id === v2
                );
                return { data: found || null, error: null };
              },
            }),
          }),
        }),
        insert: async (row) => {
          dbRows.push({ ...row, id: `row-${dbRows.length + 1}` });
          return { error: null };
        },
        update: (changes) => ({
          eq: async (field, idVal) => {
            updateCalledWith = { changes, idVal };
            const idx = dbRows.findIndex((r) => r.id === idVal);
            if (idx >= 0) dbRows[idx] = { ...dbRows[idx], ...changes };
            return { error: null };
          },
        }),
      };
    },
  };

  // 1. Criação de vínculo legítimo
  const res1 = await linkExternalChannelIdentity({
    supabase: mockDb,
    conversationId: "conv-user-1",
    channel: "whatsapp2",
    externalIdentityId: "+5511988887777",
  });

  assert.equal(res1.success, true);
  assert.equal(res1.isNew, true);
  assert.equal(res1.collisionDetected, false);
  assert.equal(dbRows.length, 1);

  // 2. Vínculo repetido para a mesma conversa (idempotente)
  const res2 = await linkExternalChannelIdentity({
    supabase: mockDb,
    conversationId: "conv-user-1",
    channel: "whatsapp2",
    externalIdentityId: "+5511988887777",
  });
  assert.equal(res2.success, true);
  assert.equal(res2.isNew, false);
  assert.equal(res2.collisionDetected, false);

  // 3. Tentativa de associar o MESMO número a OUTRA conversa -> BLOQUEIO DE MERGE SILENCIOSO
  const res3 = await linkExternalChannelIdentity({
    supabase: mockDb,
    conversationId: "conv-user-2-diferente",
    channel: "whatsapp2",
    externalIdentityId: "+5511988887777",
  });

  assert.equal(res3.success, false);
  assert.equal(res3.collisionDetected, true);
  assert.equal(res3.existingConversationId, "conv-user-1");
  // O registro original permaneceu intacto como active e NÃO foi mesclado nem alterado
  assert.equal(dbRows[0].status, "active");
});

test("checkPhoneCollision encontra contato legado mesmo sem registro na tabela de identidades", async () => {
  const phone = "+5511987654321";
  const db = {
    from(table) {
      const rows = table === "conversation_channel_identities"
        ? []
        : [{ id: "wa2:5511987654321@c.us", contact_id: "5511987654321@c.us", channel: "whatsapp2" }];
      const filters = {};
      const query = {
        in(field, values) { filters[field] = values; return query; },
        eq(field, value) { filters[field] = value; return query; },
        then(resolve) {
          const data = rows.filter((row) => Object.entries(filters).every(([field, value]) =>
            Array.isArray(value) ? value.includes(row[field]) : row[field] === value
          ));
          return resolve({ data, error: null });
        },
      };
      return { select: () => query };
    },
  };

  const collision = await checkPhoneCollision({
    supabase: db,
    phoneE164: phone,
    currentConversationId: "tinder:match_123",
  });

  assert.equal(collision.hasCollision, true);
  assert.equal(collision.conflictingConversationId, "wa2:5511987654321@c.us");
});

test("checkPhoneCollision encontra conversa legada pelo ID canônico mesmo com outro contact_id", async () => {
  const db = {
    from(table) {
      const rows = table === "conversation_channel_identities"
        ? []
        : [{ id: "wa2:5511987654321@c.us", contact_id: "saved-name-alias", channel: "whatsapp2" }];
      const filters = {};
      const query = {
        in(field, values) { filters[field] = values; return query; },
        then(resolve) {
          const data = rows.filter((row) => Object.entries(filters).every(([field, value]) =>
            Array.isArray(value) ? value.includes(row[field]) : row[field] === value
          ));
          return resolve({ data, error: null });
        },
      };
      return { select: () => query };
    },
  };

  const collision = await checkPhoneCollision({
    supabase: db,
    phoneE164: "+5511987654321",
    currentConversationId: "tinder:match_123",
  });

  assert.equal(collision.hasCollision, true);
  assert.equal(collision.conflictingConversationId, "wa2:5511987654321@c.us");
});

test("checkPhoneCollision devolve erro quando não consegue concluir a consulta de identidade", async () => {
  const db = {
    from(table) {
      return {
        select: () => ({
          in: () => ({
            in: async () => ({
              data: null,
              error: table === "conversation_channel_identities"
                ? { message: "database unavailable" }
                : null,
            }),
          }),
        }),
      };
    },
  };

  const collision = await checkPhoneCollision({
    supabase: db,
    phoneE164: "+5511987654321",
    currentConversationId: "tinder:match_123",
  });

  assert.equal(collision.hasCollision, false);
  assert.match(collision.error, /database unavailable/);
});
