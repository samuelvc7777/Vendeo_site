import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";

// Registra o loader antes do import dinâmico para garantir compatibilidade com `node --test` nativo
try {
  register("../scripts/node-esm-npm-loader.mjs", import.meta.url);
} catch {}

const { dispatchOutboxEntry, createBrainOutboxBatch, resolveOutboxDefaultChannel } = await import("../supabase/functions/api/brain_orchestrator.ts");
const { executeChannelTransfer } = await import("../supabase/functions/api/channel_transfer_service.ts");
const { queueTransferBrainReentry, loadPendingTransferBrainEvents } = await import("../supabase/functions/api/channel_transfer_reentry.ts");
const { createTinderBackgroundMessageReader, handleTinderMatchRoutes } = await import("../supabase/functions/api/tinder_match_routes.ts");
const {
  processTinderBackgroundSync,
  syncTinderMatchMessages,
  createDatabaseTinderCursorStore,
  isTinderLiveSyncEnabled,
} = await import("../supabase/functions/api/tinder_sync_service.ts");
const {
  resolveCanonicalConversationId,
  linkExternalChannelIdentity,
} = await import("../supabase/functions/api/multichannel_identity_service.ts");
const {
  validateConversationBrainPlan,
  buildPersistentTurnContext,
} = await import("../supabase/functions/api/openai_brain.ts");

/**
 * Cria banco simulado completo em memória para testes de comportamento determinísticos.
 */
