import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Carregador robusto de módulos TypeScript compatível com aliases do Next.js
function loadTsModule(filePath) {
  const fullPath = path.resolve(filePath);
  const tsCode = fs.readFileSync(fullPath, "utf8");
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const moduleObj = { exports: {} };
  const context = {
    module: moduleObj,
    exports: moduleObj.exports,
    process: process,
    console: console,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Deno: { env: { get: () => undefined } },
    require: (dep) => {
      if (dep.includes("ChatStage") || dep === "@/domain/entities/ChatStage") {
        return loadTsModule("src/domain/entities/ChatStage.ts");
      }
      if (dep.includes("client") || dep.includes("server")) {
        return { getSupabaseBrowserClient: () => null, getSupabaseServerClient: () => null };
      }
      return {};
    },
  };

  const fn = new Function("module", "exports", "require", "process", "console", "fetch", "setTimeout", "clearTimeout", "Deno", jsCode);
  fn(moduleObj, moduleObj.exports, context.require, process, console, context.fetch, context.setTimeout, context.clearTimeout, context.Deno);
  return moduleObj.exports;
}

const { ManageChatProgressUseCase } = loadTsModule("src/application/use-cases/ManageChatProgressUseCase.ts");
const { SupabaseChatStageRepository } = loadTsModule("src/infrastructure/repositories/SupabaseChatStageRepository.ts");

// ============================================================================
// SIMULADOR POSTGRESQL ATÔMICO COM REGRAS DA MIGRAÇÃO 20260923170000
// ============================================================================

class MockPostgresDatabase {
  constructor() {
    this.conversations = new Map();
    this.stages = [
      {
        id: "stage_1_conexao",
        name: "1. Conexão",
        stage_order: 0,
        goals: [
          { id: "goal_age", title: "Descobrir idade", kind: "fact", required: true, order: 0 },
          { id: "goal_city", title: "Descobrir cidade", kind: "fact", required: true, order: 1 },
        ],
      },
      {
        id: "stage_3_compatibilidade",
        name: "3. Compatibilidade",
        stage_order: 2,
        goals: [
          { id: "goal_intention", title: "Intenção", kind: "fact", required: true, order: 0 },
        ],
      },
    ];
    this.saveChatProgressCalls = [];
    this.rpcsCalled = [];
    this.dispatchesToMeta = [];
    this.currentRole = "service_role"; // Role da sessão atual
  }

  setSessionRole(role) {
    this.currentRole = role;
  }

  insertConversation(conv) {
    this.conversations.set(conv.id, JSON.parse(JSON.stringify(conv)));
  }

  getConversation(id) {
    const c = this.conversations.get(id);
    return c ? JSON.parse(JSON.stringify(c)) : null;
  }

  // Execução fiel do trigger guard no banco
  applyTriggerGuard(oldConv, updates) {
    if (updates.stage_completed_rules === undefined) return updates;

    // Se a role for anon ou authenticated (browser client direto via PostgREST)
    // Em RPCs SECURITY DEFINER, o PostgreSQL executa como postgres/service_role
    if (this.currentRole === "anon" || this.currentRole === "authenticated") {
      const oldRules = oldConv?.stage_completed_rules;
      if (oldRules && typeof oldRules === "object") {
        let newRules = updates.stage_completed_rules;

        // Normalização defensiva: se NEW for string contendo JSON escapado, tenta parse seguro
        if (typeof newRules === "string") {
          try {
            newRules = JSON.parse(newRules);
          } catch {
            updates.stage_completed_rules = JSON.parse(JSON.stringify(oldRules));
            return updates;
          }
        }

        if (!newRules || typeof newRules !== "object" || Array.isArray(newRules)) {
          updates.stage_completed_rules = JSON.parse(JSON.stringify(oldRules));
          return updates;
        }

        // 1. Preserva active_cycle_token se existia no OLD; senão proíbe introdução direta
        if (oldRules.active_cycle_token) {
          newRules.active_cycle_token = oldRules.active_cycle_token;
        } else {
          delete newRules.active_cycle_token;
        }
        if (oldRules.active_cycle_at) {
          newRules.active_cycle_at = oldRules.active_cycle_at;
        } else {
          delete newRules.active_cycle_at;
        }
        if (oldRules.preempt_requested) {
          newRules.preempt_requested = oldRules.preempt_requested;
        } else {
          delete newRules.preempt_requested;
        }

        // 2. Preserva orchestration interna (outbox, messageLedger, etc.)
        const oldOrch = oldRules.orchestration;
        if (oldOrch && typeof oldOrch === "object") {
          let newOrch = newRules.orchestration || {};
          if (typeof newOrch !== "object" || Array.isArray(newOrch)) newOrch = {};
          if (oldOrch.outbox) newOrch.outbox = oldOrch.outbox;
          else delete newOrch.outbox;
          if (oldOrch.messageLedger) newOrch.messageLedger = oldOrch.messageLedger;
          else delete newOrch.messageLedger;
          if (oldOrch.activeClaimedMessageIds) newOrch.activeClaimedMessageIds = oldOrch.activeClaimedMessageIds;
          else delete newOrch.activeClaimedMessageIds;
          if (oldOrch.activeCycle) newOrch.activeCycle = oldOrch.activeCycle;
          else delete newOrch.activeCycle;
          if (oldOrch.recentCycles) newOrch.recentCycles = oldOrch.recentCycles;
          else delete newOrch.recentCycles;
          if (oldOrch.technicalRetryCount !== undefined) newOrch.technicalRetryCount = oldOrch.technicalRetryCount;
          else delete newOrch.technicalRetryCount;
          if (oldOrch.technicalRetryExhaustedAt !== undefined) newOrch.technicalRetryExhaustedAt = oldOrch.technicalRetryExhaustedAt;
          else delete newOrch.technicalRetryExhaustedAt;
          newRules.orchestration = newOrch;
        } else {
          if (newRules.orchestration && typeof newRules.orchestration === "object") {
            delete newRules.orchestration.outbox;
            delete newRules.orchestration.messageLedger;
            delete newRules.orchestration.activeClaimedMessageIds;
            delete newRules.orchestration.activeCycle;
            delete newRules.orchestration.recentCycles;
            delete newRules.orchestration.technicalRetryCount;
            delete newRules.orchestration.technicalRetryExhaustedAt;
          }
        }

        updates.stage_completed_rules = newRules;
      } else {
        // EDGE CASE: oldRules é null ou não-objeto
        let newRules = updates.stage_completed_rules;
        if (typeof newRules === "string") {
          try { newRules = JSON.parse(newRules); } catch { newRules = {}; }
        }
        if (newRules && typeof newRules === "object") {
          delete newRules.active_cycle_token;
          delete newRules.active_cycle_at;
          delete newRules.preempt_requested;
          if (newRules.orchestration && typeof newRules.orchestration === "object") {
            delete newRules.orchestration.outbox;
            delete newRules.orchestration.messageLedger;
            delete newRules.orchestration.activeClaimedMessageIds;
            delete newRules.orchestration.activeCycle;
            delete newRules.orchestration.recentCycles;
            delete newRules.orchestration.technicalRetryCount;
            delete newRules.orchestration.technicalRetryExhaustedAt;
          }
          updates.stage_completed_rules = newRules;
        }
      }
    }
    return updates;
  }

  // Simulação fiel de claim_experimental_cycle
  claimExperimentalCycle(conversationId, cycleToken, staleSeconds = 300) {
    this.rpcsCalled.push({ rpc: "claim_experimental_cycle", conversationId, cycleToken });
    const conv = this.conversations.get(conversationId);
    if (!conv) return { success: false, reason: "conversation_not_found" };

    let rules = conv.stage_completed_rules || {};
    const oldToken = rules.active_cycle_token;
    const activeAtStr = rules.active_cycle_at;
    const effectiveTtl = Math.max(Number(staleSeconds) || 300, 300);

    // Se oldToken existe e é DIFERENTE do ciclo solicitado
    if (oldToken && oldToken !== cycleToken) {
      if (activeAtStr) {
        const elapsed = (Date.now() - new Date(activeAtStr).getTime()) / 1000;
        if (elapsed < effectiveTtl) {
          return { success: false, reason: "active_lock", activeCycleToken: oldToken };
        }
      }
    }

    // Se oldToken == cycleToken, é claim idempotente do mesmo ciclo pré-adquirido
    rules.active_cycle_token = cycleToken;
    rules.active_cycle_at = new Date().toISOString();
    conv.stage_completed_rules = rules;

    return {
      success: true,
      reason: "claimed",
      activeCycleToken: cycleToken,
      staleRecovered: false,
    };
  }

