import test from "node:test";
import assert from "node:assert/strict";

import { executeChannelTransfer } from "../supabase/functions/api/channel_transfer_service.ts";
import { validateConversationBrainPlan } from "../supabase/functions/api/openai_brain.ts";

function createMockSupabase(initialState = {}) {
  const identities = initialState.identities || [];
  const transfers = [];
  const conversations = initialState.conversations || [];

  return {
    identities,
    transfers,
    from(table) {
      if (table === "conversation_channel_identities") {
        return {
          select: () => {
            const filters = { channels: null, externalIds: null, eqChannel: null, eqExternalId: null };
            const queryObj = {
              eq: (f, v) => {
                if (f === "channel") filters.eqChannel = v;
                if (f === "external_identity_id") filters.eqExternalId = v;
                return queryObj;
              },
              in: (f, values) => {
                if (f === "channel") filters.channels = values;
                if (f === "external_identity_id") filters.externalIds = values;
                return queryObj;
              },
              maybeSingle: async () => {
                const found = identities.find((i) => {
                  if (filters.eqChannel && i.channel !== filters.eqChannel) return false;
                  if (filters.eqExternalId && i.external_identity_id !== filters.eqExternalId) return false;
                  return true;
                });
                return { data: found || null, error: null };
              },
              then: (resolve) => {
                const filtered = identities.filter((i) => {
                  if (filters.channels && !filters.channels.includes(i.channel)) return false;
                  if (filters.externalIds && !filters.externalIds.includes(i.external_identity_id)) return false;
                  return true;
                });
                return resolve({ data: filtered, error: initialState.collisionReadError || null });
              },
              limit: async () => {
                const filtered = identities.filter((i) => {
                  if (filters.channels && !filters.channels.includes(i.channel)) return false;
                  if (filters.externalIds && !filters.externalIds.includes(i.external_identity_id)) return false;
                  return true;
                });
                return { data: filtered, error: null };
              },
            };
            return queryObj;
          },
          insert: async (row) => {
            identities.push({ ...row, id: `ident_${identities.length + 1}` });
            return { error: null };
          },
          update: (changes) => ({
            eq: async (f, idVal) => {
              const idx = identities.findIndex((i) => i.id === idVal);
              if (idx >= 0) identities[idx] = { ...identities[idx], ...changes };
              return { error: null };
            },
          }),
        };
      }

      if (table === "conversation_channel_transfers") {
        return {
          select: () => ({
            eq: (field, key) => ({
              maybeSingle: async () => {
                const found = transfers.find((t) => t.idempotency_key === key);
                return { data: found || null, error: null };
              },
            }),
          }),
          upsert: async (row) => {
            const idx = transfers.findIndex((t) => t.idempotency_key === row.idempotency_key);
            if (idx >= 0) transfers[idx] = { ...transfers[idx], ...row };
            else transfers.push(row);
            return { error: null };
          },
          insert: async (row) => {
            transfers.push(row);
            return { error: null };
          },
          update: (changes) => ({
            eq: async (field, key) => {
              const item = transfers.find((t) => t.idempotency_key === key);
              if (item) Object.assign(item, changes);
              return { error: null };
            },
          }),
        };
      }

      if (table === "instagram_conversations") {
        return {
          select: () => {
            const filters = {};
            const query = {
              in(field, values) { filters[field] = values; return query; },
              then(resolve) {
                const data = conversations.filter((row) => Object.entries(filters).every(([field, value]) =>
                  Array.isArray(value) ? value.includes(row[field]) : row[field] === value
                ));
                return resolve({ data, error: null });
              },
            };
            return query;
          },
        };
      }

      throw new Error(`Tabela mock inesperada: ${table}`);
    },
  };
}