function createIntegrationMockDb() {
  const conversations = [
    {
      id: "tinder:match_amanda_01",
      contact_id: "match_amanda_01",
      channel: "tinder",
      full_name: "Amanda Match",
      status: "active",
      ai_auto_respond: true,
      last_message: null,
      last_message_at: null,
    },
  ];
  const messages = [];
  const identities = [];
  const transfers = [];
  const queueCalls = [];
  const syncStates = [];
  const inboundJobs = [];

  let failNextTransferUpdate = false;

  return {
    _state: { conversations, messages, identities, transfers, queueCalls, syncStates, inboundJobs },
    async rpc(name, args) {
      if (name === "claim_tinder_sync_lease") {
        let state = syncStates.find((row) => row.match_id === args.p_match_id);
        if (!state) {
          state = { match_id: args.p_match_id, cursor: null, lease_token: null, lease_expires_at: 0 };
          syncStates.push(state);
        }
        if (state.lease_expires_at > Date.now()) return { data: { success: true, acquired: false }, error: null };
        state.lease_token = args.p_lease_token;
        state.lease_expires_at = Date.now() + args.p_ttl_seconds * 1000;
        return { data: { success: true, acquired: true }, error: null };
      }
      if (name === "set_tinder_sync_cursor") {
        const state = syncStates.find((row) => row.match_id === args.p_match_id && row.lease_token === args.p_lease_token);
        if (!state) return { data: { success: false }, error: null };
        state.cursor = args.p_cursor;
        return { data: { success: true }, error: null };
      }
      if (name === "release_tinder_sync_lease") {
        const state = syncStates.find((row) => row.match_id === args.p_match_id && row.lease_token === args.p_lease_token);
        if (state) {
          state.lease_token = null;
          state.lease_expires_at = 0;
        }
        return { data: { success: Boolean(state) }, error: null };
      }
      if (name === "enqueue_autopilot_inbound_job") {
        queueCalls.push({ name, args });
        const existing = inboundJobs.find((job) => job.conversation_id === args.p_conversation_id);
        if (existing) existing.latest_message_id = args.p_message_id;
        else inboundJobs.push({ conversation_id: args.p_conversation_id, latest_message_id: args.p_message_id });
        return { data: { success: true, status: "pending" }, error: null };
      }
      return { data: null, error: { message: `RPC inesperada: ${name}` } };
    },
    setFailNextTransferUpdate(val) {
      failNextTransferUpdate = val;
    },
    from(table) {
      if (table === "instagram_conversations") {
        return {
          select: () => {
            const filters = [];
            const query = {
              eq(field, value) { filters.push({ field, value }); return query; },
              in(field, values) { filters.push({ field, value: values }); return query; },
              order() { return query; },
              limit() { return query; },
              maybeSingle: async () => ({ data: conversations.find((row) => filters.every(({ field, value }) =>
                Array.isArray(value) ? value.includes(row[field]) : row[field] === value
              )) || null, error: null }),
              then(resolve) {
                const data = conversations.filter((row) => filters.every(({ field, value }) =>
                  Array.isArray(value) ? value.includes(row[field]) : row[field] === value
                ));
                return resolve({ data, error: null });
              },
            };
            return query;
          },
          upsert: async (row, upsertOptions) => {
            assert.equal(upsertOptions.onConflict, "id");
            assert.equal(upsertOptions.ignoreDuplicates, true);
            if (!conversations.some((conversation) => conversation.id === row.id)) {
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
            const filters = [];
            let orderBy = null;
            let ascending = true;
            let maxRows = null;
            const query = {
              in(field, values) { filters.push({ field, value: values }); return query; },
              eq(field, value) { filters.push({ field, value }); return query; },
              lte(field, value) { filters.push({ field, value, lte: true }); return query; },
              order(field, options = {}) { orderBy = field; ascending = options.ascending !== false; return query; },
              limit(value) { maxRows = value; return query; },
              maybeSingle: async () => ({ data: execute()[0] || null, error: null }),
              range: async (start, end) => ({ data: execute().slice(start, end + 1), error: null }),
              then(resolve) { return resolve({ data: execute(), error: null }); },
            };
            const execute = () => {
              let matched = messages.filter((row) => filters.every(({ field, value, lte }) => {
                if (lte) return Date.parse(String(row[field] || "")) <= Date.parse(String(value));
                return Array.isArray(value) ? value.includes(row[field]) : row[field] === value;
              }));
              if (orderBy) matched = matched.slice().sort((left, right) => {
                const a = Date.parse(String(left[orderBy] || ""));
                const b = Date.parse(String(right[orderBy] || ""));
                return ascending ? a - b : b - a;
              });
              return maxRows === null ? matched : matched.slice(0, maxRows);
            };
            return query;
          },
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

      if (table === "conversation_channel_identities") {
        return {
          select: () => {
            const filters = [];
            const queryObj = {
              eq: (f, v) => {
                filters.push({ field: f, value: v });
                return queryObj;
              },
              in: (f, values) => {
                filters.push({ field: f, value: values });
                return queryObj;
              },
              order: () => queryObj,
              limit: () => queryObj,
              maybeSingle: async () => {
                const found = identities.find((row) => filters.every(({ field, value }) =>
                  Array.isArray(value) ? value.includes(row[field]) : row[field] === value
                ));
                return { data: found || null, error: null };
              },
              then: (resolve) => {
                const matched = identities.filter((row) => filters.every(({ field, value }) =>
                  Array.isArray(value) ? value.includes(row[field]) : row[field] === value
                ));
                return resolve({ data: matched, error: null });
              },
            };
            return queryObj;
          },
          insert: async (row) => {
            identities.push({ ...row, id: `ident_${identities.length + 1}` });
            return { error: null };
          },
          update: (changes) => {
            const filters = {};
            const updateObj = {
              eq: (f, v) => {
                filters[f] = v;
                return updateObj;
              },
              then: (resolve) => {
                const item = identities.find((i) => {
                  for (const [k, val] of Object.entries(filters)) {
                    if (i[k] !== val) return false;
                  }
                  return true;
                });
                if (item) Object.assign(item, changes);
                return resolve({ error: null });
              },
            };
            return updateObj;
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
            if (mode === "update") for (const row of limited) Object.assign(row, changes);
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

      if (table === "tinder_sync_state") {
        return {
          select: () => {
            const filters = {};
            const queryObj = {
              eq: (field, value) => {
                filters[field] = value;
                return queryObj;
              },
              maybeSingle: async () => ({
                data: syncStates.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) || null,
                error: null,
              }),
            };
            return queryObj;
          },
        };
      }

      if (table === "autopilot_inbound_jobs") {
        return {
          select: () => {
            const filters = {};
            const queryObj = {
              eq: (field, value) => {
                filters[field] = value;
                return queryObj;
              },
              maybeSingle: async () => ({
                data: inboundJobs.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) || null,
                error: null,
              }),
            };
            return queryObj;
          },
        };
      }

      throw new Error(`Tabela mock inesperada: ${table}`);
    },
  };
}

test("1. Comportamento: dispatchOutboxEntry executa transferência Tinder -> WhatsApp2 com gateway mockado antes de atalhos de simulação", async () => {
  const db = createIntegrationMockDb();
  let gatewayCalledWith = null;

  const outboxEntry = {
    id: "out_transfer_001",
    conversationId: "tinder:match_amanda_01",
    actionType: "transfer_channel",
    messageType: "transfer_channel",
    channel: "whatsapp2", // canal alvo na ação
    content: "Oi Amanda! É a Larissa por aqui :)",
    idempotencyKey: "idem_dispatch_full_001",
    payload: {
      actionType: "transfer_channel",
      targetPhone: "+55 11 98877-6655",
      initialText: "Oi Amanda! É a Larissa por aqui :)",
      targetChannel: "whatsapp2",
    },
    status: "pending",
  };

  const dispatchResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry,
    recipientId: "tinder:match_amanda_01",
    runtime: {
              mockChannelTransferGateway: async (params) => {
                gatewayCalledWith = params;
                return {
                  success: true,
                  providerMessageId: "wam_prov_success_123",
                  contactSaveStatus: "saved",
                };
              },
    },
  });

  // 1. Despacho bem-sucedido
  assert.equal(dispatchResult.success, true);
  assert.equal(outboxEntry.status, "sent");
  assert.equal(outboxEntry.providerMessageId, "wam_prov_success_123");

  // 2. Gateway recebeu dados normalizados
  assert.ok(gatewayCalledWith);
  assert.equal(gatewayCalledWith.recipientId, "+5511988776655");
  assert.equal(gatewayCalledWith.text, "Oi Amanda! É a Larissa por aqui :)");
  assert.equal(gatewayCalledWith.idempotencyKey, "idem_dispatch_full_001");

  // 3. Registro persistido em conversation_channel_transfers preserva source=tinder e target=whatsapp2
  const recordedTransfer = db._state.transfers.find(
    (t) => t.idempotency_key === "idem_dispatch_full_001"
  );
  assert.ok(recordedTransfer);
  assert.equal(recordedTransfer.source_channel, "tinder");
  assert.equal(recordedTransfer.target_channel, "whatsapp2");
  assert.equal(recordedTransfer.status, "confirmed");

  // 4. Vínculo criado na mesma conversa canônica
  const linkedIdentity = db._state.identities.find(
    (i) => i.channel === "whatsapp2" && i.external_identity_id === "+5511988776655"
  );
  assert.ok(linkedIdentity);
  assert.equal(linkedIdentity.conversation_id, "tinder:match_amanda_01");

  // 5. Teste de Idempotência estrita: re-execução não reenvia ao gateway
  gatewayCalledWith = null;
  const repeatDispatch = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry,
    recipientId: "tinder:match_amanda_01",
    runtime: {
      mockChannelTransferGateway: async () => {
        throw new Error("Não deve chamar o gateway em outbox já enviada");
      },
    },
  });

  assert.equal(repeatDispatch.success, true);
  assert.equal(gatewayCalledWith, null);
});