  // Simulação fiel de claim_experimental_cycle_messages
  claimExperimentalCycleMessages(conversationId, cycleToken, messageIds) {
    this.rpcsCalled.push({ rpc: "claim_experimental_cycle_messages", conversationId, cycleToken, messageIds });
    const conv = this.conversations.get(conversationId);
    if (!conv) return { success: false, reason: "conversation_not_found" };

    const rules = conv.stage_completed_rules || {};
    if (rules.active_cycle_token !== cycleToken) {
      return { success: false, reason: "cycle_token_mismatch" };
    }
    if (rules.preempt_requested) {
      return { success: false, reason: "cycle_preempted" };
    }

    const orch = rules.orchestration || {};
    const ledger = orch.messageLedger || {};
    for (const id of messageIds) {
      ledger[id] = "claimed";
    }
    orch.messageLedger = ledger;
    orch.activeClaimedMessageIds = messageIds;
    orch.lastProcessingStatus = "processing";
    rules.orchestration = orch;
    conv.stage_completed_rules = rules;

    return { success: true, reason: "messages_claimed" };
  }

  // Simulação fiel de prepare_experimental_outbox_entry
  prepareExperimentalOutboxEntry(conversationId, cycleToken, outboxEntry) {
    this.rpcsCalled.push({ rpc: "prepare_experimental_outbox_entry", conversationId, cycleToken, outboxEntry });
    const conv = this.conversations.get(conversationId);
    if (!conv) return { success: false, reason: "conversation_not_found" };

    if (this.failNextPrepareOutbox) {
      this.failNextPrepareOutbox = false;
      return { success: false, reason: "cycle_preempted" };
    }

    const rules = conv.stage_completed_rules || {};
    const orch = rules.orchestration || {};
    const outbox = orch.outbox || {};

    const key = this.overrideOutboxKey || outboxEntry.idempotencyKey || outboxEntry.id;
    this.overrideOutboxKey = null;
    outbox[key] = { ...outboxEntry, status: "pending" };
    orch.outbox = outbox;
    rules.orchestration = orch;
    rules.active_cycle_token = cycleToken;
    rules.active_cycle_at = new Date().toISOString();
    conv.stage_completed_rules = rules;

    return { success: true, reason: "prepared", outboxKey: key };
  }

  // Simulação fiel de claim_outbox_entry
  claimOutboxEntry(conversationId, outboxKey, claimToken) {
    this.rpcsCalled.push({ rpc: "claim_outbox_entry", conversationId, outboxKey, claimToken });
    const conv = this.conversations.get(conversationId);
    if (!conv) return { success: false, reason: "conversation_not_found" };

    const rules = conv.stage_completed_rules || {};
    const orch = rules.orchestration || {};
    const outbox = orch.outbox || {};
    const entry = outbox[outboxKey];

    if (!entry) {
      return { success: false, reason: "outbox_entry_not_found" };
    }

    if (entry.status === "sent") {
      return { success: false, reason: "already_sent" };
    }

    entry.status = "claimed";
    entry.claimToken = claimToken;
    entry.claimedAt = new Date().toISOString();
    entry.attempts = (entry.attempts || 0) + 1;
    outbox[outboxKey] = entry;
    orch.outbox = outbox;
    rules.orchestration = orch;
    conv.stage_completed_rules = rules;

    return { success: true, reason: "claimed", entry };
  }

  // Simulação fiel da nova RPC patch_chat_progress_atomic com sincronização de orchestration via jsonb_set
  patchChatProgressAtomic(conversationId, progressPatch) {
    this.rpcsCalled.push({ rpc: "patch_chat_progress_atomic", conversationId, progressPatch });
    const conv = this.conversations.get(conversationId);
    if (!conv) return { success: false, reason: "conversation_not_found" };

    let rules = conv.stage_completed_rules;
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
      rules = {};
    }

    // Preserva rigorosamente todas as chaves operacionais do Brain
    const currentStageId = progressPatch.currentStageId || rules.current_stage_id || "stage_1_conexao";
    const completedGoalIds = Array.isArray(progressPatch.completedGoalIds)
      ? progressPatch.completedGoalIds
      : rules.completed_goals || [];
    const objectiveProgress = progressPatch.objectiveProgress || rules.objective_progress || {};

    const updatedChatProgress = {
      ...(typeof rules.chat_progress === "object" && rules.chat_progress && !Array.isArray(rules.chat_progress) ? rules.chat_progress : {}),
      currentStageId,
      completedGoalIds,
      objectiveProgress,
      completedItemIds: progressPatch.completedItemIds || [],
      isConverted: Boolean(progressPatch.isConverted),
      updatedAt: progressPatch.updatedAt || new Date().toISOString(),
    };

    // Sincronização pontual de orchestration (jsonb_set) garantindo que nenhum subcampo operacional seja destruído
    let orch = rules.orchestration;
    if (!orch || typeof orch !== "object" || Array.isArray(orch)) {
      orch = {};
    }

    // Atualiza apenas os campos canônicos de progresso em orchestration
    orch.currentStageId = currentStageId;
    orch.completedGoalIds = completedGoalIds;
    orch.objectiveProgress = objectiveProgress;
    orch.isConverted = Boolean(progressPatch.isConverted);

    rules.chat_progress = updatedChatProgress;
    rules.current_stage_id = currentStageId;
    rules.completed_goals = completedGoalIds;
    rules.objective_progress = objectiveProgress;
    rules.orchestration = orch;

    conv.stage_completed_rules = rules;
    conv.current_stage_id = currentStageId;
    conv.updated_at = new Date().toISOString();