test("transferência bem-sucedida associa canal WhatsApp à conversa sem alterar conversation_id", async () => {
  const supabase = createMockSupabase();

  const result = await executeChannelTransfer({
    supabase,
    conversationId: "tinder_canonical_conv_001",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "(11) 97777-6666",
    initialMessageText: "Oi amor! Sou eu do Tinder rs, salvei seu número aqui!",
    mockGateway: async () => ({
      success: true,
      providerMessageId: "wam_abc_123",
      contactSaveStatus: "saved",
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.status, "confirmed");
  assert.equal(result.providerMessageId, "wam_abc_123");
  assert.equal(result.brainFact.event, "transfer_confirmed");

  // Verifica que a identidade foi vinculada mantendo a MESMA conversa canônica
  const linked = supabase.identities.find(
    (i) => i.channel === "whatsapp2" && i.external_identity_id === "+5511977776666"
  );
  assert.notEqual(linked, undefined);
  assert.equal(linked.conversation_id, "tinder_canonical_conv_001");
});

test("transferência Tinder envia E.164 ao gateway e solicita salvar o contato após a entrega", async () => {
  const supabase = createMockSupabase();
  let deliveryParams = null;

  const result = await executeChannelTransfer({
    supabase,
    conversationId: "tinder_canonical_conv_contact_save",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "+55 (11) 97777-6666",
    initialMessageText: "Oi, sou eu do Tinder.",
    recipientContactName: "Amanda Souza",
    whatsapp2Delivery: async (params) => {
      deliveryParams = params;
      return {
        success: true,
        providerMessageId: "wam_contact_save_001",
        contactSaveStatus: "saved",
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.contactSaveStatus, "saved");
  assert.equal(deliveryParams.recipientId, "+5511977776666");
  assert.equal(deliveryParams.saveRecipientContact, true);
  assert.equal(deliveryParams.recipientContactName, "Amanda Souza");
});

test("falha ao salvar a agenda não reclassifica como falha uma mensagem já entregue", async () => {
  const supabase = createMockSupabase();

  const result = await executeChannelTransfer({
    supabase,
    conversationId: "tinder_canonical_conv_contact_save_failed",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "+55 11 97777-6666",
    initialMessageText: "Oi, sou eu do Tinder.",
    recipientContactName: "Amanda Souza",
    whatsapp2Delivery: async () => ({
      success: true,
      providerMessageId: "wam_contact_save_failed_001",
      contactSaveStatus: "failed",
      contactSaveError: "whatsapp2_address_book_api_unavailable",
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.status, "confirmed");
  assert.equal(result.contactSaveStatus, "failed");
  assert.equal(result.providerMessageId, "wam_contact_save_failed_001");
  assert.equal(supabase.transfers[0].status, "confirmed");
  assert.equal(supabase.transfers[0].metadata.recipientContactSaveStatus, "failed");
});

test("falha confirmada na entrega devolve fato técnico ao Brain sem inventar texto no backend", async () => {
  const supabase = createMockSupabase();

  const result = await executeChannelTransfer({
    supabase,
    conversationId: "tinder_canonical_conv_002",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "11 98888-0000",
    initialMessageText: "Oi, vim do Tinder!",
    mockGateway: async () => ({
      success: false,
      isUncertain: false,
      error: "recipient_not_registered_on_whatsapp",
    }),
  });

  assert.equal(result.success, false);
  assert.equal(result.status, "failed");
  assert.equal(result.brainFact.event, "transfer_failed");
  assert.equal(result.brainFact.technicalCode, "recipient_not_registered_on_whatsapp");
  assert.equal(result.brainFact.rawInput, "11 98888-0000");

  // Não vincula identidade em falha
  const linked = supabase.identities.find((i) => i.external_identity_id === "+5511988880000");
  assert.equal(linked, undefined);
});

test("entrega incerta (timeout do gateway) trava retry cego e devolve fato transfer_uncertain", async () => {
  const supabase = createMockSupabase();

  const result = await executeChannelTransfer({
    supabase,
    conversationId: "tinder_canonical_conv_003",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "21 99999-5555",
    initialMessageText: "Oi!",
    mockGateway: async () => ({
      success: false,
      isUncertain: true,
      error: "gateway_request_timeout_18s",
    }),
  });

  assert.equal(result.success, false);
  assert.equal(result.status, "uncertain");
  assert.equal(result.brainFact.event, "transfer_uncertain");
  assert.equal(result.brainFact.technicalCode, "gateway_timeout_or_pending_ack");
});

test("número não estruturável falha imediatamente com código técnico determinístico", async () => {
  const supabase = createMockSupabase();

  const result = await executeChannelTransfer({
    supabase,
    conversationId: "tinder_canonical_conv_004",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "depois te passo rs",
    initialMessageText: "Oi!",
    mockGateway: async () => {
      throw new Error("Não deve chamar o gateway");
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.status, "failed");
  assert.equal(result.brainFact.technicalCode, "phone_format_unparseable");
  assert.equal(result.brainFact.rawInput, "depois te passo rs");
});

test("colisão de telefone com contato de outra conversa bloqueia merge e retorna erro seguro", async () => {
  const supabase = createMockSupabase({
    identities: [
      {
        id: "id_existing",
        conversation_id: "outra_conversa_existente",
        channel: "whatsapp2",
        external_identity_id: "+5511999991111",
      },
    ],
  });

  const result = await executeChannelTransfer({
    supabase,
    conversationId: "tinder_canonical_conv_005",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "11 99999-1111",
    initialMessageText: "Oi!",
    mockGateway: async () => {
      throw new Error("Não deve chamar o gateway");
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.status, "failed");
  assert.equal(result.brainFact.technicalCode, "phone_collision_existing_contact");
});

test("validateConversationBrainPlan valida canal explícito e ações de transferência de canal", () => {
  function makePlan(outboundActions) {
    return {
      action: "reply",
      objectiveDecision: "none",
      responses: outboundActions.filter((action) => action.type === "text").map((action) => action.text),
      outboundActions,
      turnContract: {
        mustAnswerFirst: true,
        newQuestionBudget: 1,
        responseShape: "natural",
        directQuestions: [],
      },
    };
  }

  // 1. Ação válida com canal Tinder
  const plan1 = makePlan([
    { type: "text", text: "Oi amor!", delay_before_send: 5, channel: "tinder" },
  ]);
  const val1 = validateConversationBrainPlan(plan1);
  assert.equal(val1.valid, true);

  // 2. Ação com canal inválido
  const plan2 = makePlan([
    { type: "text", text: "Oi!", delay_before_send: 5, channel: "orkut" },
  ]);
  const val2 = validateConversationBrainPlan(plan2);
  assert.equal(val2.valid, false);
  assert.match(val2.error, /canal inválido/);

  // 3. Ação de transferência válida
  const plan3 = makePlan([
    {
      type: "transfer_channel",
      targetPhone: "(11) 98888-7777",
      initialText: "Oi amor! Salvei você aqui no whats!",
      delay_before_send: 0,
    },
  ]);
  const val3 = validateConversationBrainPlan(plan3);
  assert.equal(val3.valid, true);

  // 4. Ação de transferência incompleta
  const plan4 = makePlan([
    {
      type: "transfer_channel",
      targetPhone: "",
      initialText: "Oi!",
      delay_before_send: 0,
    },
  ]);
  const val4 = validateConversationBrainPlan(plan4);
  assert.equal(val4.valid, false);
  assert.match(val4.error, /targetPhone/);

  const wrongTransferTarget = makePlan([
    {
      type: "transfer_channel",
      targetPhone: "+5511988887777",
      initialText: "Vamos conversar por lá.",
      channel: "tinder",
      delay_before_send: 0,
    },
  ]);
  const wrongTargetValidation = validateConversationBrainPlan(wrongTransferTarget);
  assert.equal(wrongTargetValidation.valid, false);
  assert.match(wrongTargetValidation.error, /destino.*whatsapp2/i);
});

test("transferência não envia quando a consulta de colisão falha", async () => {
  let gatewayCalls = 0;
  const supabase = createMockSupabase({
    collisionReadError: { message: "database unavailable" },
  });

  const result = await executeChannelTransfer({
    supabase,
    conversationId: "tinder:match_123",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "+5511987654321",
    initialMessageText: "Oi, vamos continuar pelo WhatsApp.",
    mockGateway: async () => {
      gatewayCalls++;
      return { success: true };
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.brainFact.technicalCode, "phone_collision_check_unavailable");
  assert.equal(gatewayCalls, 0);
  assert.equal(supabase.transfers.length, 0);
});

test("serviço bloqueia qualquer transferência fora dos pares autorizados antes de acessar o banco", async () => {
  let databaseReads = 0;
  const result = await executeChannelTransfer({
    supabase: {
      from() {
        databaseReads++;
        throw new Error("nenhuma consulta deveria acontecer");
      },
    },
    conversationId: "tinder:match_123",
    sourceChannel: "tinder",
    targetChannel: "instagram",
    targetPhoneRaw: "+5511987654321",
    initialMessageText: "Oi.",
    mockGateway: async () => { throw new Error("nenhum envio deveria acontecer"); },
  });

  assert.equal(result.success, false);
  assert.equal(result.brainFact.technicalCode, "transfer_channel_pair_not_permitted");
  assert.equal(databaseReads, 0);
});