test("2. Comportamento: falha confirmada no gateway devolve fato técnico ao Brain sem inventar texto", async () => {
  const db = createIntegrationMockDb();

  const outboxEntry = {
    id: "out_transfer_fail_001",
    conversationId: "tinder:match_amanda_01",
    actionType: "transfer_channel",
    messageType: "transfer_channel",
    channel: "whatsapp2",
    content: "Oi Amanda!",
    idempotencyKey: "idem_dispatch_fail_001",
    payload: {
      actionType: "transfer_channel",
      targetPhone: "+55 11 98877-6655",
      initialText: "Oi Amanda!",
      targetChannel: "whatsapp2",
      sourceMessageIds: ["tinder_msg_source_fail"],
    },
    status: "pending",
  };

  const dispatchResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry,
    recipientId: "tinder:match_amanda_01",
    runtime: {
      mockChannelTransferGateway: async () => {
        return { success: false, error: "number_not_registered_on_whatsapp" };
      },
    },
  });

  assert.equal(dispatchResult.success, false);
  assert.equal(outboxEntry.status, "failed");
  assert.equal(outboxEntry.lastError, "number_not_registered_on_whatsapp");

  // Verifica persistência do fato técnico
  const transfer = db._state.transfers.find(
    (t) => t.idempotency_key === "idem_dispatch_fail_001"
  );
  assert.ok(transfer);
  assert.equal(transfer.status, "failed");
  assert.equal(transfer.failure_reason, "number_not_registered_on_whatsapp");
  assert.equal(transfer.brain_reentry_status, "queued");
  assert.equal(db._state.queueCalls[0].args.p_message_id, "tinder_msg_source_fail");
});

test("3. Comportamento: timeout e incerteza no gateway travam retry cego e marcam dispatch_uncertain", async () => {
  const db = createIntegrationMockDb();

  const outboxEntry = {
    id: "out_transfer_unc_001",
    conversationId: "tinder:match_amanda_01",
    actionType: "transfer_channel",
    messageType: "transfer_channel",
    channel: "whatsapp2",
    content: "Oi Amanda!",
    idempotencyKey: "idem_dispatch_unc_001",
    payload: {
      actionType: "transfer_channel",
      targetPhone: "+55 11 98877-6655",
      initialText: "Oi Amanda!",
      targetChannel: "whatsapp2",
      sourceMessageIds: ["tinder_msg_source_uncertain"],
    },
    status: "pending",
  };

  const dispatchResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry,
    recipientId: "tinder:match_amanda_01",
    runtime: {
      mockChannelTransferGateway: async () => {
        return { success: false, isUncertain: true, error: "gateway_request_timeout" };
      },
    },
  });

  assert.equal(dispatchResult.success, false);
  assert.equal(dispatchResult.isUncertain, true);
  assert.equal(outboxEntry.status, "dispatch_uncertain");
  assert.equal(outboxEntry.isUncertain, true);

  // Tentativa subsequente de despacho cego é bloqueada
  let secondCallInvoked = false;
  const retryResult = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry,
    recipientId: "tinder:match_amanda_01",
    runtime: {
      mockChannelTransferGateway: async () => {
        secondCallInvoked = true;
        return { success: true };
      },
    },
  });

  assert.equal(retryResult.success, false);
  assert.equal(retryResult.isUncertain, true);
  assert.equal(secondCallInvoked, false);
  assert.match(retryResult.error, /Retry automático bloqueado/);
});

test("4. Comportamento: se provider confirmar envio mas persistência do resultado falhar, não reporta sucesso nem duplica", async () => {
  const db = createIntegrationMockDb();
  db.setFailNextTransferUpdate(true);

  let gatewayExecutions = 0;

  const result = await executeChannelTransfer({
    supabase: db,
    conversationId: "tinder:match_amanda_01",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "+55 11 98877-6655",
    initialMessageText: "Oi!",
    idempotencyKey: "idem_persistence_failure_001",
    mockGateway: async () => {
      gatewayExecutions++;
      return { success: true, providerMessageId: "wam_delivered_live" };
    },
  });

  // Não reporta sucesso reconciliado às cegas
  assert.equal(result.success, false);
  assert.equal(result.status, "uncertain");
  assert.equal(result.isUncertain, true);
  assert.equal(result.brainFact.technicalCode, "persistence_failed_after_delivery");
  assert.equal(gatewayExecutions, 1);

  // Reprocessamento imediato da mesma transferência reconhece status não-reconciliado e bloqueia reenvio
  const secondResult = await executeChannelTransfer({
    supabase: db,
    conversationId: "tinder:match_amanda_01",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetPhoneRaw: "+55 11 98877-6655",
    initialMessageText: "Oi!",
    idempotencyKey: "idem_persistence_failure_001",
    mockGateway: async () => {
      gatewayExecutions++;
      return { success: true };
    },
  });

  // Bloqueou novo disparo no gateway
  assert.equal(gatewayExecutions, 1);
  assert.equal(secondResult.status, "uncertain");
  assert.equal(secondResult.isUncertain, true);
  assert.match(
    secondResult.brainFact.technicalCode,
    /transfer_in_progress_concurrent|gateway_uncertain_pending_reconciliation/
  );
});