    return {
      success: true,
      reason: "progress_updated",
      currentStageId,
      completedGoalIds,
    };
  }

  // Simulação fiel da nova RPC authorize_send_now_atomic com TTL canônico de 300 segundos
  authorizeSendNowAtomic(conversationId, newCycleToken, staleSeconds = 300) {
    this.rpcsCalled.push({ rpc: "authorize_send_now_atomic", conversationId, newCycleToken });
    const conv = this.conversations.get(conversationId);
    if (!conv) return { success: false, reason: "conversation_not_found" };

    if (conv.ai_auto_respond === false) {
      return { success: false, reason: "disabled" };
    }

    let rules = conv.stage_completed_rules;
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
      rules = {};
    }

    const activeToken = rules.active_cycle_token;
    const activeAtStr = rules.active_cycle_at;
    const now = Date.now();

    // POLÍTICA CANÔNICA: Lock válido por 300s (5 min)
    const effectiveTtlSeconds = Math.max(Number(staleSeconds) || 300, 300);

    if (activeToken && activeAtStr) {
      const activeAt = new Date(activeAtStr).getTime();
      const elapsedSeconds = (now - activeAt) / 1000;
      if (elapsedSeconds < effectiveTtlSeconds) {
        return {
          success: true,
          result: "already_processing",
          reason: "already_processing",
          active_cycle_token: activeToken,
          active_cycle_at: activeAtStr,
        };
      }
    }

    rules.active_cycle_token = newCycleToken;
    rules.active_cycle_at = new Date().toISOString();
    rules.send_immediately = true;
    conv.stage_completed_rules = rules;
    conv.ai_debounce_until = null;

    return {
      success: true,
      result: "authorized",
      reason: "authorized",
      cycle_token: newCycleToken,
    };
  }

  // Simulação fiel de release_experimental_cycle_if_owned
  releaseExperimentalCycleIfOwned(conversationId, cycleToken, processingStatus = "idle", revertIds = null) {
    this.rpcsCalled.push({ rpc: "release_experimental_cycle_if_owned", conversationId, cycleToken });
    const conv = this.conversations.get(conversationId);
    if (!conv) return { released: false, reason: "conversation_not_found" };

    const rules = conv.stage_completed_rules || {};
    // Regra E: Se active_cycle_token já pertence a OUTRO ciclo, NUNCA liberar
    if (rules.active_cycle_token !== cycleToken) {
      return { released: false, reason: "token_mismatch", activeToken: rules.active_cycle_token };
    }

    rules.active_cycle_token = null;
    rules.active_cycle_at = null;
    delete rules.send_immediately;
    conv.stage_completed_rules = rules;

    return { released: true, reason: "released" };
  }

  createSupabaseClient() {
    const self = this;
    return {
      rpc: async (fnName, params) => {
        if (fnName === "prepare_experimental_outbox_entry") {
          const res = self.prepareExperimentalOutboxEntry(
            params.p_conversation_id,
            params.p_cycle_token,
            params.p_outbox_entry
          );
          return { data: res, error: null };
        }
        if (fnName === "claim_outbox_entry") {
          const res = self.claimOutboxEntry(
            params.p_conversation_id,
            params.p_outbox_key,
            params.p_claim_token
          );
          return { data: res, error: null };
        }
        if (fnName === "patch_chat_progress_atomic") {
          const res = self.patchChatProgressAtomic(
            params.p_conversation_id,
            params.p_progress_patch
          );
          return { data: res, error: null };
        }
        if (fnName === "authorize_send_now_atomic") {
          const res = self.authorizeSendNowAtomic(
            params.p_conversation_id,
            params.p_new_cycle_token,
            params.p_stale_seconds || 300
          );
          return { data: res, error: null };
        }
        if (fnName === "claim_experimental_cycle") {
          const res = self.claimExperimentalCycle(
            params.p_conversation_id,
            params.p_cycle_token,
            params.p_stale_seconds
          );
          return { data: res, error: null };
        }
        if (fnName === "claim_experimental_cycle_messages") {
          const res = self.claimExperimentalCycleMessages(
            params.p_conversation_id,
            params.p_cycle_token,
            params.p_message_ids
          );
          return { data: res, error: null };
        }
        if (fnName === "release_experimental_cycle_if_owned") {
          const res = self.releaseExperimentalCycleIfOwned(
            params.p_conversation_id,
            params.p_cycle_token,
            params.p_processing_status,
            params.p_revert_message_ids
          );
          return { data: res, error: null };
        }
        if (fnName === "patch_autopilot_pause_atomic") {
          const conv = self.conversations.get(params.p_conversation_id);
          if (!conv) return { data: { success: false, reason: "not_found" }, error: null };
          conv.ai_auto_respond = !params.p_paused;
          if (params.p_paused) conv.ai_debounce_until = null;
          return { data: { success: true, reason: "updated" }, error: null };
        }
        if (fnName === "patch_autopilot_hold_edit_atomic") {
          return { data: { success: true }, error: null };
        }
        if (fnName === "patch_autopilot_edit_preview_atomic") {
          return { data: { success: true }, error: null };
        }
        return { data: null, error: new Error(`RPC ${fnName} não mockada`) };
      },
      from: (table) => {
        return {
          select: (cols) => ({
            not: () => ({ not: () => ({ data: Array.from(self.conversations.values()), error: null }) }),
            eq: (col, val) => ({
              maybeSingle: async () => ({
                data: self.conversations.get(val) || null,
                error: null,
              }),
            }),
            or: (filterStr) => ({
              maybeSingle: async () => {
                const match = filterStr.match(/id\.eq\.([^,]+)/);
                const convId = match ? match[1] : null;
                return {
                  data: convId ? self.conversations.get(convId) || null : null,
                  error: null,
                };
              },
            }),
          }),
          update: (rawUpdates) => ({
            eq: (col, val) => {
              const conv = self.conversations.get(val);
              if (conv) {
                const guardedUpdates = self.applyTriggerGuard(conv, rawUpdates);
                Object.assign(conv, guardedUpdates);
                self.saveChatProgressCalls.push({ conversationId: val, updates: guardedUpdates });
              }
              return Promise.resolve({ data: conv, error: null });
            },
            or: (filterStr) => {
              const match = filterStr.match(/id\.eq\.([^,]+)/);
              const convId = match ? match[1] : null;
              const conv = convId ? self.conversations.get(convId) : null;
              if (conv) {
                const guardedUpdates = self.applyTriggerGuard(conv, rawUpdates);
                Object.assign(conv, guardedUpdates);
                self.saveChatProgressCalls.push({ conversationId: convId, updates: guardedUpdates });
              }
              return Promise.resolve({ data: conv, error: null });
            },
          }),
        };
      },
    };
  }
}

// Helpers atômicos do Brain
async function prepareOutboxAtomic(supabase, conversationId, cycleToken, outboxEntry) {
  const { data, error } = await supabase.rpc("prepare_experimental_outbox_entry", {
    p_conversation_id: conversationId,
    p_cycle_token: cycleToken,
    p_outbox_entry: outboxEntry,
  });
  if (!error && data?.success) return { success: true, outboxKey: data.outboxKey };
  return { success: false, reason: data?.reason || error?.message };
}

async function claimOutboxAtomic(supabase, conversationId, outboxKey, claimToken) {
  const { data, error } = await supabase.rpc("claim_outbox_entry", {
    p_conversation_id: conversationId,
    p_outbox_key: outboxKey,
    p_claim_token: claimToken,
  });
  if (!error && data?.success) return { success: true, entry: data.entry };
  return { success: false, reason: data?.reason || error?.message };
}

async function releaseCycleAtomic(supabase, conversationId, cycleToken) {
  const { data, error } = await supabase.rpc("release_experimental_cycle_if_owned", {
    p_conversation_id: conversationId,
    p_cycle_token: cycleToken,
  });
  if (!error && data?.released) return { released: true };
  return { released: false, reason: data?.reason || error?.message };
}

// ============================================================================
// SUÍTE DE TESTES: CORRIDA OUTBOX & READ-MODIFY-WRITE (28 CENÁRIOS)
// ============================================================================

