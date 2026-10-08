import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

try {
  register("../scripts/node-esm-npm-loader.mjs", import.meta.url);
} catch {}

const { dispatchOutboxEntry } = await import("../supabase/functions/api/brain_orchestrator.ts");
const { executeChannelTransfer } = await import("../supabase/functions/api/channel_transfer_service.ts");
const {
  queueTransferBrainReentry,
  loadPendingTransferBrainEvents,
} = await import("../supabase/functions/api/channel_transfer_reentry.ts");
const {
  resolveCanonicalConversationId,
  linkExternalChannelIdentity,
} = await import("../supabase/functions/api/multichannel_identity_service.ts");

/**
 * Cria banco simulado em memória completo para os cenários ponta-a-ponta de transferência multicanal.
 */
function createScenariosMockDb(initialData = {}) {
  const conversations = initialData.conversations || [];
  const messages = initialData.messages || [];
  const identities = initialData.identities || [];
  const transfers = initialData.transfers || [];
  const queueCalls = [];

  let failNextTransferUpdate = false;

  return {
    _state: { conversations, messages, identities, transfers, queueCalls },
    setFailNextTransferUpdate(val) {
      failNextTransferUpdate = val;
    },
    async rpc(name, args) {
      if (name === "link_conversation_channel_identity_atomic") {
        const existing = identities.find(
          (i) => i.channel === args.p_channel && i.external_identity_id === args.p_external_identity_id
        );
        if (existing) {
          if (existing.conversation_id === args.p_conversation_id) {
            return { data: { success: true, is_new: false, collision: false }, error: null };
          }
          return { data: { success: false, is_new: false, collision: true, conflicting_conversation_id: existing.conversation_id }, error: null };
        }
        identities.push({
          id: `ident_${identities.length + 1}`,
          conversation_id: args.p_conversation_id,
          channel: args.p_channel,
          external_identity_id: args.p_external_identity_id,
          status: args.p_status || "active",
          metadata: args.p_metadata || {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return { data: { success: true, is_new: true, collision: false }, error: null };
      }

      if (name === "enqueue_autopilot_inbound_job") {
        queueCalls.push({ name, args });
        return { data: { success: true, status: "pending" }, error: null };
      }

      return { data: null, error: { message: `RPC mock inesperada: ${name}` } };
    },
    from(table) {
      if (table === "instagram_conversations") {
        return {
          select: () => {
            const filters = { eq: {}, in: {} };
            const q = {
              eq: (f, v) => {
                filters.eq[f] = v;
                return q;
              },
              in: (f, values) => {
                filters.in[f] = values;
                return q;
              },
              maybeSingle: async () => {
                const found = conversations.find((c) =>
                  Object.entries(filters.eq).every(([k, val]) => c[k] === val) &&
                  Object.entries(filters.in).every(([k, values]) => values.includes(c[k]))
                );
                return { data: found || null, error: null };
              },
              then: (resolve) => {
                const filtered = conversations.filter((c) =>
                  Object.entries(filters.eq).every(([k, val]) => c[k] === val) &&
                  Object.entries(filters.in).every(([k, values]) => values.includes(c[k]))
                );
                return resolve({ data: filtered, error: null });
              },
            };
            return q;
          },
          upsert: async (row, options) => {
            const idx = conversations.findIndex((c) => c.id === row.id);
            if (idx >= 0) {
              if (!options?.ignoreDuplicates) {
                conversations[idx] = { ...conversations[idx], ...row };
              }
            } else {
              conversations.push({ ...row });
            }
            return { error: null };
          },
          update: (changes) => ({
            eq: async (field, idVal) => {
              const item = conversations.find((c) => c[field] === idVal);
              if (item) Object.assign(item, changes);
              return { error: null };
            },
          }),
        };
      }

      if (table === "instagram_messages") {
        return {
          select: () => {
            const filters = {};
            let orderBy = null;
            let ascending = true;
            let limitVal = null;
            const q = {
              eq: (field, val) => {
                filters[field] = val;
                return q;
              },
              order: (field, opts = {}) => {
                orderBy = field;
                ascending = opts.ascending !== false;
                return q;
              },
              limit: (val) => {
                limitVal = val;
                return q;
              },
              range: async (start, end) => {
                const filtered = messages.filter((m) =>
                  Object.entries(filters).every(([k, val]) => m[k] === val)
                );
                return { data: filtered.slice(start, end + 1), error: null };
              },
              maybeSingle: async () => {
                let filtered = messages.filter((m) =>
                  Object.entries(filters).every(([k, val]) => m[k] === val)
                );
                if (orderBy) {
                  filtered.sort((a, b) => {
                    const av = Date.parse(String(a[orderBy] || ""));
                    const bv = Date.parse(String(b[orderBy] || ""));
                    return ascending ? av - bv : bv - av;
                  });
                }
                return { data: filtered[0] || null, error: null };
              },
              then: (resolve) => {
                let filtered = messages.filter((m) =>
                  Object.entries(filters).every(([k, val]) => m[k] === val)
                );
                if (orderBy) {
                  filtered.sort((a, b) => {
                    const av = Date.parse(String(a[orderBy] || ""));
                    const bv = Date.parse(String(b[orderBy] || ""));
                    return ascending ? av - bv : bv - av;
                  });
                }
                if (limitVal !== null) {
                  filtered = filtered.slice(0, limitVal);
                }
                return resolve({ data: filtered, error: null });
              },
            };
            return q;
          },
          insert: async (rows) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            messages.push(...arr);
            return { error: null };
          },
          upsert: (rows) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            for (const r of arr) {
              const idx = messages.findIndex((m) => m.id === r.id);
              if (idx >= 0) messages[idx] = { ...messages[idx], ...r };
              else messages.push(r);
            }
            return { error: null };
          },
        };
      }

      if (table === "conversation_channel_identities") {
        return {
          select: () => {
            const filters = { eqFilters: {}, inFilters: {} };
            const queryObj = {
              eq: (f, v) => {
                filters.eqFilters[f] = v;
                return queryObj;
              },
              in: (f, values) => {
                filters.inFilters[f] = values;
                return queryObj;
              },
              order: () => queryObj,
              limit: () => queryObj,
              maybeSingle: async () => {
                const found = identities.find((i) => {
                  for (const [f, v] of Object.entries(filters.eqFilters)) {
                    if (i[f] !== v) return false;
                  }
                  for (const [f, vals] of Object.entries(filters.inFilters)) {
                    if (!vals.includes(i[f])) return false;
                  }
                  return true;
                });
                return { data: found || null, error: null };
              },
              then: (resolve) => {
                const matched = identities.filter((i) => {
                  for (const [f, v] of Object.entries(filters.eqFilters)) {
                    if (i[f] !== v) return false;
                  }
                  for (const [f, vals] of Object.entries(filters.inFilters)) {
                    if (!vals.includes(i[f])) return false;
                  }
                  return true;
                });
                return resolve({ data: matched, error: null });
              },
            };
            return queryObj;
          },
          insert: async (row) => {
            identities.push({
              ...row,
              id: `ident_${identities.length + 1}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            return { error: null };
          },
        };
      }

      if (table === "conversation_channel_transfers") {
        const createQuery = (mode, changes = {}, insertRow = null) => {
          const filters = [];
          let orderBy = null;
          let ascending = true;
          let limit = null;
          let result;
          const matches = (row) => filters.every(({ op, field, value }) => {
            if (op === "eq") return row[field] === value;
            if (op === "in") return value.includes(row[field]);
            if (op === "lt") return Date.parse(String(row[field] || "")) < Date.parse(String(value));
            return true;
          });
          const execute = () => {
            if (result) return result;
            if (mode === "update" && failNextTransferUpdate) {
              failNextTransferUpdate = false;
              result = { data: [], error: { message: "Simulated database connection failure during status update" } };
              return result;
            }
            if (mode === "insert") {
              const row = { ...insertRow, id: `transfer_${transfers.length + 1}` };
              transfers.push(row);
              result = { data: [row], error: null };
              return result;
            }
            const selected = transfers.filter(matches);
            if (orderBy) selected.sort((a, b) => {
              const av = Date.parse(String(a[orderBy] || ""));
              const bv = Date.parse(String(b[orderBy] || ""));
              return (ascending ? av - bv : bv - av);
            });
            const limited = limit === null ? selected : selected.slice(0, limit);
            if (mode === "update") {
              for (const row of limited) Object.assign(row, changes);
            }
            result = { data: limited, error: null };
            return result;
          };
          const q = {
            eq(field, value) { filters.push({ op: "eq", field, value }); return q; },
            in(field, value) { filters.push({ op: "in", field, value }); return q; },
            lt(field, value) { filters.push({ op: "lt", field, value }); return q; },
            order(field, options = {}) { orderBy = field; ascending = options.ascending !== false; return q; },
            limit(value) { limit = value; return q; },
            select() { return q; },
            maybeSingle: async () => ({ data: execute().data[0] || null, error: null }),
            single: async () => ({ data: execute().data[0] || null, error: null }),
            then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
          };
          return q;
        };

        return {
          select: () => createQuery("select"),
          upsert: async (row) => {
            const idx = transfers.findIndex((t) => t.idempotency_key === row.idempotency_key);
            if (idx >= 0) transfers[idx] = { ...transfers[idx], ...row };
            else transfers.push({ ...row, id: `transfer_${transfers.length + 1}` });
            return { error: null };
          },
          insert: (row) => createQuery("insert", {}, row),
          update: (changes) => createQuery("update", changes),
        };
      }

      throw new Error(`Tabela mock não configurada: ${table}`);
    },
  };
}

// ====================================================================================
// CENÁRIO 1: Sucesso na transferência Tinder -> WhatsApp com persistência e resolução
// ====================================================================================
test("Cenário 1: Sucesso na transferência Tinder -> WhatsApp associa identidade e preserva conversa canônica", async () => {
  const db = createScenariosMockDb({
    conversations: [
      {
        id: "tinder:match_pedro_01",
        contact_id: "match_pedro_01",
        channel: "tinder",
        full_name: "Pedro Tinder",
        status: "active",
        ai_auto_respond: true,
      },
    ],
  });

  let gatewayCalledWith = null;

  const outboxEntry = {
    id: "out_transfer_scen_01",
    conversationId: "tinder:match_pedro_01",
    actionType: "transfer_channel",
    messageType: "transfer_channel",
    channel: "whatsapp2",
    content: "Oii Pedro, é a Larissa do Tinder por aqui :)",
    idempotencyKey: "idem_scen_01",
    payload: {
      actionType: "transfer_channel",
      targetPhone: "+55 (11) 99999-8888",
      initialText: "Oii Pedro, é a Larissa do Tinder por aqui :)",
      targetChannel: "whatsapp2",
      recipientContactName: "Pedro Tinder",
    },
    status: "pending",
  };

  const dispatchResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry,
    recipientId: "tinder:match_pedro_01",
    runtime: {
      mockChannelTransferGateway: async (params) => {
        gatewayCalledWith = params;
        return {
          success: true,
          providerMessageId: "wam_ok_pedro_01",
          contactSaveStatus: "saved",
        };
      },
    },
  });

  // 1. Asserção de sucesso e metadados de envio
  assert.equal(dispatchResult.success, true);
  assert.equal(outboxEntry.status, "sent");
  assert.equal(dispatchResult.providerMessageId, "wam_ok_pedro_01");

  // 2. O gateway recebeu o número E.164 limpo e o texto decidido pelo Brain
  assert.ok(gatewayCalledWith);
  assert.equal(gatewayCalledWith.recipientId, "+5511999998888");
  assert.equal(gatewayCalledWith.text, "Oii Pedro, é a Larissa do Tinder por aqui :)");

  // 3. Registro persistido em conversation_channel_transfers como 'confirmed'
  const transfer = db._state.transfers.find((t) => t.idempotency_key === "idem_scen_01");
  assert.ok(transfer, "Transferência deve estar persistida");
  assert.equal(transfer.status, "confirmed");
  assert.equal(transfer.source_channel, "tinder");
  assert.equal(transfer.target_channel, "whatsapp2");
  assert.equal(transfer.target_recipient, "+5511999998888");

  // 4. Identidade canônica vinculada no WhatsApp2
  const identity = db._state.identities.find((i) => i.external_identity_id === "+5511999998888");
  assert.ok(identity, "Identidade WhatsApp2 deve existir");
  assert.equal(identity.conversation_id, "tinder:match_pedro_01");
  assert.equal(identity.channel, "whatsapp2");
  assert.equal(identity.status, "active");

  // 5. Inbound subsequente do WhatsApp com o JID exibido pelo gateway resolve a mesma conversa canônica
  const resolved = await resolveCanonicalConversationId({
    supabase: db,
    channel: "whatsapp2",
    chatId: "5511999998888@s.whatsapp.net",
  });
  assert.equal(resolved.found, true);
  assert.equal(resolved.conversationId, "tinder:match_pedro_01", "Mensagem do WhatsApp deve resolver a mesma conversa canônica do Tinder");
});

// ====================================================================================
// CENÁRIO 2: Falha confirmada no gateway devolvendo fato técnico ao Brain sem inventar
// ====================================================================================
test("Cenário 2: Falha confirmada no gateway devolve fato técnico ao Brain sem backend inventar texto", async () => {
  const db = createScenariosMockDb({
    conversations: [
      {
        id: "tinder:match_pedro_02",
        contact_id: "match_pedro_02",
        channel: "tinder",
        full_name: "Pedro Sem Zap",
        status: "active",
      },
    ],
    messages: [
      {
        id: "msg_inbound_pedro_02",
        conversation_id: "tinder:match_pedro_02",
        sender_id: "match_pedro_02",
        recipient_id: "larissa",
        text: "Me chama no zap!",
        created_at: "2026-10-06T12:00:00Z",
        direction: "inbound",
        channel: "tinder",
      },
    ],
  });

  const outboxEntry = {
    id: "out_transfer_scen_02",
    conversationId: "tinder:match_pedro_02",
    actionType: "transfer_channel",
    messageType: "transfer_channel",
    channel: "whatsapp2",
    content: "Oii Pedro!",
    idempotencyKey: "idem_scen_02",
    payload: {
      actionType: "transfer_channel",
      targetPhone: "+55 (11) 91111-0000",
      initialText: "Oii Pedro!",
      targetChannel: "whatsapp2",
      sourceMessageIds: ["msg_inbound_pedro_02"],
    },
    status: "pending",
  };

  const dispatchResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry,
    recipientId: "tinder:match_pedro_02",
    runtime: {
      mockChannelTransferGateway: async () => ({
        success: false,
        isUncertain: false,
        error: "recipient_not_registered_on_whatsapp",
      }),
    },
  });

  // 1. Despacho resulta em falha
  assert.equal(dispatchResult.success, false);
  assert.equal(outboxEntry.status, "failed");

  // 2. Registro em transfers é 'failed' com o motivo técnico do provedor
  const transfer = db._state.transfers.find((t) => t.idempotency_key === "idem_scen_02");
  assert.ok(transfer);
  assert.equal(transfer.status, "failed");
  assert.equal(transfer.failure_reason, "recipient_not_registered_on_whatsapp");

  // 3. NENHUMA identidade WhatsApp2 foi vinculada
  assert.equal(db._state.identities.length, 0);

  // 4. O backend NÃO gerou nenhuma mensagem nova de texto (permanece apenas a mensagem inbound original)
  assert.equal(db._state.messages.length, 1);
  assert.equal(db._state.messages[0].id, "msg_inbound_pedro_02");

  // 5. O evento técnico para o Brain foi registrado na fila de reentrada via autopilot
  assert.equal(transfer.brain_reentry_status, "queued");
  assert.equal(transfer.brain_reentry_technical_code, "recipient_not_registered_on_whatsapp");
  assert.equal(db._state.queueCalls.length, 1);
  assert.equal(db._state.queueCalls[0].args.p_conversation_id, "tinder:match_pedro_02");
  assert.equal(db._state.queueCalls[0].args.p_message_id, "msg_inbound_pedro_02");
});

// ====================================================================================
// CENÁRIO 3: Correção de número pelo contato/Brain após falha anterior
// ====================================================================================
test("Cenário 3: Correção de número pelo contato/Brain obtém sucesso e preserva histórico prévio", async () => {
  const db = createScenariosMockDb({
    conversations: [
      {
        id: "tinder:match_pedro_03",
        contact_id: "match_pedro_03",
        channel: "tinder",
        full_name: "Pedro Corrigido",
        status: "active",
      },
    ],
    // Histórico da tentativa anterior fracassada
    transfers: [
      {
        id: "transfer_prev_fail",
        conversation_id: "tinder:match_pedro_03",
        source_channel: "tinder",
        target_channel: "whatsapp2",
        target_recipient: "+5511911110000",
        initial_message_text: "Oii Pedro!",
        status: "failed",
        failure_reason: "recipient_not_registered_on_whatsapp",
        idempotency_key: "idem_scen_03_attempt_1",
      },
    ],
  });

  // O contato informa novo número no Tinder, e o Brain emite novo transfer_channel
  const correctedOutboxEntry = {
    id: "out_transfer_scen_03_att2",
    conversationId: "tinder:match_pedro_03",
    actionType: "transfer_channel",
    messageType: "transfer_channel",
    channel: "whatsapp2",
    content: "Oii Pedro, agora sim no zap certo :)",
    idempotencyKey: "idem_scen_03_attempt_2",
    payload: {
      actionType: "transfer_channel",
      targetPhone: "+55 (11) 98888-7777",
      initialText: "Oii Pedro, agora sim no zap certo :)",
      targetChannel: "whatsapp2",
      recipientContactName: "Pedro Corrigido",
    },
    status: "pending",
  };

  const dispatchResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry: correctedOutboxEntry,
    recipientId: "tinder:match_pedro_03",
    runtime: {
      mockChannelTransferGateway: async (params) => {
        assert.equal(params.recipientId, "+5511988887777");
        return {
          success: true,
          providerMessageId: "wam_ok_corrected_7777",
          contactSaveStatus: "saved",
        };
      },
    },
  });

  // 1. O novo despacho tem sucesso
  assert.equal(dispatchResult.success, true);
  assert.equal(correctedOutboxEntry.status, "sent");

  // 2. Ambas as transferências existem no histórico: a falha anterior e o sucesso atual
  assert.equal(db._state.transfers.length, 2);
  const prevTransfer = db._state.transfers.find((t) => t.idempotency_key === "idem_scen_03_attempt_1");
  const newTransfer = db._state.transfers.find((t) => t.idempotency_key === "idem_scen_03_attempt_2");
  assert.equal(prevTransfer.status, "failed");
  assert.equal(newTransfer.status, "confirmed");

  // 3. A nova identidade está vinculada
  const resolved = await resolveCanonicalConversationId({
    supabase: db,
    channel: "whatsapp2",
    chatId: "5511988887777@s.whatsapp.net",
  });
  assert.equal(resolved.found, true);
  assert.equal(resolved.conversationId, "tinder:match_pedro_03");
});

// ====================================================================================
// CENÁRIO 4: Envio incerto (timeout do gateway) travando retry cego e marcando dispatch_uncertain
// ====================================================================================
test("Cenário 4: Envio incerto (timeout de rede) bloqueia retry cego automático", async () => {
  const db = createScenariosMockDb({
    conversations: [
      {
        id: "tinder:match_pedro_04",
        contact_id: "match_pedro_04",
        channel: "tinder",
        full_name: "Pedro Timeout",
        status: "active",
      },
    ],
  });

  let gatewayCallsCount = 0;

  const outboxEntry = {
    id: "out_transfer_scen_04",
    conversationId: "tinder:match_pedro_04",
    actionType: "transfer_channel",
    messageType: "transfer_channel",
    channel: "whatsapp2",
    content: "Oii Pedro!",
    idempotencyKey: "idem_scen_04",
    payload: {
      actionType: "transfer_channel",
      targetPhone: "+55 (11) 95555-4444",
      initialText: "Oii Pedro!",
      targetChannel: "whatsapp2",
    },
    status: "pending",
  };

  const dispatchResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry,
    recipientId: "tinder:match_pedro_04",
    runtime: {
      mockChannelTransferGateway: async () => {
        gatewayCallsCount++;
        return {
          success: false,
          isUncertain: true,
          error: "gateway_timeout_upstream_no_ack",
        };
      },
    },
  });

  // 1. O resultado é marcado como dispatch_uncertain
  assert.equal(dispatchResult.success, false);
  assert.equal(outboxEntry.status, "dispatch_uncertain");
  assert.equal(gatewayCallsCount, 1);

  // 2. O registro em transfers fica 'uncertain'
  const transfer = db._state.transfers.find((t) => t.idempotency_key === "idem_scen_04");
  assert.ok(transfer);
  assert.equal(transfer.status, "uncertain");

  // 3. Tentativa subsequente de retry cego com a mesma entrada é bloqueada pelo dispatcher
  const retryResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry: { ...outboxEntry, status: "dispatch_uncertain" },
    recipientId: "tinder:match_pedro_04",
    runtime: {
      mockChannelTransferGateway: async () => {
        gatewayCallsCount++;
        return { success: true, providerMessageId: "never_called" };
      },
    },
  });

  // O gateway NÃO foi chamado de novo no retry cego
  assert.equal(gatewayCallsCount, 1, "Gateway não deve ser invocado em retry cego de envio incerto");
  assert.equal(retryResult.isUncertain, true);
  assert.match(retryResult.error, /Retry automático bloqueado/);
});

// ====================================================================================
// CENÁRIO 5: Mensagens recebidas em ambos os canais preservam histórico e cronograma
// ====================================================================================
test("Cenário 5: Mensagens em ambos os canais residem na mesma conversa canônica com histórico preservado", async () => {
  const db = createScenariosMockDb({
    conversations: [
      {
        id: "tinder:match_pedro_05",
        contact_id: "match_pedro_05",
        channel: "tinder",
        full_name: "Pedro Multicanal",
        status: "active",
        ai_auto_respond: true,
      },
    ],
    identities: [
      {
        id: "ident_tinder_05",
        conversation_id: "tinder:match_pedro_05",
        channel: "tinder",
        external_identity_id: "match_pedro_05",
        status: "active",
      },
      {
        id: "ident_wa_05",
        conversation_id: "tinder:match_pedro_05",
        channel: "whatsapp2",
        external_identity_id: "+5511944443333",
        status: "active",
      },
    ],
  });

  // 1. Mensagem recebida via WhatsApp2 (contato responde no WhatsApp)
  const resolvedConvWhatsApp = await resolveCanonicalConversationId({
    supabase: db,
    channel: "whatsapp2",
    chatId: "5511944443333@s.whatsapp.net",
  });
  assert.equal(resolvedConvWhatsApp.found, true);
  assert.equal(resolvedConvWhatsApp.conversationId, "tinder:match_pedro_05");

  await db.from("instagram_messages").insert({
    id: "wa_msg_inbound_001",
    conversation_id: resolvedConvWhatsApp.conversationId,
    sender_id: "5511944443333@s.whatsapp.net",
    recipient_id: "larissa",
    text: "Oi Larissa, salvei seu número!",
    created_at: "2026-10-06T15:00:00Z",
    direction: "incoming",
    channel: "whatsapp2",
  });

  // 2. Mensagem recebida via Tinder (contato manda mais uma mensagem no Tinder 5 minutos depois)
  const resolvedConvTinder = await resolveCanonicalConversationId({
    supabase: db,
    channel: "tinder",
    externalIdentityId: "match_pedro_05",
  });
  assert.equal(resolvedConvTinder.found, true);
  assert.equal(resolvedConvTinder.conversationId, "tinder:match_pedro_05");

  await db.from("instagram_messages").insert({
    id: "tinder_msg_inbound_002",
    conversation_id: resolvedConvTinder.conversationId,
    sender_id: "match_pedro_05",
    recipient_id: "larissa",
    text: "Mandei mensagem lá no zap também :)",
    created_at: "2026-10-06T15:05:00Z",
    direction: "incoming",
    channel: "tinder",
  });

  // 3. Verificação do histórico consolidado sob a mesma conversa canônica
  const { data: messages } = await db
    .from("instagram_messages")
    .select("*")
    .eq("conversation_id", "tinder:match_pedro_05")
    .order("created_at")
    .limit(10);

  assert.equal(messages.length, 2, "Ambas as mensagens devem estar na mesma conversa");
  assert.equal(messages[0].channel, "whatsapp2");
  assert.equal(messages[0].text, "Oi Larissa, salvei seu número!");
  assert.equal(messages[1].channel, "tinder");
  assert.equal(messages[1].text, "Mandei mensagem lá no zap também :)");
});

// ====================================================================================
// CENÁRIO 6: Reprocessamento seguro (idempotência e bloqueio de concorrência)
// ====================================================================================
test("Cenário 6: Idempotência com chave já concluída não reenvia, e status sending bloqueia concorrência", async () => {
  const db = createScenariosMockDb({
    conversations: [
      {
        id: "tinder:match_pedro_06",
        contact_id: "match_pedro_06",
        channel: "tinder",
        status: "active",
      },
    ],
  });

  let networkGatewayCalls = 0;
  const mockGateway = async () => {
    networkGatewayCalls++;
    return {
      success: true,
      providerMessageId: "wam_ok_idemp_first",
      contactSaveStatus: "saved",
    };
  };

  // Primeira execução da transferência
  const firstExec = await executeChannelTransfer({
    supabase: db,
    conversationId: "tinder:match_pedro_06",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "+55 (11) 93333-2222",
    initialMessageText: "Oii Pedro!",
    idempotencyKey: "idem_key_strict_06",
    mockGateway,
  });

  assert.equal(firstExec.success, true);
  assert.equal(firstExec.providerMessageId, "wam_ok_idemp_first");
  assert.equal(networkGatewayCalls, 1);

  // Segunda execução com a mesma chave (reprocessamento de fila ou duplicata de webhook)
  const secondExec = await executeChannelTransfer({
    supabase: db,
    conversationId: "tinder:match_pedro_06",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "+55 (11) 93333-2222",
    initialMessageText: "Oii Pedro!",
    idempotencyKey: "idem_key_strict_06",
    mockGateway,
  });

  // Retorna sucesso com dados já confirmados SEM chamar o gateway de novo
  assert.equal(secondExec.success, true);
  assert.equal(secondExec.providerMessageId, "wam_ok_idemp_first");
  assert.equal(secondExec.brainFact.technicalCode, "delivery_already_confirmed");
  assert.equal(networkGatewayCalls, 1, "Gateway de rede NÃO deve ser chamado uma segunda vez!");

  // Teste de concorrência: registro com status 'sending' ativo bloqueia disparo paralelo
  db._state.transfers.push({
    id: "transfer_concurrent",
    conversation_id: "tinder:match_pedro_06",
    source_channel: "tinder",
    target_channel: "whatsapp2",
    target_recipient: "+5511977770000",
    initial_message_text: "Oii Pedro!",
    status: "sending",
    idempotency_key: "idem_key_concurrent_active",
  });

  const concurrentExec = await executeChannelTransfer({
    supabase: db,
    conversationId: "tinder:match_pedro_06",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "+55 (11) 97777-0000",
    initialMessageText: "Oii Pedro!",
    idempotencyKey: "idem_key_concurrent_active",
    mockGateway,
  });

  assert.equal(concurrentExec.success, false);
  assert.equal(concurrentExec.isUncertain, true);
  assert.equal(concurrentExec.brainFact.technicalCode, "transfer_in_progress_concurrent");
  assert.equal(networkGatewayCalls, 1, "Gateway de rede NÃO deve ser chamado durante processamento concorrente ativo");
});