test("5. Comportamento: fatos técnicos de transferência e canal são entregues ao contexto do Brain", () => {
  const turnContext = buildPersistentTurnContext({
    supabase: {},
    conversationId: "tinder:match_amanda_01",
    currentStageId: "identificacao",
    recentMessages: [],
    currentInboundMessages: [
      {
        id: "tmsg_001",
        text: "Meu número é 11 98877-6655",
        channel: "tinder",
        createdAt: "2026-10-06T12:05:00Z",
      },
    ],
    recentChannelTransferEvents: [
      {
        sourceChannel: "tinder",
        targetChannel: "whatsapp2",
        targetPhone: "+5511988776655",
        status: "uncertain",
        technicalCode: "gateway_request_timeout",
        details: "Timeout de rede aguardando ack do gateway",
      },
    ],
  });

  // Valida que o Brain recebe os fatos objetivos
  assert.match(turnContext, /canal=tinder/);
  assert.match(turnContext, /FATOS TÉCNICOS DE TRANSFERÊNCIA DE CANAL/);
  assert.match(turnContext, /canal_origem=tinder canal_destino=whatsapp2 status=uncertain codigo_tecnico_json="gateway_request_timeout"/);
  assert.match(turnContext, /O backend NÃO classifica semanticamente nem redige respostas/);
});

test("6. Comportamento: cursor persistente em banco e bloqueio de execução concorrente por lease", async () => {
  const db = createIntegrationMockDb();

  // Registra vínculo prévio com cursor inicial
  await linkExternalChannelIdentity({
    supabase: db,
    conversationId: "tinder:match_amanda_01",
    channel: "tinder",
    externalIdentityId: "match_amanda_01",
    status: "active",
  });

  const cursorStore = createDatabaseTinderCursorStore(db);

  // 1. Cursor só pode ser persistido enquanto a lease atômica pertence ao worker.
  const acquired1 = await cursorStore.acquireLease("match_amanda_01", 60);
  assert.equal(acquired1, true);
  await cursorStore.setCursor("match_amanda_01", "2026-10-06T11:00:00Z");
  const storedCursor = await cursorStore.getCursor("match_amanda_01");
  assert.equal(storedCursor, "2026-10-06T11:00:00Z");

  // 2. Testa lease de concorrência: segundo worker é rejeitado até liberação.
  const acquiredConcurrently = await cursorStore.acquireLease("match_amanda_01", 60);
  assert.equal(acquiredConcurrently, false); // Bloqueado por lease ativa!

  // Liberação de lease
  await cursorStore.releaseLease("match_amanda_01");
  const acquiredAfterRelease = await cursorStore.acquireLease("match_amanda_01", 60);
  assert.equal(acquiredAfterRelease, true);
  await cursorStore.releaseLease("match_amanda_01");
});

test("7. Comportamento: sincronização com interface fechada processa mensagens, atualiza cursor e deduplica em execuções concorrentes", async () => {
  const db = createIntegrationMockDb();
  let brainEnqueueCalls = 0;

  const rawMessagesMatch = [
    { id: "tmsg_1", text: "Oi Larissa!", from: "match_amanda_01", isMine: false, sentAt: "2026-10-06T12:00:00Z" },
    { id: "tmsg_2", text: "Tudo bem?", from: "match_amanda_01", isMine: false, sentAt: "2026-10-06T12:01:00Z" },
  ];

  // Primeira execução com mock explícito de teste
  const syncResult1 = await processTinderBackgroundSync({
    supabase: db,
    testMockFetchMessages: async (matchId) => {
      assert.equal(matchId, "match_amanda_01");
      return rawMessagesMatch;
    },
    enqueueBrain: async (convId, msgIds) => {
      brainEnqueueCalls++;
      assert.equal(convId, "tinder:match_amanda_01");
      assert.equal(msgIds.length, 2);
    },
    rateLimitMs: 0,
  });

  assert.equal(syncResult1.matchesProcessed, 1);
  assert.equal(syncResult1.newInboundTotal, 2);
  assert.equal(brainEnqueueCalls, 1);

  // Segunda execução com as mesmas mensagens: deduplicação em lote não re-enfileira
  const syncResult2 = await processTinderBackgroundSync({
    supabase: db,
    testMockFetchMessages: async () => rawMessagesMatch,
    enqueueBrain: async () => {
      brainEnqueueCalls++;
    },
    rateLimitMs: 0,
  });

  assert.equal(syncResult2.newInboundTotal, 0);
  assert.equal(brainEnqueueCalls, 1); // Não chamou novamente!
});

test("8. Comportamento: resposta subsequente do WhatsApp resolve a MESMA conversa canônica", async () => {
  const db = createIntegrationMockDb();

  await linkExternalChannelIdentity({
    supabase: db,
    conversationId: "tinder:match_amanda_01",
    channel: "whatsapp2",
    externalIdentityId: "+5511988776655",
    status: "active",
  });

  // Mensagem subsequente chega com formato do provedor
  const resolved = await resolveCanonicalConversationId({
    supabase: db,
    chatId: "5511988776655@c.us",
  });

  assert.equal(resolved.found, true);
  assert.equal(resolved.conversationId, "tinder:match_amanda_01");
});

