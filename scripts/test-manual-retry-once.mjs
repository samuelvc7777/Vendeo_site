// ============================================================================
// scripts/test-manual-retry-once.mjs
// Suíte de Testes do Retry Manual Seguro com Escopo de Outbox por Lote
// Valida os 10 cenários obrigatórios + contratos de segurança e paridade RPC/Fallback
// ============================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

console.log("==================================================================");
console.log("INICIANDO SUÍTE DE TESTES: AUTORIZAÇÃO MANUAL DE RETRY (ESCOPO DE OUTBOX)");
console.log("==================================================================\n");

let passedTests = 0;
let totalTests = 0;

// Carrega a função authorizeManualAutopilotRetryAtomic de brain_orchestrator.ts
function loadAuthorizeManualAutopilotRetryAtomic() {
  const filePath = path.resolve("supabase/functions/api/brain_orchestrator.ts");
  const content = fs.readFileSync(filePath, "utf8");
  const funcIdx = content.indexOf("export async function authorizeManualAutopilotRetryAtomic(");
  const endIdx = content.indexOf("export interface DispatchOutboxParams", funcIdx);
  if (funcIdx === -1 || endIdx === -1) {
    throw new Error("Não foi possível localizar authorizeManualAutopilotRetryAtomic no brain_orchestrator.ts");
  }
  const slice = content.slice(funcIdx, endIdx);
  const transpiled = ts.transpileModule(slice, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const moduleObj = { exports: {} };
  vm.runInNewContext(transpiled, { module: moduleObj, exports: moduleObj.exports, console, Date, Set, Array }, { filename: "brain_orchestrator.ts" });
  return moduleObj.exports.authorizeManualAutopilotRetryAtomic;
}

const authorizeManualAutopilotRetryAtomic = loadAuthorizeManualAutopilotRetryAtomic();

function createMockSupabase(initialConversations = {}, initialMessages = [], options = {}) {
  const { disableRpc = false } = options;
  const conversations = { ...initialConversations };
  const messages = [...initialMessages];

  return {
    _conversations: conversations,
    _messages: messages,
    from(table) {
      if (table === "instagram_conversations") {
        let currentFilter = {};
        return {
          select(fields) {
            return {
              eq(col, val) {
                currentFilter[col] = val;
                return {
                  maybeSingle: async () => {
                    const row = conversations[val];
                    if (!row) return { data: null, error: null };
                    return {
                      data: {
                        id: row.id,
                        stage_completed_rules: row.stage_completed_rules,
                        ai_auto_respond: row.ai_auto_respond,
                        ai_debounce_until: row.ai_debounce_until,
                        is_restricted: row.is_restricted || false,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update(patch) {
            return {
              eq: async (col, val) => {
                if (conversations[val]) {
                  conversations[val] = {
                    ...conversations[val],
                    ...patch,
                  };
                  return { data: conversations[val], error: null };
                }
                return { data: null, error: { message: "Not found" } };
              },
            };
          },
        };
      }
      if (table === "instagram_messages") {
        return {
          select(fields) {
            return {
              eq(col1, val1) {
                return {
                  eq(col2, val2) {
                    return {
                      gte(col3, val3) {
                        return {
                          order(col4, opts) {
                            return {
                              limit: async (lim) => {
                                const filtered = messages.filter(
                                  (m) =>
                                    m[col1] === val1 &&
                                    m[col2] === val2 &&
                                    (!val3 || m[col3] >= val3)
                                );
                                return { data: filtered.slice(0, lim), error: null };
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {};
    },
    rpc: async (fn, params) => {
      if (disableRpc) {
        return { data: null, error: { message: "function authorize_manual_autopilot_retry does not exist" } };
      }

      // Mock da RPC authorize_manual_autopilot_retry espelhando com precisão a migration 20260923150000
      if (fn === "authorize_manual_autopilot_retry") {
        const conv = conversations[params.p_conversation_id];
        if (!conv) {
          return { data: { success: false, reason: "conversation_not_found", message: "Conversa não encontrada." }, error: null };
        }
        if (conv.ai_auto_respond !== true) {
          return { data: { success: false, reason: "autopilot_disabled", message: "O autopiloto está desativado para esta conversa." }, error: null };
        }
        const rules = conv.stage_completed_rules || {};
        const orch = rules.orchestration || {};
        const ledger = orch.messageLedger || {};
        const outbox = orch.outbox || {};
        const recentCycles = Array.isArray(orch.recentCycles) ? orch.recentCycles : [];
        const activeCycle = orch.activeCycle || null;

        if (rules.active_cycle_token) {
          const activeAtMs = rules.active_cycle_at ? Date.parse(rules.active_cycle_at) : 0;
          if (activeAtMs > 0 && Date.now() - activeAtMs < 300_000) {
            return {
              data: {
                success: false,
                reason: "active_cycle_running",
                message: "Já existe um ciclo do Brain em execução para esta conversa.",
                activeCycleToken: rules.active_cycle_token,
              },
              error: null,
            };
          }
        }

        const retryCount = Number(orch.technicalRetryCount || 0);
        const exhaustedAt = orch.technicalRetryExhaustedAt;
        const lastErr = orch.lastError;
        if (retryCount < 3 && !exhaustedAt && lastErr !== "technical_retry_exhausted") {
          return { data: { success: false, reason: "not_exhausted", message: "As tentativas técnicas automáticas ainda não se esgotaram." }, error: null };
        }

        // 1. Resolver primeiro o lote pendente
        const pendingIds = [];
        for (const [mid, st] of Object.entries(ledger)) {
          if (st === "pending") pendingIds.push(mid);
        }

        if (pendingIds.length === 0) {
          const recents = messages.filter(
            (m) => m.conversation_id === params.p_conversation_id && !m.is_mine && ledger[m.id] !== "processed"
          );
          for (const m of recents) {
            pendingIds.push(m.id);
            ledger[m.id] = "pending";
          }
        }

        if (pendingIds.length === 0) {
          return { data: { success: false, reason: "no_pending_messages", message: "Não há mensagens pendentes a responder." }, error: null };
        }

        const pendingSet = new Set(pendingIds);

        // 2. Classificar ciclos relevantes e não-relacionados
        const relevantCycleIds = [];
        const unrelatedCycleIds = [];
        const allCycles = [...recentCycles];
        if (activeCycle && typeof activeCycle === "object") allCycles.push(activeCycle);

        for (const c of allCycles) {
          if (!c || !c.cycleId) continue;
          const claimed = Array.isArray(c.claimedMessageIds) ? c.claimedMessageIds : [];
          if (claimed.length > 0) {
            if (claimed.some((id) => pendingSet.has(id))) {
              relevantCycleIds.push(c.cycleId);
            } else {
              unrelatedCycleIds.push(c.cycleId);
            }
          }
        }

        // 3. Validação de outbox escopada
        for (const entry of Object.values(outbox)) {
          if (!entry || typeof entry !== "object") continue;
          const outboxCycleId = entry.cycleId || "";

          let isRelevant = true;
          if (outboxCycleId !== "" && relevantCycleIds.includes(outboxCycleId)) {
            isRelevant = true;
          } else if (outboxCycleId !== "" && unrelatedCycleIds.includes(outboxCycleId)) {
            isRelevant = false;
          } else {
            // Ambiguidade / cycleId vazio ou não rastreado -> fail-closed
            isRelevant = true;
          }

          if (isRelevant) {
            if (entry.status === "sent" || (entry.providerMessageId && entry.providerMessageId !== "")) {
              return {
                data: {
                  success: false,
                  reason: "outbox_already_sent",
                  message: "Já existe mensagem enviada confirmada neste lote.",
                  blockingCycleId: outboxCycleId || null,
                },
                error: null,
              };
            }
            if (entry.status === "sending") {
              return {
                data: {
                  success: false,
                  reason: "outbox_sending",
                  message: "Existe mensagem em processo de envio no momento.",
                  blockingCycleId: outboxCycleId || null,
                },
                error: null,
              };
            }
            if (entry.status === "dispatch_uncertain" || entry.isUncertain === true) {
              return {
                data: {
                  success: false,
                  reason: "outbox_uncertain",
                  message: "Há um envio anterior com confirmação incerta para este lote. Não é seguro reenviar automaticamente.",
                  blockingCycleId: outboxCycleId || null,
                },
                error: null,
              };
            }
          }
        }

        const oldCycle = rules.active_cycle_token || orch.lastCycleId || null;
        orch.messageLedger = ledger;
        orch.manualRetryAttempt = true;
        orch.manualRetryCycleId = params.p_new_cycle_token;
        orch.manualRetryAuthorizedAt = new Date().toISOString();
        if (oldCycle) orch.manualRetryOfCycleId = oldCycle;

        rules.orchestration = orch;
        rules.active_cycle_token = params.p_new_cycle_token;
        rules.active_cycle_at = new Date().toISOString();
        conv.stage_completed_rules = rules;

        return {
          data: {
            success: true,
            reason: "authorized",
            cycleToken: params.p_new_cycle_token,
            previousCycleToken: oldCycle,
            pendingMessageIds: pendingIds,
            pendingCount: pendingIds.length,
            relevantCycleIds,
          },
          error: null,
        };
      }
      return { data: null, error: { message: "RPC not mocked" } };
    },
  };
}

async function runScenario(name, fn) {
  totalTests++;
  try {
    process.stdout.write(`Cenário ${totalTests}: ${name} ... `);
    await fn();
    console.log("\x1b[32m[PASS]\x1b[0m");
    passedTests++;
  } catch (err) {
    console.log("\x1b[31m[FAIL]\x1b[0m");
    console.error(err);
  }
}

// ==========================================
// CENÁRIO 1: Historical unrelated dispatch_uncertain + current pending batch sem outbox -> AUTORIZA (Caso real William)
// ==========================================
await runScenario("Historical unrelated dispatch_uncertain não bloqueia lote pendente atual (Caso real William)", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      "1541421561005872": {
        id: "1541421561005872",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: "2026-09-23T10:55:00.000Z",
            lastCycleId: "corr_1790171503437_gd1iy",
            lastError: "technical_retry_exhausted",
            messageLedger: {
              "msg_curr_1": "pending",
              "msg_curr_2": "pending",
              "msg_curr_3": "pending",
            },
            recentCycles: [
              {
                cycleId: "corr_1790168702836_9j5x1",
                claimedMessageIds: ["msg_historica_antiga"],
                completedAt: "2026-09-23T10:10:00.000Z",
              },
              {
                cycleId: "corr_1790171503437_gd1iy",
                claimedMessageIds: ["msg_curr_1", "msg_curr_2", "msg_curr_3"],
                completedAt: "2026-09-23T10:53:50.000Z",
              },
            ],
            outbox: {
              "corr_1790168702836_9j5x1": {
                cycleId: "corr_1790168702836_9j5x1",
                status: "dispatch_uncertain",
                isUncertain: true,
                content: "Bom diaa, tô bem tbm 😊",
              },
            },
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "1541421561005872",
      newCycleToken: "manual_william_retry",
    });

    assert.equal(res.success, true, `Falhou com disableRpc=${disableRpc}`);
    assert.equal(res.reason, "authorized");
    assert.equal(res.pendingCount, 3);
    assert.deepEqual(Array.from(res.pendingMessageIds), ["msg_curr_1", "msg_curr_2", "msg_curr_3"]);
    assert.ok(Array.from(res.relevantCycleIds).includes("corr_1790171503437_gd1iy"));
    assert.ok(!Array.from(res.relevantCycleIds).includes("corr_1790168702836_9j5x1"));

    // Verifica persistência imediata do lock no banco
    const conv = supabase._conversations["1541421561005872"];
    assert.equal(conv.stage_completed_rules.active_cycle_token, "manual_william_retry");
    assert.equal(conv.stage_completed_rules.orchestration.manualRetryAttempt, true);
    assert.equal(conv.stage_completed_rules.orchestration.manualRetryCycleId, "manual_william_retry");
  }
});

// ==========================================
// CENÁRIO 2: Historical unrelated sent + current pending batch sem outbox -> AUTORIZA
// ==========================================
await runScenario("Historical unrelated sent não bloqueia novo lote pendente", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_hist_sent: {
        id: "conv_hist_sent",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            lastError: "technical_retry_exhausted",
            messageLedger: { msg_batch_2: "pending" },
            recentCycles: [
              {
                cycleId: "cycle_old_sent",
                claimedMessageIds: ["msg_batch_1"],
              },
              {
                cycleId: "cycle_curr_batch_2",
                claimedMessageIds: ["msg_batch_2"],
              },
            ],
            outbox: {
              cycle_old_sent: {
                cycleId: "cycle_old_sent",
                status: "sent",
                providerMessageId: "meta_msg_old_123",
              },
            },
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_hist_sent",
      newCycleToken: "manual_retry_batch_2",
    });

    assert.equal(res.success, true);
    assert.equal(res.reason, "authorized");
    assert.equal(res.pendingCount, 1);
  }
});

// ==========================================
// CENÁRIO 3: Current batch dispatch_uncertain -> BLOQUEIA (outbox_uncertain)
// ==========================================
await runScenario("Current batch dispatch_uncertain BLOQUEIA fail-closed (outbox_uncertain)", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_curr_uncertain: {
        id: "conv_curr_uncertain",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_curr: "pending" },
            recentCycles: [
              {
                cycleId: "cycle_curr_uncertain",
                claimedMessageIds: ["msg_curr"],
              },
            ],
            outbox: {
              cycle_curr_uncertain: {
                cycleId: "cycle_curr_uncertain",
                status: "dispatch_uncertain",
                isUncertain: true,
              },
            },
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_curr_uncertain",
      newCycleToken: "manual_retry_uncertain",
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, "outbox_uncertain");
    assert.equal(res.blockingCycleId, "cycle_curr_uncertain");
  }
});

// ==========================================
// CENÁRIO 4: Current batch sent -> BLOQUEIA (outbox_already_sent)
// ==========================================
await runScenario("Current batch sent BLOQUEIA fail-closed (outbox_already_sent)", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_curr_sent: {
        id: "conv_curr_sent",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_curr: "pending" },
            recentCycles: [
              {
                cycleId: "cycle_curr_sent",
                claimedMessageIds: ["msg_curr"],
              },
            ],
            outbox: {
              cycle_curr_sent: {
                cycleId: "cycle_curr_sent",
                status: "sent",
                providerMessageId: "meta_curr_sent_456",
              },
            },
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_curr_sent",
      newCycleToken: "manual_retry_sent",
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, "outbox_already_sent");
    assert.equal(res.blockingCycleId, "cycle_curr_sent");
  }
});

// ==========================================
// CENÁRIO 5: Current batch sending -> BLOQUEIA (outbox_sending)
// ==========================================
await runScenario("Current batch sending BLOQUEIA fail-closed (outbox_sending)", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_curr_sending: {
        id: "conv_curr_sending",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_curr: "pending" },
            recentCycles: [
              {
                cycleId: "cycle_curr_sending",
                claimedMessageIds: ["msg_curr"],
              },
            ],
            outbox: {
              cycle_curr_sending: {
                cycleId: "cycle_curr_sending",
                status: "sending",
              },
            },
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_curr_sending",
      newCycleToken: "manual_retry_sending",
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, "outbox_sending");
    assert.equal(res.blockingCycleId, "cycle_curr_sending");
  }
});

// ==========================================
// CENÁRIO 6: Dois ciclos com os mesmos claimedMessageIds, um deles uncertain -> BLOQUEIA
// ==========================================
await runScenario("Dois ciclos técnicos com mesmos claimedMessageIds, um uncertain -> BLOQUEIA", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_multi_cycle_same_batch: {
        id: "conv_multi_cycle_same_batch",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_same: "pending" },
            recentCycles: [
              {
                cycleId: "corr_attempt_1",
                claimedMessageIds: ["msg_same"],
              },
              {
                cycleId: "corr_attempt_2",
                claimedMessageIds: ["msg_same"],
              },
            ],
            outbox: {
              corr_attempt_2: {
                cycleId: "corr_attempt_2",
                status: "dispatch_uncertain",
                isUncertain: true,
              },
            },
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_multi_cycle_same_batch",
      newCycleToken: "manual_retry_attempt_3",
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, "outbox_uncertain");
    assert.equal(res.blockingCycleId, "corr_attempt_2");
  }
});

// ==========================================
// CENÁRIO 7: Old cycle claimedMessageIds diferentes -> NÃO BLOQUEIA
// ==========================================
await runScenario("Old cycle com claimedMessageIds disjuntos NÃO BLOQUEIA novo lote", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_disjoint: {
        id: "conv_disjoint",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_new_e2: "pending" },
            recentCycles: [
              {
                cycleId: "corr_old_e1",
                claimedMessageIds: ["msg_old_e1"],
              },
              {
                cycleId: "corr_curr_e2",
                claimedMessageIds: ["msg_new_e2"],
              },
            ],
            outbox: {
              corr_old_e1: {
                cycleId: "corr_old_e1",
                status: "dispatch_uncertain",
                isUncertain: true,
              },
            },
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_disjoint",
      newCycleToken: "manual_retry_e2",
    });

    assert.equal(res.success, true);
    assert.equal(res.reason, "authorized");
    assert.equal(res.pendingCount, 1);
  }
});

