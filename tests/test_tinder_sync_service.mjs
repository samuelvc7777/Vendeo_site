import test from "node:test";
import assert from "node:assert/strict";

import { syncTinderMatchMessages } from "../supabase/functions/api/tinder_sync_service.ts";

function createMockSupabase(options = {}) {
  const conversations = [];
  const identities = [];
  const messages = [];

  return {
    conversations,
    identities,
    messages,
    from(table) {
      if (table === "conversation_channel_identities") {
        return {
          select: () => ({
            eq: (f1, v1) => ({
              eq: (f2, v2) => ({
                maybeSingle: async () => {
                  const found = identities.find(
                    (i) => i.channel === v1 && i.external_identity_id === v2
                  );
                  return { data: found || null, error: null };
                },
              }),
            }),
          }),
          insert: async (row) => {
            if (options.identityInsertError) return { error: options.identityInsertError };
            identities.push({ ...row, id: `id_${identities.length + 1}` });
            return { error: null };
          },
          update: (changes) => ({
            eq: async (f, idVal) => {
              const idx = identities.findIndex((i) => i.id === idVal);
              if (idx >= 0) Object.assign(identities[idx], changes);
              return { error: null };
            },
          }),
        };
      }

      if (table === "instagram_conversations") {
        return {
          select: () => ({
            eq: (field, idVal) => ({
              maybeSingle: async () => {
                const found = conversations.find((c) => c.id === idVal);
                return { data: found || null, error: null };
              },
            }),
          }),
          upsert: async (row, upsertOptions) => {
            assert.equal(upsertOptions.onConflict, "id");
            assert.equal(upsertOptions.ignoreDuplicates, true);
            if (!conversations.some((conversation) => conversation.id === row.id)) {
              conversations.push(row);
            }
            return { error: null };
          },
          update: (changes) => ({
            eq: async (field, idVal) => {
              const found = conversations.find((c) => c.id === idVal);
              if (found) Object.assign(found, changes);
              return { error: null };
            },
          }),
        };
      }

      if (table === "instagram_messages") {
        return {
          select: () => ({
            in: async (field, idList) => {
              if (options.messageSelectError) {
                return { data: null, error: options.messageSelectError };
              }
              const matches = messages.filter((m) => idList.includes(m.id));
              return { data: matches, error: null };
            },
          }),
          upsert: (rows, upsertOptions) => {
            assert.equal(upsertOptions.onConflict, "id");
            assert.equal(upsertOptions.ignoreDuplicates, true);
            const arr = Array.isArray(rows) ? rows : [rows];
            const inserted = [];
            for (const row of arr) {
              if (messages.some((existing) => existing.id === row.id)) continue;
              messages.push(row);
              inserted.push(row);
            }
            return {
              select: async () => ({ data: inserted.map(({ id }) => ({ id })), error: null }),
            };
          },
          insert: async (rows) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            messages.push(...arr);
            return { error: null };
          },
        };
      }

      throw new Error(`Tabela mock inesperada: ${table}`);
    },
  };
}

test("syncTinderMatchMessages cria conversa, vínculo canônico e persiste mensagens novas", async () => {
  const supabase = createMockSupabase();

  const res1 = await syncTinderMatchMessages({
    supabase,
    matchId: "match_carol_123",
    matchName: "Carol",
    rawMessages: [
      { id: "msg_tinder_1", text: "Oi linda!", isMine: false, sentAt: "2026-10-06T12:00:00Z" },
      { id: "msg_tinder_2", text: "Oii tudo bem?", isMine: true, sentAt: "2026-10-06T12:01:00Z" },
    ],
    autoPilotEnabled: true,
  });

  assert.equal(res1.success, true);
  assert.equal(res1.conversationId, "tinder:match_carol_123");
  assert.equal(res1.newMessagesCount, 2);
  assert.equal(res1.newInboundCount, 1);
  assert.deepEqual(res1.newInboundMessageIds, ["tinder_msg_msg_tinder_1"]);

  // Conversa criada com canal tinder e AutoPilot ativado
  assert.equal(supabase.conversations.length, 1);
  assert.equal(supabase.conversations[0].channel, "tinder");
  assert.equal(supabase.conversations[0].ai_auto_respond, true);

  // Vínculo multi-canal criado
  assert.equal(supabase.identities.length, 1);
  assert.equal(supabase.identities[0].channel, "tinder");
  assert.equal(supabase.identities[0].external_identity_id, "match_carol_123");
});

test("syncTinderMatchMessages aplica deduplicação estrita em chamadas subsequentes", async () => {
  const supabase = createMockSupabase();

  // Primeira rodada
  await syncTinderMatchMessages({
    supabase,
    matchId: "match_pedro_456",
    rawMessages: [
      { id: "msg_p_1", text: "E aí!", isMine: false },
    ],
  });
  assert.equal(supabase.messages.length, 1);

  // Segunda rodada: mesma mensagem + 1 nova
  const res2 = await syncTinderMatchMessages({
    supabase,
    matchId: "match_pedro_456",
    rawMessages: [
      { id: "msg_p_1", text: "E aí!", isMine: false },
      { id: "msg_p_2", text: "Você é de onde?", isMine: false },
    ],
  });

  assert.equal(res2.success, true);
  assert.equal(res2.newMessagesCount, 1); // Somente a nova foi inserida
  assert.equal(res2.newInboundCount, 1);
  assert.equal(supabase.messages.length, 2);
});

test("syncTinderMatchMessages trata a corrida entre sync manual e background sem inserir/enfileirar duplicata", async () => {
  const supabase = createMockSupabase();
  supabase.conversations.push({
    id: "tinder:match_race_789",
    channel: "tinder",
    ai_auto_respond: true,
  });
  supabase.identities.push({
    id: "identity_race_789",
    conversation_id: "tinder:match_race_789",
    channel: "tinder",
    external_identity_id: "match_race_789",
  });

  const input = {
    supabase,
    matchId: "match_race_789",
    rawMessages: [
      { id: "provider_race_1", text: "Oi", isMine: false, sentAt: "2026-10-06T12:00:00Z" },
    ],
  };
  const [manual, background] = await Promise.all([
    syncTinderMatchMessages(input),
    syncTinderMatchMessages(input),
  ]);

  assert.equal(manual.success, true);
  assert.equal(background.success, true);
  assert.deepEqual(
    [manual.newInboundCount, background.newInboundCount].sort(),
    [0, 1],
  );
  assert.equal(supabase.messages.length, 1);
});

test("syncTinderMatchMessages falha fechado quando a consulta de deduplicação falha", async () => {
  const supabase = createMockSupabase({
    messageSelectError: { message: "temporarily unavailable" },
  });

  const result = await syncTinderMatchMessages({
    supabase,
    matchId: "match_error_321",
    rawMessages: [
      { id: "provider_error_1", text: "Oi", isMine: false },
    ],
  });

  assert.equal(result.success, false);
  assert.match(result.error, /temporarily unavailable/);
  assert.equal(supabase.messages.length, 0);
});

test("syncTinderMatchMessages não cria histórico dividido se falhar o vínculo canônico", async () => {
  const supabase = createMockSupabase({
    identityInsertError: { message: "unique constraint conflict" },
  });

  const result = await syncTinderMatchMessages({
    supabase,
    matchId: "match_identity_conflict_1",
    rawMessages: [
      { id: "provider_identity_conflict_1", text: "Oi", isMine: false },
    ],
  });

  assert.equal(result.success, false);
  assert.match(result.error, /vincular a identidade Tinder/);
  assert.equal(supabase.messages.length, 0);
});