test("outbox usa o canal factual da mensagem de entrada e fixa transferências em WhatsApp2", () => {
  const sourceChannel = resolveOutboxDefaultChannel([
    { direction: "inbound", channel: "tinder", timestamp: "2026-10-06T12:00:00.000Z" },
    { direction: "inbound", channel: "whatsapp2", timestamp: "2026-10-06T12:02:00.000Z" },
    { direction: "outbound", channel: "tinder", timestamp: "2026-10-06T12:03:00.000Z" },
  ], "tinder");
  const [reply] = createBrainOutboxBatch({
    actions: [{ type: "text", text: "Continuamos por aqui." }],
    conversationId: "tinder:match_amanda_01",
    cycleId: "cycle_wa2_reply",
    idempotencyKey: "idem_wa2_reply",
    sourceChannel,
  });
  const [transfer] = createBrainOutboxBatch({
    actions: [{ type: "transfer_channel", targetPhone: "+5511987654321", initialText: "Oi!" }],
    conversationId: "tinder:match_amanda_01",
    cycleId: "cycle_transfer_default",
    idempotencyKey: "idem_transfer_default",
    sourceChannel: "tinder",
  });

  assert.equal(reply.channel, "whatsapp2");
  assert.equal(reply.payload.sourceChannel, "whatsapp2");
  assert.equal(transfer.channel, "whatsapp2");
  assert.equal(transfer.payload.sourceChannel, "tinder");
});