// ==========================================
// CENÁRIO 8: Active cycle atual vigente (< 300s) -> BLOQUEIA (active_cycle_running)
// ==========================================
await runScenario("Active cycle vigente (<300s) bloqueia autorização (active_cycle_running)", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_active_running: {
        id: "conv_active_running",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: "worker_currently_executing",
          active_cycle_at: new Date(Date.now() - 30_000).toISOString(),
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_active: "pending" },
            outbox: {},
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_active_running",
      newCycleToken: "manual_retry_rejected",
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, "active_cycle_running");
    assert.equal(res.activeCycleToken, "worker_currently_executing");
  }
});

// ==========================================
// CENÁRIO 9: Sem pending messages -> BLOQUEIA (no_pending_messages)
// ==========================================
await runScenario("Sem pendências no ledger nem inbounds recentes -> BLOQUEIA (no_pending_messages)", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_no_pending: {
        id: "conv_no_pending",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_done: "processed" },
            outbox: {},
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_no_pending",
      newCycleToken: "manual_retry_empty",
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, "no_pending_messages");
  }
});

// ==========================================
// CENÁRIO 10: Autopilot disabled -> BLOQUEIA (autopilot_disabled)
// ==========================================
await runScenario("Conversa com ai_auto_respond = false -> BLOQUEIA (autopilot_disabled)", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_disabled: {
        id: "conv_disabled",
        ai_auto_respond: false,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_dis: "pending" },
            outbox: {},
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_disabled",
      newCycleToken: "manual_retry_dis",
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, "autopilot_disabled");
  }
});