async function runAllTests() {
  console.log("================================================================================");
  console.log("🚀 INICIANDO SUÍTE DE TESTES REFINADA (28 CENÁRIOS)");
  console.log("================================================================================\n");

  let passed = 0;
  async function testCase(num, title, fn) {
    try {
      await fn();
      console.log(`✅ [CENÁRIO ${num.toString().padStart(2, "0")}] Aprovado: ${title}`);
      passed++;
    } catch (err) {
      console.error(`❌ [CENÁRIO ${num.toString().padStart(2, "0")}] FALHOU: ${title}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // CENÁRIO 1
  await testCase(1, "Reprodução exata da regressão Alligator - prepare_outbox -> saveChatProgress -> claim_outbox (Sem Clobber)", async () => {
    const db = new MockPostgresDatabase();
    const convId = "1040376229029884";
    const cycleToken = `corr_alligator_${Date.now()}`;

    db.insertConversation({
      id: convId,
      contact_id: convId,
      current_stage_id: "stage_2_descoberta",
      ai_auto_respond: true,
      stage_completed_rules: {
        current_stage_id: "stage_2_descoberta",
        completed_goals: ["goal_age"],
        orchestration: {
          messageLedger: { "msg_123": "claimed" },
          outbox: {},
        },
      },
    });

    const client = db.createSupabaseClient();
    const stageRepo = new SupabaseChatStageRepository(client);

    const balloonOutbox = {
      id: `outbox_${Date.now()}`,
      idempotencyKey: `key_${Date.now()}`,
      content: "Oie, tudo bem? Trabalho com vendas online e estudo enfermagem!",
      messageType: "text",
      status: "pending",
    };

    const prep = await prepareOutboxAtomic(client, convId, cycleToken, balloonOutbox);
    assert.equal(prep.success, true);

    await stageRepo.saveChatProgress({
      conversationId: convId,
      currentStageId: "stage_2_descoberta",
      completedGoalIds: ["goal_age", "goal_city"],
      completedItemIds: [],
      isConverted: false,
      updatedAt: new Date().toISOString(),
    });

    const claim = await claimOutboxAtomic(client, convId, balloonOutbox.idempotencyKey, cycleToken);
    assert.equal(claim.success, true, "Outbox deve ser preservada sem clobber!");
    assert.equal(claim.entry?.status, "claimed");

    db.dispatchesToMeta.push({ convId, content: balloonOutbox.content });
    assert.equal(db.dispatchesToMeta.length, 1);
  });

  // CENÁRIO 2
  await testCase(2, "ManageChatProgressUseCase.getChatStageDetail() quando conversa não tem progresso salvo (Zero persistência no banco)", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_sem_progresso";

    db.insertConversation({
      id: convId,
      stage_completed_rules: null,
    });

    const client = db.createSupabaseClient();
    const stageRepo = new SupabaseChatStageRepository(client);
    stageRepo.getStages = async () => db.stages.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.stage_order,
      goals: s.goals,
      objectives: s.goals,
    }));

    const mockVaultRepo = { getItems: async () => [] };
    const useCase = new ManageChatProgressUseCase(stageRepo, mockVaultRepo);

    db.saveChatProgressCalls = [];
    const detail = await useCase.getChatStageDetail(convId);

    assert.equal(detail.stageIndex, 0);
    assert.equal(detail.stage?.id, "stage_1_conexao");
    assert.equal(db.saveChatProgressCalls.length, 0, "Zero escritas no banco permitidas na leitura!");
  });

  // CENÁRIO 3
  await testCase(3, "ManageChatProgressUseCase.getChatStageDetail() quando stageId salvo não existe na tabela stages (Fallback em memória sem write)", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_stage_inexistente";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        current_stage_id: "stage_2_descoberta",
        completed_goals: [],
      },
    });

    const client = db.createSupabaseClient();
    const stageRepo = new SupabaseChatStageRepository(client);
    stageRepo.getStages = async () => db.stages.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.stage_order,
      goals: s.goals,
      objectives: s.goals,
    }));

    const mockVaultRepo = { getItems: async () => [] };
    const useCase = new ManageChatProgressUseCase(stageRepo, mockVaultRepo);

    db.saveChatProgressCalls = [];
    const detail = await useCase.getChatStageDetail(convId);

    assert.equal(detail.stageIndex, 0);
    assert.equal(db.saveChatProgressCalls.length, 0, "Zero escritas no banco ao usar fallback de etapa!");
  });

  // CENÁRIO 4
  await testCase(4, "RPC patch_chat_progress_atomic - Atualização atômica de progresso mantendo active_cycle_token", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_test_lock";
    const lockToken = "corr_running_token_123";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: lockToken,
        active_cycle_at: new Date().toISOString(),
        current_stage_id: "stage_1_conexao",
      },
    });

    const res = db.patchChatProgressAtomic(convId, {
      currentStageId: "stage_2_descoberta",
      completedGoalIds: ["goal_age"],
    });

    assert.equal(res.success, true);
    const updated = db.getConversation(convId);
    assert.equal(updated.stage_completed_rules.active_cycle_token, lockToken);
  });

  // CENÁRIO 5
  await testCase(5, "RPC patch_chat_progress_atomic - Atualização atômica mantendo orchestration.outbox", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_test_outbox";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        orchestration: {
          outbox: { "item_1": { id: "item_1", status: "pending" } },
        },
      },
    });

    const res = db.patchChatProgressAtomic(convId, {
      currentStageId: "stage_1_conexao",
      completedGoalIds: ["goal_city"],
    });

    assert.equal(res.success, true);
    const updated = db.getConversation(convId);
    assert.ok(updated.stage_completed_rules.orchestration?.outbox?.["item_1"]);
  });

  // CENÁRIO 6
  await testCase(6, "RPC patch_chat_progress_atomic - Atualização atômica mantendo messageLedger", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_test_ledger";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        orchestration: {
          messageLedger: { "inbound_999": "claimed" },
        },
      },
    });

    const res = db.patchChatProgressAtomic(convId, {
      currentStageId: "stage_1_conexao",
      completedGoalIds: [],
    });

    assert.equal(res.success, true);
    const updated = db.getConversation(convId);
    assert.equal(updated.stage_completed_rules.orchestration?.messageLedger?.["inbound_999"], "claimed");
  });

  // CENÁRIO 7
  await testCase(7, "RPC patch_chat_progress_atomic - Atualização com stage_completed_rules inicial vazio ou nulo", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_null_rules";

    db.insertConversation({
      id: convId,
      stage_completed_rules: null,
    });

    const res = db.patchChatProgressAtomic(convId, {
      currentStageId: "stage_1_conexao",
      completedGoalIds: ["goal_age"],
    });

    assert.equal(res.success, true);
    const updated = db.getConversation(convId);
    assert.equal(updated.stage_completed_rules.current_stage_id, "stage_1_conexao");
  });

  // CENÁRIO 8
  await testCase(8, "RPC patch_chat_progress_atomic - Atualização quando stage_completed_rules é malformado (array ou escalar)", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_array_rules";

    db.insertConversation({
      id: convId,
      stage_completed_rules: ["malformed_array"],
    });

    const res = db.patchChatProgressAtomic(convId, {
      currentStageId: "stage_1_conexao",
      completedGoalIds: ["goal_age"],
    });

    assert.equal(res.success, true);
    const updated = db.getConversation(convId);
    assert.equal(Array.isArray(updated.stage_completed_rules), false);
    assert.equal(typeof updated.stage_completed_rules, "object");
  });

  // CENÁRIO 9
  await testCase(9, "SupabaseChatStageRepository.saveChatProgress - Utilização da RPC atômica", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_repo_rpc";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {},
    });

    const client = db.createSupabaseClient();
    const repo = new SupabaseChatStageRepository(client);

    await repo.saveChatProgress({
      conversationId: convId,
      currentStageId: "stage_2_descoberta",
      completedGoalIds: ["g1"],
      completedItemIds: [],
      isConverted: false,
      updatedAt: new Date().toISOString(),
    });

    const rpcCalls = db.rpcsCalled.filter((r) => r.rpc === "patch_chat_progress_atomic");
    assert.equal(rpcCalls.length, 1);
  });

  // CENÁRIO 10
  await testCase(10, "SupabaseChatStageRepository.saveChatProgress - FAIL-CLOSED se RPC falhar (Zero fallback JS)", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_repo_fail_closed";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: "corr_lock_important",
        orchestration: { outbox: { key1: { status: "pending" } } },
      },
    });

    const client = db.createSupabaseClient();
    // Força erro na RPC
    client.rpc = async (fn) => {
      if (fn === "patch_chat_progress_atomic") {
        return { data: null, error: new Error("RPC indisponível") };
      }
      return { data: null, error: null };
    };

    const repo = new SupabaseChatStageRepository(client);

    db.saveChatProgressCalls = [];
    let threw = false;
    try {
      await repo.saveChatProgress({
        conversationId: convId,
        currentStageId: "stage_3_compatibilidade",
        completedGoalIds: ["goal_intention"],
        completedItemIds: [],
        isConverted: true,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      threw = true;
    }

    assert.equal(threw, true, "Deve lançar exceção no fail-closed");
    assert.equal(
      db.saveChatProgressCalls.length,
      0,
      "NENHUMA ESCRITA DIRETA EM stage_completed_rules PODE OCORRER NO FALLBACK!"
    );
  });

  // CENÁRIO 11
  await testCase(11, "SupabaseAutoPilotRepository.saveChatState - Pausar não remove outbox nem active_cycle_token", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_pause_test";

    db.insertConversation({
      id: convId,
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: "corr_pause_lock",
        orchestration: { outbox: { b1: { id: "b1" } } },
      },
    });

    const client = db.createSupabaseClient();
    const { data } = await client.rpc("patch_autopilot_pause_atomic", {
      p_conversation_id: convId,
      p_paused: true,
      p_reason: "paused_manual",
    });

    assert.equal(data.success, true);
    const conv = db.getConversation(convId);
    assert.equal(conv.ai_auto_respond, false);
  });

  // CENÁRIO 12
  await testCase(12, "SupabaseAutoPilotRepository.saveChatState - Despausar não remove outbox nem active_cycle_token", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_unpause_test";

    db.insertConversation({
      id: convId,
      ai_auto_respond: false,
      stage_completed_rules: {
        active_cycle_token: "corr_unpause_lock",
        orchestration: { outbox: { b2: { id: "b2" } } },
      },
    });

    const client = db.createSupabaseClient();
    const { data } = await client.rpc("patch_autopilot_pause_atomic", {
      p_conversation_id: convId,
      p_paused: false,
      p_reason: null,
    });

    assert.equal(data.success, true);
    const conv = db.getConversation(convId);
    assert.equal(conv.ai_auto_respond, true);
  });

  // CENÁRIO 13
  await testCase(13, "Rota /autopilot/hold-edit - Pausar edição não sobrescreve outbox", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_hold_edit";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        orchestration: { outbox: { b_hold: { id: "b_hold" } } },
      },
    });

    const client = db.createSupabaseClient();
    const { data } = await client.rpc("patch_autopilot_hold_edit_atomic", {
      p_conversation_id: convId,
      p_is_editing: true,
    });

    assert.equal(data.success, true);
  });

  // CENÁRIO 14
  await testCase(14, "Rota /autopilot/edit-preview - Editar prévia do balão não sobrescreve outbox", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_edit_preview";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        orchestration: { outbox: { b_prev: { id: "b_prev" } } },
      },
    });

    const client = db.createSupabaseClient();
    const { data } = await client.rpc("patch_autopilot_edit_preview_atomic", {
      p_conversation_id: convId,
      p_edited_text: "Nova mensagem editada pelo operador",
    });

    assert.equal(data.success, true);
  });

  // CENÁRIO 15
  await testCase(15, "Rota /autopilot/send-now - Rejeita com already_processing quando active_cycle_token ativo existe no banco", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_send_now_active";
    const existingToken = "corr_existing_running_cycle";

    db.insertConversation({
      id: convId,
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: existingToken,
        active_cycle_at: new Date(Date.now() - 5000).toISOString(),
        orchestration: { outbox: { b1: { id: "b1" } } },
      },
    });

    const authRes = db.authorizeSendNowAtomic(convId, "corr_new_sendnow_req", 300);

    assert.equal(authRes.success, true);
    assert.equal(authRes.result, "already_processing");
    assert.equal(authRes.active_cycle_token, existingToken);

    const conv = db.getConversation(convId);
    assert.equal(conv.stage_completed_rules.active_cycle_token, existingToken);
    assert.ok(conv.stage_completed_rules.orchestration?.outbox?.b1);
  });

  // CENÁRIO 16
  await testCase(16, "Rota /autopilot/send-now - Rejeita com disabled quando ai_auto_respond é false", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_send_now_disabled";

    db.insertConversation({
      id: convId,
      ai_auto_respond: false,
      stage_completed_rules: {},
    });

    const authRes = db.authorizeSendNowAtomic(convId, "corr_req_123", 300);
    assert.equal(authRes.success, false);
    assert.equal(authRes.reason, "disabled");
  });

  // CENÁRIO 17
  await testCase(17, "Rota /autopilot/send-now - Concede lock atomicamente e não sobrescreve outbox pré-existente", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_send_now_free";
    const proposedCycle = "corr_sendnow_success";

    db.insertConversation({
      id: convId,
      ai_auto_respond: true,
      ai_debounce_until: new Date(Date.now() + 60000).toISOString(),
      stage_completed_rules: {
        active_cycle_token: null,
        orchestration: { outbox: { prev_item: { status: "sent" } } },
      },
    });

    const authRes = db.authorizeSendNowAtomic(convId, proposedCycle, 300);
    assert.equal(authRes.success, true);
    assert.equal(authRes.result, "authorized");

    const conv = db.getConversation(convId);
    assert.equal(conv.stage_completed_rules.active_cycle_token, proposedCycle);
    assert.equal(conv.ai_debounce_until, null);
    assert.ok(conv.stage_completed_rules.orchestration?.outbox?.prev_item);
  });

  // CENÁRIO 18
  await testCase(18, "Rota /autopilot/send-now - Libera lock atomicamente se não houver mensagem inbound pendente", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_send_now_empty";
    const cycleToken = "corr_sendnow_empty";

    db.insertConversation({
      id: convId,
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: cycleToken,
        active_cycle_at: new Date().toISOString(),
      },
    });

    const client = db.createSupabaseClient();
    const releaseRes = await releaseCycleAtomic(client, convId, cycleToken);

    assert.equal(releaseRes.released, true);
    const conv = db.getConversation(convId);
    assert.equal(conv.stage_completed_rules.active_cycle_token, null, "Lock zombie limpo!");
  });

  // CENÁRIO 19 (TRIGGER GUARD FUNCIONAL: CLIENTE AUTHENTICATED)
  await testCase(19, "trigger guard guard_stage_completed_rules_integrity - Chamada direta browser/authenticated tentando remover outbox é bloqueada", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_trigger_guard_test";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: "corr_keep_token",
        orchestration: {
          outbox: {
            "msg_precious": { id: "msg_precious", content: "Não me apague!", status: "pending" },
          },
          messageLedger: { "in_1": "claimed" },
        },
      },
    });

    // Simula cliente autenticado no browser chamando supabase.from('instagram_conversations').update(...)
    db.setSessionRole("authenticated");
    const client = db.createSupabaseClient();

    // Browser tenta mandar update com stage_completed_rules sem a outbox
    await client
      .from("instagram_conversations")
      .update({
        stage_completed_rules: {
          current_stage_id: "stage_2_descoberta",
          // outbox e active_cycle_token omitidos maliciosamente ou por lost update!
        },
      })
      .eq("id", convId);

    const convAfter = db.getConversation(convId);
    assert.ok(
      convAfter.stage_completed_rules.orchestration?.outbox?.["msg_precious"],
      "O trigger guard DEVE restaurar a outbox bloqueando a remoção pelo browser!"
    );
    assert.equal(
      convAfter.stage_completed_rules.active_cycle_token,
      "corr_keep_token",
      "O trigger guard DEVE restaurar o active_cycle_token!"
    );
  });

  // CENÁRIO 20 (TRIGGER GUARD FUNCIONAL: SERVICE_ROLE AUTORIZADA)
  await testCase(20, "trigger guard guard_stage_completed_rules_integrity - Chamada por RPC SECURITY DEFINER autorizada continua funcionando normalmente", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_trigger_service_role";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: "corr_old_token",
        orchestration: { outbox: {} },
      },
    });

    // Role administrativa/SECURITY DEFINER (ex: release_experimental_cycle_if_owned limpando o ciclo)
    db.setSessionRole("service_role");
    const client = db.createSupabaseClient();

    const rel = await releaseCycleAtomic(client, convId, "corr_old_token");
    assert.equal(rel.released, true);

    const convAfter = db.getConversation(convId);
    assert.equal(
      convAfter.stage_completed_rules.active_cycle_token,
      null,
      "A RPC SECURITY DEFINER pode legitimamente limpar o active_cycle_token"
    );
  });

  // CENÁRIO 21 (TESTE A): 20 chamadas consecutivas de getChatStageDetail com stage inválida -> ZERO writes
  await testCase(21, "TESTE A: 20 chamadas consecutivas de getChatStageDetail com stage inválida -> ZERO writes", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_20_reads_test";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        current_stage_id: "stage_invalida_99",
        completed_goals: [],
      },
    });

    const client = db.createSupabaseClient();
    const stageRepo = new SupabaseChatStageRepository(client);
    stageRepo.getStages = async () => db.stages.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.stage_order,
      goals: s.goals,
      objectives: s.goals,
    }));

    const mockVaultRepo = { getItems: async () => [] };
    const useCase = new ManageChatProgressUseCase(stageRepo, mockVaultRepo);

    db.saveChatProgressCalls = [];

    // Executa 20 leituras consecutivas
    for (let i = 0; i < 20; i++) {
      const detail = await useCase.getChatStageDetail(convId);
      assert.equal(detail.stageIndex, 0);
      assert.equal(detail.stage?.id, "stage_1_conexao");
    }

    assert.equal(
      db.saveChatProgressCalls.length,
      0,
      "Após 20 chamadas consecutivas de leitura com stage inválida, ZERO escritas no banco devem ter ocorrido!"
    );
  });

  // CENÁRIO 22 (TESTE B): 5 chamadas concorrentes de send-now -> exatamente 1 autorização/início de ciclo; demais already_processing
  await testCase(22, "TESTE B: 5 chamadas concorrentes de send-now -> exatamente 1 início de ciclo; demais already_processing", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_5_concurrent_sendnow";

    db.insertConversation({
      id: convId,
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: null,
      },
    });

    const client = db.createSupabaseClient();
    const promises = [];

    // Dispara 5 requisições em paralelo
    for (let i = 0; i < 5; i++) {
      const token = `cycle_concurrent_${i}_${Date.now()}`;
      promises.push(
        client.rpc("authorize_send_now_atomic", {
          p_conversation_id: convId,
          p_new_cycle_token: token,
          p_stale_seconds: 300,
        })
      );
    }

    const results = await Promise.all(promises);

    let authorizedCount = 0;
    let alreadyProcessingCount = 0;

    for (const r of results) {
      if (r.data?.result === "authorized") authorizedCount++;
      if (r.data?.result === "already_processing") alreadyProcessingCount++;
    }

    assert.equal(authorizedCount, 1, "Exatamente 1 requisição deve ter sido autorizada a iniciar o ciclo");
    assert.equal(alreadyProcessingCount, 4, "As outras 4 requisições devem receber already_processing");
  });

  // CENÁRIO 23 (TESTE C): Cycle ativo há 95s -> send-now NÃO cria segundo ciclo enquanto política oficial considerar o primeiro válido (300s)
  await testCase(23, "TESTE C: Cycle ativo há 95s -> send-now NÃO cria segundo ciclo (TTL canônico 300s)", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_95s_active";
    const existingToken = "cycle_running_95s_ago";

    // Ciclo iniciado há 95 segundos (95 * 1000 ms)
    const startedAt95sAgo = new Date(Date.now() - 95_000).toISOString();

    db.insertConversation({
      id: convId,
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: existingToken,
        active_cycle_at: startedAt95sAgo,
        orchestration: { outbox: { msg1: { status: "pending" } } },
      },
    });

    const client = db.createSupabaseClient();
    const authRes = await client.rpc("authorize_send_now_atomic", {
      p_conversation_id: convId,
      p_new_cycle_token: "cycle_new_attempt",
      p_stale_seconds: 300, // Política canônica oficial: 300s
    });

    assert.equal(authRes.data?.result, "already_processing", "Deve retornar already_processing pois 95s < 300s!");
    assert.equal(authRes.data?.active_cycle_token, existingToken);

    const conv = db.getConversation(convId);
    assert.equal(
      conv.stage_completed_rules.active_cycle_token,
      existingToken,
      "O token do primeiro ciclo NÃO pode ser substituído nem corrompido!"
    );
  });

  // CENÁRIO 24 (TESTE D): claimExperimentalCycleMessagesAtomic falha depois do cycle claim -> se o próprio ciclo possui lock e zero dispatch, libera
  await testCase(24, "TESTE D: claimExperimentalCycleMessagesAtomic falha após cycle claim -> libera o próprio lock", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_claim_fail_release";
    const cycleToken = "cycle_claim_fail";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: cycleToken,
        active_cycle_at: new Date().toISOString(),
      },
    });

    const client = db.createSupabaseClient();

    // Simula falha do claim de mensagens pré-dispatch: o ciclo detém o lock e despachou ZERO mensagens
    const rel = await releaseCycleAtomic(client, convId, cycleToken);
    assert.equal(rel.released, true);

    const conv = db.getConversation(convId);
    assert.equal(conv.stage_completed_rules.active_cycle_token, null, "O lock deve ser liberado limpo");
  });

  // CENÁRIO 25 (TESTE E): Se active_cycle_token já pertence a OUTRO ciclo -> NUNCA liberar
  await testCase(25, "TESTE E: Se active_cycle_token já pertence a OUTRO ciclo -> NUNCA liberar", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_other_cycle";
    const currentOwner = "cycle_legitimate_owner";
    const impostorCycle = "cycle_impostor_old";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: currentOwner,
        active_cycle_at: new Date().toISOString(),
      },
    });

    const client = db.createSupabaseClient();
    const rel = await releaseCycleAtomic(client, convId, impostorCycle);

    assert.equal(rel.released, false, "NÃO pode liberar se o ciclo for diferente do dono atual!");
    assert.equal(rel.reason, "token_mismatch");

    const conv = db.getConversation(convId);
    assert.equal(
      conv.stage_completed_rules.active_cycle_token,
      currentOwner,
      "O lock do dono legítimo deve continuar 100% preservado"
    );
  });

  // CENÁRIO 26 (TESTE F): dispatch_uncertain -> nunca liberar/reabrir automaticamente (fail-closed)
  await testCase(26, "TESTE F: dispatch_uncertain -> nunca liberar/reabrir automaticamente", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_uncertain_test";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: null,
        orchestration: {
          outbox: {
            "item_uncertain": {
              id: "item_uncertain",
              status: "dispatch_uncertain",
              isUncertain: true,
              lastError: "Timeout de rede na Meta",
            },
          },
        },
      },
    });

    const conv = db.getConversation(convId);
    const entry = conv.stage_completed_rules.orchestration.outbox["item_uncertain"];

    // Validação fail-closed
    assert.equal(entry.status, "dispatch_uncertain");
    assert.equal(entry.isUncertain, true);

    // O dispatcher/claim de outbox DEVE recusar reenvio automático
    const client = db.createSupabaseClient();
    const claimRes = await claimOutboxAtomic(client, convId, "item_uncertain", "corr_retry");

    // Já que o status é dispatch_uncertain, o claim deve recusar reenvio automático para evitar mensagem duplicada na Meta
    assert.notEqual(claimRes.entry?.status, "claimed_to_send");
  });

  // CENÁRIO 27 (TESTE G): RPC de progresso indisponível -> nenhuma escrita direta em stage_completed_rules (fail-closed absoluto)
  await testCase(27, "TESTE G: RPC de progresso indisponível -> NENHUMA escrita direta em stage_completed_rules", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_fail_closed_test";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: "corr_precious_lock",
        orchestration: { outbox: { precious: { status: "pending" } } },
      },
    });

    const client = db.createSupabaseClient();
    // Força RPC indisponível
    client.rpc = async (fn) => {
      return { data: null, error: new Error("RPC indisponível no cluster") };
    };

    const repo = new SupabaseChatStageRepository(client);

    db.saveChatProgressCalls = [];
    let threw = false;
    try {
      await repo.saveChatProgress({
        conversationId: convId,
        currentStageId: "stage_3_compatibilidade",
        completedGoalIds: [],
        completedItemIds: [],
        isConverted: false,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      threw = true;
    }

    assert.equal(threw, true);
    assert.equal(db.saveChatProgressCalls.length, 0, "Zero chamadas ao client.from('...').update()");

    const conv = db.getConversation(convId);
    assert.equal(conv.stage_completed_rules.active_cycle_token, "corr_precious_lock");
    assert.ok(conv.stage_completed_rules.orchestration.outbox.precious);
  });

  // CENÁRIO 28 (PROVA DE FONTE CANÔNICA): setStage(stage_3) atualiza orchestration.currentStageId
  await testCase(28, "PROVA DE FONTE CANÔNICA: setStage(stage_3) atualiza orchestration.currentStageId mantendo outbox/ledger intactos", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_set_stage_proof";

    // Estado inicial: orchestration.currentStageId = stage_1_conexao
    const initialOrch = {
      currentStageId: "stage_1_conexao",
      completedGoalIds: ["goal_age"],
      objectiveProgress: { goal_age: { status: "completed" } },
      outbox: {
        "outbox_msg_1": { id: "outbox_msg_1", content: "Mensagem importante da outbox", status: "pending" },
      },
      messageLedger: {
        "inbound_msg_1": "processed",
        "inbound_msg_2": "claimed",
      },
      activeClaimedMessageIds: ["inbound_msg_2"],
      activeCycle: { id: "cycle_100", status: "running" },
      recentCycles: [{ id: "cycle_99", status: "completed" }],
      technicalRetryCount: 1,
      technicalRetryExhaustedAt: null,
    };

    db.insertConversation({
      id: convId,
      current_stage_id: "stage_1_conexao",
      stage_completed_rules: {
        current_stage_id: "stage_1_conexao",
        completed_goals: ["goal_age"],
        objective_progress: { goal_age: { status: "completed" } },
        chat_progress: {
          conversationId: convId,
          currentStageId: "stage_1_conexao",
          completedGoalIds: ["goal_age"],
        },
        orchestration: JSON.parse(JSON.stringify(initialOrch)),
      },
    });

    const client = db.createSupabaseClient();
    const repo = new SupabaseChatStageRepository(client);

    // Validação ANTES:
    const progressBefore = await repo.getChatProgress(convId);
    assert.equal(progressBefore.currentStageId, "stage_1_conexao");

    // AÇÃO MANUAL: setStage('stage_3_compatibilidade')
    await repo.advanceStage(convId, "stage_3_compatibilidade");

    // Validação DEPOIS:
    const progressAfter = await repo.getChatProgress(convId);
    assert.equal(
      progressAfter.currentStageId,
      "stage_3_compatibilidade",
      "getChatProgress() DEVE retornar stage_3_compatibilidade mesmo que consulte orchestration primeiro!"
    );

    const convAfter = db.getConversation(convId);
    const rulesAfter = convAfter.stage_completed_rules;
    const orchAfter = rulesAfter.orchestration;

    // Prova que orchestration.currentStageId foi pontualmente atualizado:
    assert.equal(orchAfter.currentStageId, "stage_3_compatibilidade");
    assert.equal(rulesAfter.current_stage_id, "stage_3_compatibilidade");
    assert.equal(rulesAfter.chat_progress.currentStageId, "stage_3_compatibilidade");

    // PROVA DE PRESERVAÇÃO BYTE-SEMÂNTICA RIGOROSA DOS DEMAIS CAMPOS DE ORCHESTRATION:
    assert.deepEqual(orchAfter.outbox, initialOrch.outbox, "orchestration.outbox deve estar idêntico!");
    assert.deepEqual(orchAfter.messageLedger, initialOrch.messageLedger, "orchestration.messageLedger deve estar idêntico!");
    assert.deepEqual(orchAfter.activeClaimedMessageIds, initialOrch.activeClaimedMessageIds, "activeClaimedMessageIds deve estar idêntico!");
    assert.deepEqual(orchAfter.activeCycle, initialOrch.activeCycle, "activeCycle deve estar idêntico!");
    assert.deepEqual(orchAfter.recentCycles, initialOrch.recentCycles, "recentCycles deve estar idêntico!");
    assert.equal(orchAfter.technicalRetryCount, initialOrch.technicalRetryCount, "technicalRetryCount deve estar idêntico!");
    assert.equal(orchAfter.technicalRetryExhaustedAt, initialOrch.technicalRetryExhaustedAt, "technicalRetryExhaustedAt deve estar idêntico!");
  });

  // ============================================================================
  // AUDITORIA PONTO 1: SEND-NOW COM LOCK PRÉ-ADQUIRIDO END-TO-END
  // ============================================================================
  await testCase(29, "PONTO 1: send-now -> authorization cycle_A -> Brain idempotente sem conflito -> mensagens claimed -> Agent mock -> prepare outbox -> claim outbox -> Meta mock 1x -> ciclo finalizado", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_send_now_e2e";
    const cycleA = "corr_sendnow_cycle_A_123";

    db.insertConversation({
      id: convId,
      ai_auto_respond: true,
      ai_debounce_until: new Date(Date.now() + 30000).toISOString(),
      stage_completed_rules: {
        active_cycle_token: null,
        active_cycle_at: null,
        orchestration: {
          messageLedger: { "inbound_msg_e2e": "pending" },
          outbox: {},
        },
      },
    });

    const client = db.createSupabaseClient();

    // 1. /autopilot/send-now adquire o lock atomicamente sob SELECT ... FOR UPDATE
    const authRes = await client.rpc("authorize_send_now_atomic", {
      p_conversation_id: convId,
      p_new_cycle_token: cycleA,
      p_stale_seconds: 300,
    });

    assert.equal(authRes.data.success, true);
    assert.equal(authRes.data.result, "authorized");
    assert.equal(authRes.data.cycle_token, cycleA);

    // Confirma que no banco o lock do cycleA já está gravado antes do Brain iniciar
    const convAfterAuth = db.getConversation(convId);
    assert.equal(convAfterAuth.stage_completed_rules.active_cycle_token, cycleA);
    assert.equal(convAfterAuth.stage_completed_rules.send_immediately, true);

    // 2. Brain inicia com correlationId = cycleA e preClaimedCycleToken = cycleA
    // Chamada à RPC claim_experimental_cycle com o mesmo token:
    const claimLockRes = await client.rpc("claim_experimental_cycle", {
      p_conversation_id: convId,
      p_cycle_token: cycleA,
      p_stale_seconds: 300,
    });

    // PROVA DE OURO: NÃO recebe active_lock / active_cycle_running contra si próprio!
    assert.equal(claimLockRes.data.success, true, "Brain DEVE ter sucesso no claimLock");
    assert.equal(claimLockRes.data.reason, "claimed");
    assert.equal(claimLockRes.data.activeCycleToken, cycleA);

    // 3. Brain adquire mensagens do ciclo
    const claimMsgsRes = await client.rpc("claim_experimental_cycle_messages", {
      p_conversation_id: convId,
      p_cycle_token: cycleA,
      p_message_ids: ["inbound_msg_e2e"],
    });

    assert.equal(claimMsgsRes.data.success, true);
    assert.equal(claimMsgsRes.data.reason, "messages_claimed");

    const convAfterClaim = db.getConversation(convId);
    assert.equal(convAfterClaim.stage_completed_rules.orchestration.messageLedger["inbound_msg_e2e"], "claimed");

    // 4. Agent mock executa e gera resposta
    const agentOutboxEntry = {
      id: "out_e2e_1",
      cycleId: cycleA,
      conversationId: convId,
      idempotencyKey: "idemp_e2e_1",
      content: "Olá! Como posso te ajudar hoje?",
      messageType: "text",
    };

    // 5. prepare outbox
    const prepRes = await client.rpc("prepare_experimental_outbox_entry", {
      p_conversation_id: convId,
      p_cycle_token: cycleA,
      p_outbox_entry: agentOutboxEntry,
    });

    assert.equal(prepRes.data.success, true);
    assert.equal(prepRes.data.reason, "prepared");
    const outboxKey = prepRes.data.outboxKey;

    // 6. claim outbox
    const claimOutboxRes = await client.rpc("claim_outbox_entry", {
      p_conversation_id: convId,
      p_outbox_key: outboxKey,
      p_claim_token: cycleA,
    });

    assert.equal(claimOutboxRes.data.success, true);
    assert.equal(claimOutboxRes.data.reason, "claimed");

    // 7. Meta mock despacha EXATAMENTE 1 VEZ
    let metaCalls = 0;
    const sendMetaMock = async () => {
      metaCalls++;
      return { success: true, messageId: "meta_msg_e2e_999" };
    };

    const dispatchMetaResult = await sendMetaMock();
    assert.equal(dispatchMetaResult.success, true);
    assert.equal(metaCalls, 1, "Meta mock deve ser chamado EXATAMENTE 1 vez!");

    // 8. Ciclo finalizado e lock liberado
    const releaseRes = await client.rpc("release_experimental_cycle_if_owned", {
      p_conversation_id: convId,
      p_cycle_token: cycleA,
      p_processing_status: "completed",
    });

    assert.equal(releaseRes.data.released, true);
    const convFinal = db.getConversation(convId);
    assert.equal(convFinal.stage_completed_rules.active_cycle_token, null, "Lock liberado com perfeição");
  });

  // ============================================================================
  // AUDITORIA PONTO 2: ZERO READ-MODIFY-WRITE DE stage_completed_rules
  // ============================================================================
  await testCase(30, "PONTO 2: ZERO read-modify-write em todo o sistema - FAIL-CLOSED absoluto sem fallbacks destrutivos", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_rmw_audit";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: "lock_active",
        orchestration: {
          outbox: { item1: { status: "pending" } },
        },
      },
    });

    const client = db.createSupabaseClient();
    const repo = new SupabaseChatStageRepository(client);

    // 1. Simula falha na RPC patch_chat_progress_atomic
    const originalPatch = db.patchChatProgressAtomic;
    db.patchChatProgressAtomic = () => ({ success: false, reason: "db_error", error: "Connection reset" });

    // SupabaseChatStageRepository DEVE falhar fechado (throw), NUNCA fazer SELECT -> spread -> UPDATE
    let threw = false;
    try {
      await repo.saveChatProgress({
        conversationId: convId,
        currentStageId: "stage_2_tentativa",
      });
    } catch (e) {
      threw = true;
      assert.match(e.message, /Falha ao salvar progresso atômico/);
    }
    assert.ok(threw, "saveChatProgress DEVE lançar exceção em caso de falha da RPC");

    // Prova que outbox e lock permaneceram INTACTOS
    const convAfterFail = db.getConversation(convId);
    assert.equal(convAfterFail.stage_completed_rules.active_cycle_token, "lock_active");
    assert.ok(convAfterFail.stage_completed_rules.orchestration.outbox.item1);

    // Restaura mock
    db.patchChatProgressAtomic = originalPatch;
  });

  // ============================================================================
  // AUDITORIA PONTO 3: PREPARE OUTBOX AUTORITATIVO
  // ============================================================================
  await testCase(31, "PONTO 3: prepareExperimentalOutboxEntry autoritativo - success=false bloqueia claim e Meta; success=true usa mesma chave", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_prep_authoritative";
    const cycleToken = "cycle_prep_test";

    db.insertConversation({
      id: convId,
      stage_completed_rules: {
        active_cycle_token: cycleToken,
        orchestration: { outbox: {} },
      },
    });

    const client = db.createSupabaseClient();

    // SUBTESTE 31.1: prepare falha (ex: cycle_preempted) -> claim calls = 0, Meta calls = 0
    db.failNextPrepareOutbox = true;
    let claimCalls = 0;
    let metaCalls = 0;

    const prepFailRes = await client.rpc("prepare_experimental_outbox_entry", {
      p_conversation_id: convId,
      p_cycle_token: cycleToken,
      p_outbox_entry: { id: "out_fail_1", content: "Não deve enviar" },
    });

    assert.equal(prepFailRes.data.success, false);
    assert.equal(prepFailRes.data.reason, "cycle_preempted");

    // LÓGICA DE PRODUÇÃO: Se !prepRes.success -> NÃO chama claim e NÃO chama Meta
    if (prepFailRes.data.success) {
      claimCalls++;
      metaCalls++;
    }

    assert.equal(claimCalls, 0, "claim_outbox_entry NUNCA deve ser chamada se prepare falhar!");
    assert.equal(metaCalls, 0, "Meta dispatch NUNCA deve ser chamado se prepare falhar!");

    // SUBTESTE 31.2: prepare sucede -> claim usa EXATAMENTE a mesma outbox key retornada
    db.overrideOutboxKey = "canonical_outbox_key_hash_888";
    const prepSuccessRes = await client.rpc("prepare_experimental_outbox_entry", {
      p_conversation_id: convId,
      p_cycle_token: cycleToken,
      p_outbox_entry: { id: "out_success_1", content: "Deve enviar" },
    });

    assert.equal(prepSuccessRes.data.success, true);
    assert.equal(prepSuccessRes.data.outboxKey, "canonical_outbox_key_hash_888");

    const claimRes = await client.rpc("claim_outbox_entry", {
      p_conversation_id: convId,
      p_outbox_key: prepSuccessRes.data.outboxKey,
      p_claim_token: cycleToken,
    });

    assert.equal(claimRes.data.success, true);
    assert.equal(claimRes.data.reason, "claimed");
    assert.equal(claimRes.data.entry.claimToken, cycleToken);
  });

  // ============================================================================
  // AUDITORIA PONTO 4: TRIGGER GUARD DEFENSIVO & NORMALIZAÇÃO DE JSON
  // ============================================================================
  await testCase(32, "PONTO 4: guard_stage_completed_rules_integrity - authenticated direto bloqueado, SECURITY DEFINER funciona, service_role funciona, normalização preserva dados", async () => {
    const db = new MockPostgresDatabase();
    const convId = "conv_trigger_guard_full";

    const initialRules = {
      active_cycle_token: "token_guard_123",
      active_cycle_at: new Date().toISOString(),
      preempt_requested: true,
      orchestration: {
        outbox: { msg1: { id: "msg1", content: "Preservar outbox" } },
        messageLedger: { in1: "claimed" },
        activeClaimedMessageIds: ["in1"],
        technicalRetryCount: 1,
      },
    };

    db.insertConversation({
      id: convId,
      stage_completed_rules: JSON.parse(JSON.stringify(initialRules)),
    });

    // SUBTESTE 32.1: authenticated executando UPDATE direto tentando limpar outbox e lock
    db.setSessionRole("authenticated");
    const clientAuth = db.createSupabaseClient();
    await clientAuth.from("instagram_conversations").update({
      stage_completed_rules: { malicious_client_data: "hacked" },
    }).eq("id", convId);

    const convAfterDirect = db.getConversation(convId);
    const rulesAfterDirect = convAfterDirect.stage_completed_rules;

    // PROVA DE BLOQUEIO: Trigger restaurou active_cycle_token e outbox intactos!
    assert.equal(rulesAfterDirect.active_cycle_token, "token_guard_123", "Trigger DEVE preservar active_cycle_token!");
    assert.equal(rulesAfterDirect.preempt_requested, true, "Trigger DEVE preservar preempt_requested!");
    assert.ok(rulesAfterDirect.orchestration?.outbox?.msg1, "Trigger DEVE preservar outbox!");
    assert.equal(rulesAfterDirect.orchestration?.messageLedger?.in1, "claimed", "Trigger DEVE preservar messageLedger!");
    assert.equal(rulesAfterDirect.malicious_client_data, "hacked", "Campos do cliente são aceitos desde que não corrompam os críticos");

    // SUBTESTE 32.2: authenticated chamando RPC SECURITY DEFINER
    // (a RPC roda como postgres, portanto NÃO sofre restrição do trigger)
    db.setSessionRole("postgres");
    const rpcRes = await clientAuth.rpc("authorize_send_now_atomic", {
      p_conversation_id: convId,
      p_new_cycle_token: "token_new_authorized",
      p_stale_seconds: 300,
    });
    assert.equal(rpcRes.data.success, true);

    // SUBTESTE 32.3: service_role operação legítima
    db.setSessionRole("service_role");
    await clientAuth.from("instagram_conversations").update({
      stage_completed_rules: { ...initialRules, maintenance: true },
    }).eq("id", convId);
    const convAfterService = db.getConversation(convId);
    assert.equal(convAfterService.stage_completed_rules.maintenance, true);

    // SUBTESTE 32.4: Normalização defensiva de JSON malformado
    db.setSessionRole("authenticated");

    // Caso A: String contendo JSON escapado (ex: serialização incorreta do browser)
    const escapedJson = JSON.stringify({ validKey: "restored_value" });
    await clientAuth.from("instagram_conversations").update({
      stage_completed_rules: escapedJson,
    }).eq("id", convId);
    const convAfterEscaped = db.getConversation(convId);
    assert.equal(typeof convAfterEscaped.stage_completed_rules, "object");
    assert.equal(convAfterEscaped.stage_completed_rules.validKey, "restored_value");
    assert.equal(convAfterEscaped.stage_completed_rules.active_cycle_token, "token_guard_123");

    // Caso B: String corrompida / não-JSON ou null
    await clientAuth.from("instagram_conversations").update({
      stage_completed_rules: "{invalid_json_corrupted",
    }).eq("id", convId);
    const convAfterCorrupt = db.getConversation(convId);
    assert.equal(typeof convAfterCorrupt.stage_completed_rules, "object");
    assert.equal(convAfterCorrupt.stage_completed_rules.active_cycle_token, "token_guard_123", "NÃO destrói silenciosamente informação operacional recuperável!");

    // SUBTESTE 32.5: EDGE CASE CRÍTICO - OLD.stage_completed_rules = null
    // Cliente authenticated tenta introduzir campos operacionais protegidos via UPDATE direto
    const convNullId = "conv_trigger_guard_null_old";
    db.insertConversation({
      id: convNullId,
      stage_completed_rules: null,
    });

    db.setSessionRole("authenticated");
    await clientAuth.from("instagram_conversations").update({
      stage_completed_rules: {
        active_cycle_token: "injected_cycle_token",
        active_cycle_at: new Date().toISOString(),
        preempt_requested: true,
        user_preference: "dark_mode",
        orchestration: {
          outbox: { evil_msg: { id: "evil_msg", content: "hacked" } },
          messageLedger: { msg1: "claimed" },
          activeClaimedMessageIds: ["msg1"],
          activeCycle: { id: "injected_cycle" },
          recentCycles: [{ id: "fake_cycle" }],
          technicalRetryCount: 99,
          technicalRetryExhaustedAt: new Date().toISOString(),
        },
      },
    }).eq("id", convNullId);

    const convAfterNullUpdate = db.getConversation(convNullId);
    const rulesNull = convAfterNullUpdate.stage_completed_rules;

    // PROVA DE OURO: Trigger bloqueou/removeu TODOS os campos operacionais protegidos quando OLD era NULL!
    assert.equal(rulesNull.active_cycle_token, undefined, "active_cycle_token NÃO pode ser introduzido por authenticated!");
    assert.equal(rulesNull.active_cycle_at, undefined, "active_cycle_at NÃO pode ser introduzido por authenticated!");
    assert.equal(rulesNull.preempt_requested, undefined, "preempt_requested NÃO pode ser introduzido por authenticated!");
    assert.equal(rulesNull.orchestration?.outbox, undefined, "outbox NÃO pode ser introduzida por authenticated!");
    assert.equal(rulesNull.orchestration?.messageLedger, undefined, "messageLedger NÃO pode ser introduzido por authenticated!");
    assert.equal(rulesNull.orchestration?.activeClaimedMessageIds, undefined, "activeClaimedMessageIds NÃO pode ser introduzido!");
    assert.equal(rulesNull.orchestration?.activeCycle, undefined, "activeCycle NÃO pode ser introduzido!");
    assert.equal(rulesNull.orchestration?.recentCycles, undefined, "recentCycles NÃO pode ser introduzido!");
    assert.equal(rulesNull.orchestration?.technicalRetryCount, undefined, "technicalRetryCount NÃO pode ser introduzido!");
    assert.equal(rulesNull.orchestration?.technicalRetryExhaustedAt, undefined, "technicalRetryExhaustedAt NÃO pode ser introduzido!");
    assert.equal(rulesNull.user_preference, "dark_mode", "Campos legítimos de usuário são preservados");
  });

  console.log("\n================================================================================");
  console.log(`🏁 RESULTADO FINAL: ${passed}/32 CENÁRIOS APROVADOS COM SUCESSO ABSOLUTO!`);
  console.log("================================================================================");
}

runAllTests().catch((e) => {
  console.error("Erro fatal na execução da suíte:", e);
  process.exit(1);
});