test("resposta de entrada WhatsApp usa identidade E.164 vinculada, nunca o ID do match Tinder", async () => {
  const db = createIntegrationMockDb();
  db._state.identities.push({
    id: "identity_wa2_amanda",
    conversation_id: "tinder:match_amanda_01",
    channel: "whatsapp2",
    external_identity_id: "+5511988776655",
    status: "active",
  });
  let delivery = null;
  const entry = {
    id: "out_wa2_reply",
    cycleId: "cycle_wa2_reply",
    conversationId: "tinder:match_amanda_01",
    idempotencyKey: "idem_wa2_reply_dispatch",
    content: "Que bom, continuamos por aqui.",
    messageType: "text",
    actionType: "text",
    channel: "whatsapp2",
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
    payload: { sourceChannel: "whatsapp2" },
  };

  const result = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry: entry,
    recipientId: "tinder:match_amanda_01",
    runtime: {
      sendWhatsApp2Delivery: async (params) => {
        delivery = params;
        return { success: true, providerMessageId: "wam_wa2_reply_001" };
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(delivery.recipientId, "+5511988776655");
  assert.notEqual(delivery.recipientId, "match_amanda_01");
});

test("outbox legado sem canal usa a última mensagem recebida antes do ciclo", async () => {
  const db = createIntegrationMockDb();
  db._state.identities.push({
    id: "identity_wa2_legacy_outbox",
    conversation_id: "tinder:match_amanda_01",
    channel: "whatsapp2",
    external_identity_id: "+5511988776655",
    status: "active",
  });
  db._state.messages.push({
    id: "wa2-in-before-old-outbox",
    conversation_id: "tinder:match_amanda_01",
    sender_id: "5511988776655@c.us",
    is_mine: false,
    channel: "whatsapp2",
    created_at: "2026-10-06T12:00:00.000Z",
  });
  let delivery = null;
  const entry = {
    id: "out_old_channel_missing",
    cycleId: "cycle_old_channel_missing",
    conversationId: "tinder:match_amanda_01",
    idempotencyKey: "idem_old_channel_missing",
    content: "Continuamos no WhatsApp.",
    messageType: "text",
    status: "pending",
    createdAt: "2026-10-06T12:01:00.000Z",
    payload: {},
  };

  const result = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry: entry,
    recipientId: "tinder:match_amanda_01",
    runtime: {
      sendWhatsApp2Delivery: async (params) => {
        delivery = params;
        return { success: true, providerMessageId: "wam_old_outbox_001" };
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(delivery.recipientId, "+5511988776655");
});

test("resposta WhatsApp falha fechada se uma conversa Tinder não possui identidade WhatsApp vinculada", async () => {
  const db = createIntegrationMockDb();
  let deliveryCalls = 0;
  const entry = {
    id: "out_missing_wa_identity",
    cycleId: "cycle_missing_wa_identity",
    conversationId: "tinder:match_amanda_01",
    idempotencyKey: "idem_missing_wa_identity",
    content: "Resposta.",
    messageType: "text",
    channel: "whatsapp2",
    status: "pending",
    createdAt: new Date().toISOString(),
    payload: { sourceChannel: "whatsapp2" },
  };

  const result = await dispatchOutboxEntry({
    supabase: db,
    outboxEntry: entry,
    recipientId: "tinder:match_amanda_01",
    runtime: {
      sendWhatsApp2Delivery: async () => {
        deliveryCalls++;
        return { success: true, providerMessageId: "must-not-send" };
      },
    },
  });

  assert.equal(result.success, false);
  assert.match(result.error, /whatsapp2_recipient_identity_unresolved/);
  assert.equal(deliveryCalls, 0);
});

test("9. Bloqueio de segurança: chamada ao Tinder sem flag ou sem mock de teste é abortada", async () => {
  assert.equal(isTinderLiveSyncEnabled(), false);

  const syncResult = await processTinderBackgroundSync({
    supabase: {},
    fetchMatchMessages: async () => [],
  });

  assert.equal(syncResult.skippedDueToLockOrScope, true);
  assert.match(syncResult.errors[0].error, /tinder_live_sync_blocked_pending_scope_validation/);
});

test("9a. Flag de leitura Tinder consulta Deno.env no runtime Edge", () => {
  const originalDeno = globalThis.Deno;
  const originalEnv = process.env.ENABLE_TINDER_LIVE_SYNC;
  delete process.env.ENABLE_TINDER_LIVE_SYNC;
  globalThis.Deno = { env: { get: (name) => name === "ENABLE_TINDER_LIVE_SYNC" ? "true" : undefined } };
  try {
    assert.equal(isTinderLiveSyncEnabled(), true);
  } finally {
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
    if (originalEnv !== undefined) process.env.ENABLE_TINDER_LIVE_SYNC = originalEnv;
  }
});

test("10. Inbound Tinder persistido é enfileirado no Brain pelo caminho padrão do worker", async () => {
  const db = createIntegrationMockDb();
  const rawMessages = [
    { id: "tmsg_queue_1", text: "Meu número é 11 98877-6655", from: "match_amanda_01", isMine: false, sentAt: "2026-10-06T12:05:00Z" },
  ];

  const result = await processTinderBackgroundSync({
    supabase: db,
    testMockFetchMessages: async () => rawMessages,
    rateLimitMs: 0,
  });

  assert.equal(result.newInboundTotal, 1);
  assert.deepEqual(db._state.queueCalls, [{
    name: "enqueue_autopilot_inbound_job",
    args: {
      p_conversation_id: "tinder:match_amanda_01",
      p_message_id: "tinder_msg_tmsg_queue_1",
    },
  }]);
});

test("11. Falha de transferência vira evento interno enfileirado sem falsificar mensagem inbound", async () => {
  const db = createIntegrationMockDb();
  const [outboxEntry] = createBrainOutboxBatch({
    actions: [{
      type: "transfer_channel",
      targetPhone: "+55 11 98877-6655",
      initialText: "Oi Amanda!",
      channel: "whatsapp2",
    }],
    conversationId: "tinder:match_amanda_01",
    cycleId: "cycle_transfer_11",
    idempotencyKey: "idem_transfer_11",
    sourceMessageIds: ["tinder_msg_original_11"],
    nowMs: Date.parse("2026-10-06T12:00:00Z"),
  });

  assert.deepEqual(outboxEntry.payload.sourceMessageIds, ["tinder_msg_original_11"]);

  const queued = await queueTransferBrainReentry({
    supabase: db,
    conversationId: "tinder:match_amanda_01",
    sourceChannel: "tinder",
    targetChannel: "whatsapp2",
    targetRecipient: "+55 11 98877-6655",
    initialMessageText: "Oi Amanda!",
    idempotencyKey: "idem_transfer_11",
    sourceMessageIds: outboxEntry.payload.sourceMessageIds,
    status: "failed",
    transferStatus: "failed",
    technicalCode: "phone_format_unparseable",
    details: "O número não pôde ser estruturado pelo gateway.",
    rawInput: "telefone-invalido",
  });

  assert.equal(queued.queued, true);
  assert.equal(db._state.queueCalls.length, 1);
  assert.equal(db._state.queueCalls[0].args.p_message_id, "tinder_msg_original_11");

  const events = await loadPendingTransferBrainEvents(db, "tinder:match_amanda_01");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "channel_transfer_result");
  assert.equal(events[0].technicalCode, "phone_format_unparseable");

  const turnContext = buildPersistentTurnContext({
    currentStageId: "identificacao",
    recentMessages: [],
    currentInboundMessages: [],
    inboundMessages: [],
    internalSystemEvents: events,
  });
  assert.match(turnContext, /EVENTO INTERNO PENDENTE DO SISTEMA/);
  assert.match(turnContext, /evento_id=transfer_1/);
  assert.match(turnContext, /Este evento é um resultado técnico real/);
  assert.doesNotMatch(turnContext, /MENSAGEM 1 id="transfer_1"/);
});

test("12. Cursor Tinder ordena timestamps por instante e elimina IDs repetidos dentro do lote", async () => {
  const db = createIntegrationMockDb();
  const result = await syncTinderMatchMessages({
    supabase: db,
    matchId: "match_amanda_01",
    rawMessages: [
      { id: "later", text: "Mais tarde", from: "match_amanda_01", sentAt: "2026-10-06T10:00:00-05:00" },
      { id: "earlier", text: "Antes", from: "match_amanda_01", sentAt: "2026-10-06T14:30:00Z" },
      { id: "later", text: "Duplicada no lote", from: "match_amanda_01", sentAt: "2026-10-06T10:00:00-05:00" },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.newMessagesCount, 2);
  assert.equal(result.latestInboundMessageId, "tinder_msg_later");
  assert.equal(result.latestMessageCursor, "2026-10-06T10:00:00-05:00");
});

test("13. Reader de background consulta o índice de canais uma vez por execução e busca cada match", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ url, body });
    if (url.includes("/v1/chat/channels/query")) {
      return new Response(JSON.stringify({
        channels: [
          { channel_id: { id: "channel_a", reference_id: "match_a" } },
          { channel_id: { id: "channel_b", reference_id: "match_b" } },
        ],
        pagination_info: { has_next_page: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/v1/chat/channels/messages/query")) {
      const channelId = body.channel_id?.id;
      const matchId = channelId === "channel_a" ? "match_a" : "match_b";
      return new Response(JSON.stringify({
        messages: [{
          message_id: { id: `message_${matchId}` },
          sender_id: { id: matchId },
          content: { text: { message: `Oi de ${matchId}` } },
          created_at: "2026-10-06T12:00:00Z",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Endpoint inesperado no fetch simulado: ${url}`);
  };

  try {
    const mockDb = {
      from(table) {
        assert.equal(table, "match_tinder_config");
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { auth_token: "token-de-teste", user_id: "larissa" }, error: null }) }),
          }),
        };
      },
    };
    const readMessages = createTinderBackgroundMessageReader(mockDb);
    const [firstMatch, secondMatch] = await Promise.all([
      readMessages("match_a"),
      readMessages("match_b"),
    ]);

    assert.equal(firstMatch[0].text, "Oi de match_a");
    assert.equal(secondMatch[0].text, "Oi de match_b");
    assert.equal(requests.filter((request) => request.url.includes("/v1/chat/channels/query")).length, 2);
    assert.equal(requests.filter((request) => request.url.includes("/v1/chat/channels/messages/query")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("14. Reader de background percorre páginas de mensagens antes de retornar o lote", async () => {
  const originalFetch = globalThis.fetch;
  const messageRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.includes("/v1/chat/channels/query")) {
      return new Response(JSON.stringify({
        channels: [{ channel_id: { id: "channel_page", reference_id: "match_pages" } }],
        pagination_info: { has_next_page: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/v1/chat/channels/messages/query")) {
      messageRequests.push(body.pagination_params);
      const isSecondPage = Boolean(body.pagination_params?.backward_page_token);
      const messageId = isSecondPage ? "older_message" : "newer_message";
      return new Response(JSON.stringify({
        messages: [{
          message_id: { id: messageId },
          sender_id: { id: "match_pages" },
          content: { text: { message: messageId } },
          created_at: isSecondPage ? "2026-10-06T11:59:00Z" : "2026-10-06T12:01:00Z",
        }],
        pagination_info: isSecondPage
          ? { has_next_page: false }
          : { has_next_page: true, next_backward_page_token: "older-page" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Endpoint inesperado no fetch simulado: ${url}`);
  };

  try {
    const mockDb = {
      from(table) {
        assert.equal(table, "match_tinder_config");
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { auth_token: "token-de-teste", user_id: "larissa" }, error: null }) }),
          }),
        };
      },
    };
    const readMessages = createTinderBackgroundMessageReader(mockDb);
    const messages = await readMessages("match_pages");

    assert.deepEqual(messages.map((message) => message.id), ["older_message", "newer_message"]);
    assert.equal(messageRequests.length, 2);
    assert.equal(messageRequests[1].backward_page_token, "older-page");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("15. Reader de background falha fechado quando a paginação não termina no limite", async () => {
  const originalFetch = globalThis.fetch;
  let messagePage = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/v1/chat/channels/query")) {
      return new Response(JSON.stringify({
        channels: [{ channel_id: { id: "channel_overflow", reference_id: "match_overflow" } }],
        pagination_info: { has_next_page: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/v1/chat/channels/messages/query")) {
      messagePage += 1;
      return new Response(JSON.stringify({
        messages: [{
          message_id: { id: `message_${messagePage}` },
          sender_id: { id: "match_overflow" },
          content: { text: { message: "mensagem" } },
          created_at: "2026-10-06T12:00:00Z",
        }],
        pagination_info: { has_next_page: true, next_backward_page_token: `page-${messagePage}` },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Endpoint inesperado no fetch simulado: ${url}`);
  };

  try {
    const mockDb = {
      from(table) {
        assert.equal(table, "match_tinder_config");
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { auth_token: "token-de-teste", user_id: "larissa" }, error: null }) }),
          }),
        };
      },
    };
    const readMessages = createTinderBackgroundMessageReader(mockDb);

    await assert.rejects(readMessages("match_overflow"), /TINDER_MESSAGE_PAGINATION_INCOMPLETE/);
    assert.equal(messagePage, 12);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("16. Reader incremental busca uma janela sobreposta para captar atraso e ordem tardia", async () => {
  const originalFetch = globalThis.fetch;
  const messageRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.includes("/v1/chat/channels/query")) {
      return new Response(JSON.stringify({
        channels: [{ channel_id: { id: "channel_cursor", reference_id: "match_cursor" } }],
        pagination_info: { has_next_page: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/v1/chat/channels/messages/query")) {
      messageRequests.push(body.pagination_params);
      const page = body.pagination_params?.backward_page_token === "older-page"
        ? 2
        : body.pagination_params?.backward_page_token === "oldest-page"
          ? 3
          : 1;
      const createdAt = page === 1
        ? "2026-10-06T12:01:00Z"
        : page === 2
          ? "2026-10-06T11:55:00Z"
          : "2026-10-06T11:40:00Z";
      return new Response(JSON.stringify({
        messages: [{
          message_id: { id: `cursor_message_${page}` },
          sender_id: { id: "match_cursor" },
          content: { text: { message: `pagina ${page}` } },
          created_at: createdAt,
        }],
        pagination_info: page === 1
          ? { has_next_page: true, next_backward_page_token: "older-page" }
          : page === 2
            ? { has_next_page: true, next_backward_page_token: "oldest-page" }
            : { has_next_page: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Endpoint inesperado no fetch simulado: ${url}`);
  };

  try {
    const mockDb = {
      from(table) {
        assert.equal(table, "match_tinder_config");
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { auth_token: "token-de-teste", user_id: "larissa" }, error: null }) }),
          }),
        };
      },
    };
    const readMessages = createTinderBackgroundMessageReader(mockDb);
    const messages = await readMessages("match_cursor", "2026-10-06T12:00:00Z");

    assert.deepEqual(messages.map((message) => message.id), ["cursor_message_2", "cursor_message_1"]);
    assert.equal(messageRequests.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("16a. Mensagem atrasada não faz o cursor de sincronização retroceder", async () => {
  const db = createIntegrationMockDb();
  const cursorStorage = new Map([[
    "match_amanda_01",
    "2026-10-06T12:10:00Z",
  ]]);
  let receivedCursor = null;

  const result = await processTinderBackgroundSync({
    supabase: db,
    cursorStore: {
      getCursor: async () => cursorStorage.get("match_amanda_01") || null,
      setCursor: async (matchId, cursor) => cursorStorage.set(matchId, cursor),
    },
    cursorStorage,
    testMockFetchMessages: async (_matchId, sinceDate) => {
      receivedCursor = sinceDate;
      return [{
        id: "late_provider_message_16a",
        text: "Cheguei atrasado no lote",
        from: "match_amanda_01",
        isMine: false,
        sentAt: "2026-10-06T12:02:00Z",
      }];
    },
    rateLimitMs: 0,
  });

  assert.equal(receivedCursor, "2026-10-06T12:10:00Z");
  assert.equal(result.newInboundTotal, 1);
  assert.equal(cursorStorage.get("match_amanda_01"), "2026-10-06T12:10:00Z");
  assert.equal(
    db._state.messages.some((message) => message.id === "tinder_msg_late_provider_message_16a"),
    true,
  );
});

test("17. Ativação prepara histórico Tinder e cronograma compartilhado sem ligar a IA", async () => {
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  const secret = "match-session-secret-test";
  const sessionHash = createHash("sha256").update(secret).digest("hex");
  globalThis.Deno = { env: { get: (name) => name === "ENABLE_TINDER_LIVE_SYNC" || name === "ENABLE_TINDER_LIVE_DISPATCH" ? "true" : undefined } };
  const providerRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    providerRequests.push({ url, body });
    if (url.includes("/v1/chat/channels/query")) {
      return new Response(JSON.stringify({
        channels: [{ channel_id: { id: "channel_prepare", reference_id: "match_prepare_17" } }],
        pagination_info: { has_next_page: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/v1/chat/channels/messages/query")) {
      return new Response(JSON.stringify({
        messages: [{
          message_id: { id: "provider_message_prepare_17" },
          sender_id: { id: "match_prepare_17" },
          content: { text: { message: "Oi, tudo bem?" } },
          created_at: "2026-10-06T12:10:00Z",
        }],
        pagination_info: { has_next_page: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Endpoint inesperado no fetch simulado: ${url}`);
  };

  try {
    const db = createIntegrationMockDb();
    const originalFrom = db.from.bind(db);
    db.from = (table) => {
      if (table === "match_tinder_config") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: {
              auth_token: "token-de-teste",
              session_hash: sessionHash,
              user_id: "larissa",
            }, error: null }) }),
          }),
        };
      }
      return originalFrom(table);
    };
    const originalRpc = db.rpc.bind(db);
    db.rpc = async (name, args) => {
      if (name === "link_conversation_channel_identity_atomic") {
        db._state.identities.push({
          conversation_id: args.p_conversation_id,
          channel: args.p_channel,
          external_identity_id: args.p_external_identity_id,
          status: args.p_status,
        });
        return { data: { success: true, is_new: true, collision: false }, error: null };
      }
      if (name === "ensure_conversation_schedule_run_atomic") {
        return { data: {
          success: true,
          schedule_id: "schedule_shared",
          schedule_name: "Cronograma compartilhado",
          current_stage_id: "stage_first",
        }, error: null };
      }
      return originalRpc(name, args);
    };

    const response = await handleTinderMatchRoutes({
      request: new Request("https://vendeo.test/api/match/tinder/ai/match_prepare_17/prepare", {
        method: "POST",
        headers: { "x-match-session": secret, "content-type": "application/json" },
        body: JSON.stringify({ name: "Amanda", avatar: "https://images.example/amanda.jpg" }),
      }),
      path: "/match/tinder/ai/match_prepare_17/prepare",
      supabase: db,
      corsHeaders: {},
      originAllowed: true,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.conversationId, "tinder:match_prepare_17");
    assert.equal(payload.importedMessages, 1);
    assert.equal(payload.schedule.name, "Cronograma compartilhado");
    assert.equal(db._state.conversations.find((row) => row.id === payload.conversationId).ai_auto_respond, false);
    assert.equal(db._state.messages.some((row) => row.id === "tinder_msg_provider_message_prepare_17"), true);
    assert.equal(providerRequests.filter((request) => request.url.includes("/v1/chat/channels/query")).length, 2);
    assert.equal(providerRequests.filter((request) => request.url.includes("/v1/chat/channels/messages/query")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
});