// ==========================================
// CENÁRIO 11: Ambiguidade fail-closed (outbox sem cycleId rastreado) -> BLOQUEIA
// ==========================================
await runScenario("Outbox com cycleId desconhecido/não-rastreado bloqueia fail-closed por segurança", async () => {
  for (const disableRpc of [false, true]) {
    const supabase = createMockSupabase({
      conv_ambiguous: {
        id: "conv_ambiguous",
        ai_auto_respond: true,
        stage_completed_rules: {
          active_cycle_token: null,
          orchestration: {
            technicalRetryCount: 3,
            technicalRetryExhaustedAt: new Date().toISOString(),
            messageLedger: { msg_amb: "pending" },
            recentCycles: [
              {
                cycleId: "corr_known_batch",
                claimedMessageIds: ["msg_amb"],
              },
            ],
            outbox: {
              ambiguous_entry: {
                cycleId: "corr_untracked_cycle_xyz",
                status: "sent",
                providerMessageId: "meta_ambiguous_789",
              },
            },
          },
        },
      },
    }, [], { disableRpc });

    const res = await authorizeManualAutopilotRetryAtomic({
      supabase,
      conversationId: "conv_ambiguous",
      newCycleToken: "manual_ambiguous_retry",
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, "outbox_already_sent");
  }
});

// ==========================================
// CENÁRIO 12: Contrato de falha manual (volta para exhausted sem agendamento no cron)
// ==========================================
await runScenario("Contrato de falha manual: retryAllowed = false, debounceUntil = null, volta para exhausted", async () => {
  const orchestratorCode = fs.readFileSync(path.resolve("supabase/functions/api/brain_orchestrator.ts"), "utf8");

  // 1. Verifica se isManualRetry força retryAllowed = false
  assert.match(
    orchestratorCode,
    /if\s*\(\s*params\.isManualRetry\s*\)\s*\{\s*retryAllowed\s*=\s*false;\s*\}/,
    "isManualRetry deve forçar retryAllowed = false em caso de erro"
  );

  // 2. Verifica se debounceUntil é condicionado a retryAllowed
  assert.match(
    orchestratorCode,
    /debounceUntil:\s*!possibleSend\s*&&\s*retryAllowed\s*\?\s*new Date\(Date\.now\(\)\s*\+\s*60_000\)\.toISOString\(\)\s*:\s*null/,
    "debounceUntil deve ser null quando retryAllowed for false"
  );

  // 3. Verifica se o evento technical_retry_exhausted é emitido quando isManualRetry falhar
  assert.match(
    orchestratorCode,
    /if\s*\(\s*releaseRes\.retryExhausted\s*\|\|\s*params\.isManualRetry\s*\)\s*\{[\s\S]*?event:\s*"technical_retry_exhausted"/,
    "Evento technical_retry_exhausted deve ser emitido quando isManualRetry falhar"
  );

  // 4. Verifica na migration SQL que v_retry_count >= 3 seta ai_debounce_until = NULL
  const migrationCode = fs.readFileSync(path.resolve("supabase/migrations/20260923062000_recover_stale_autopilot_cycles.sql"), "utf8");
  assert.match(
    migrationCode,
    /WHEN\s+COALESCE\(v_retry_count,\s*0\)\s*>=\s*3\s+THEN\s+NULL/,
    "Migration SQL garante ai_debounce_until = NULL quando retryCount >= 3"
  );
});

// ==========================================
// CENÁRIO 13: Contrato de sucesso manual (zera technicalRetryCount e limpa exhausted)
// ==========================================
await runScenario("Contrato de sucesso manual: CAS final zera technicalRetryCount e limpa exhausted", async () => {
  const orchestratorCode = fs.readFileSync(path.resolve("supabase/functions/api/brain_orchestrator.ts"), "utf8");

  // 1. Verifica se updatedState zera technicalRetryCount e limpa exhausted no sucesso
  assert.match(
    orchestratorCode,
    /technicalRetryCount:\s*0,[\s\S]*?technicalRetryExhaustedAt:\s*null,[\s\S]*?manualRetryAttempt:\s*null,/,
    "CAS final do commit deve zerar technicalRetryCount e limpar technicalRetryExhaustedAt"
  );

  // 2. Verifica se a RPC release_experimental_cycle_if_owned zera technicalRetryCount no status sent
  const migrationCode = fs.readFileSync(path.resolve("supabase/migrations/20260923062000_recover_stale_autopilot_cycles.sql"), "utf8");
  assert.match(
    migrationCode,
    /ELSIF\s+p_processing_status\s*=\s*'sent'\s+THEN[\s\S]*?v_orch\s*:=\s*jsonb_set\(v_orch,\s*'\{technicalRetryCount\}',\s*'0'::jsonb\);[\s\S]*?v_orch\s*:=\s*jsonb_set\(v_orch,\s*'\{technicalRetryExhaustedAt\}',\s*'null'::jsonb\);/,
    "RPC release_experimental_cycle_if_owned deve zerar technicalRetryCount e limpar technicalRetryExhaustedAt no status sent"
  );

  // 3. Verifica se a rota /autopilot/retry-once está registrada no index.ts
  const indexCode = fs.readFileSync(path.resolve("supabase/functions/api/index.ts"), "utf8");
  assert.match(
    indexCode,
    /path\s*===\s*"\/autopilot\/retry-once"/,
    "index.ts deve registrar a rota POST /autopilot/retry-once"
  );
  assert.match(
    indexCode,
    /authorizeManualAutopilotRetryAtomic\(\{/,
    "index.ts deve chamar authorizeManualAutopilotRetryAtomic"
  );
  assert.match(
    indexCode,
    /isManualRetry:\s*true/,
    "index.ts deve passar isManualRetry: true para runBrainOrchestration"
  );

  // 4. Verifica se o frontend possui o botão Tentar mais uma vez e proteção contra clique duplo
  const frontendCode = fs.readFileSync(path.resolve("src/presentation/components/chat/AutoPilotActivityIndicator.tsx"), "utf8");
  assert.match(
    frontendCode,
    /handleManualRetryOnce/,
    "Frontend deve ter a função handleManualRetryOnce"
  );
  assert.match(
    frontendCode,
    /isRetryingManual/,
    "Frontend deve controlar isRetryingManual para evitar clique duplo"
  );
  assert.match(
    frontendCode,
    /Tentar mais uma vez/,
    "Frontend deve renderizar o rótulo 'Tentar mais uma vez'"
  );
});

// ==========================================
// RESULTADO FINAL
// ==========================================
console.log("\n==================================================================");
console.log(`TOTAL DE CENÁRIOS: ${totalTests}`);
console.log(`APROVADOS: ${passedTests}`);
console.log(`FALHAS: ${totalTests - passedTests}`);
console.log("==================================================================");

if (passedTests === totalTests) {
  console.log("\x1b[32mTODOS OS CENÁRIOS FORAM APROVADOS COM SUCESSO!\x1b[0m\n");
  process.exit(0);
} else {
  console.log("\x1b[31mALGUNS CENÁRIOS FALHARAM!\x1b[0m\n");
  process.exit(1);
}
