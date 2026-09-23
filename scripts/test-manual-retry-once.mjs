// ============================================================================
// scripts/test-manual-retry-once.mjs
// Suíte de Testes do Retry Manual Seguro (10 Cenários Obrigatórios)
// Clean Architecture & Resiliência Fail-Closed
// ============================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

console.log("==================================================================");
console.log("INICIANDO SUÍTE DE TESTES: AUTORIZAÇÃO MANUAL DE RETRY (10 CENÁRIOS)");
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
  vm.runInNewContext(transpiled, { module: moduleObj, exports: moduleObj.exports, console, Date }, { filename: "brain_orchestrator.ts" });
  return moduleObj.exports.authorizeManualAutopilotRetryAtomic;
}

const authorizeManualAutopilotRetryAtomic = loadAuthorizeManualAutopilotRetryAtomic();

function createMockSupabase(initialConversations = {}, initialMessages = []) {
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
      // Mock da RPC authorize_manual_autopilot_retry espelhando com precisão a migration PostgreSQL
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

        for (const entry of Object.values(outbox)) {
          if (entry.status === "sent" || (entry.providerMessageId && entry.providerMessageId !== "")) {
            return { data: { success: false, reason: "outbox_already_sent", message: "Já existe mensagem enviada confirmada neste lote." }, error: null };
          }
          if (entry.status === "sending") {
            return { data: { success: false, reason: "outbox_sending", message: "Existe mensagem em processo de envio no momento." }, error: null };
          }
          if (entry.status === "dispatch_uncertain" || entry.isUncertain === true) {
            return { data: { success: false, reason: "outbox_uncertain", message: "Há um envio anterior com confirmação incerta. Não é seguro reenviar automaticamente." }, error: null };
          }
        }

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
// CENÁRIO 1: Retry esgotado + inbound pending -> autoriza única tentativa manual e cria novo cycleToken
// ==========================================
await runScenario("Retry esgotado com pendência autoriza única tentativa manual", async () => {
  const supabase = createMockSupabase({
    conv_1: {
      id: "conv_1",
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: null,
        orchestration: {
          technicalRetryCount: 3,
          technicalRetryExhaustedAt: new Date(Date.now() - 60_000).toISOString(),
          lastCycleId: "cycle_old_failed",
          lastError: "technical_retry_exhausted",
          messageLedger: { msg_1: "pending" },
          outbox: {},
        },
      },
    },
  });

  const res = await authorizeManualAutopilotRetryAtomic({
    supabase,
    conversationId: "conv_1",
    newCycleToken: "manual_cycle_101",
  });

  assert.equal(res.success, true);
  assert.equal(res.reason, "authorized");
  assert.equal(res.cycleToken, "manual_cycle_101");
  assert.equal(res.previousCycleToken, "cycle_old_failed");
  assert.equal(res.pendingCount, 1);
  assert.deepEqual(res.pendingMessageIds, ["msg_1"]);

  // Verifica persistência imediata do lock no banco
  const conv = supabase._conversations.conv_1;
  assert.equal(conv.stage_completed_rules.active_cycle_token, "manual_cycle_101");
  assert.equal(conv.stage_completed_rules.orchestration.manualRetryAttempt, true);
  assert.equal(conv.stage_completed_rules.orchestration.manualRetryCycleId, "manual_cycle_101");
  assert.equal(conv.stage_completed_rules.orchestration.manualRetryOfCycleId, "cycle_old_failed");
});

// ==========================================
// CENÁRIO 2: Tentativa concorrente / clique duplo com o ciclo ativo -> fail-closed/idempotente
// ==========================================
await runScenario("Clique duplo ou tentativa concorrente é recusada com active_cycle_running", async () => {
  const supabase = createMockSupabase({
    conv_2: {
      id: "conv_2",
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: "manual_cycle_in_flight",
        active_cycle_at: new Date().toISOString(),
        orchestration: {
          technicalRetryCount: 3,
          technicalRetryExhaustedAt: new Date().toISOString(),
          messageLedger: { msg_2: "pending" },
          outbox: {},
        },
      },
    },
  });

  const res = await authorizeManualAutopilotRetryAtomic({
    supabase,
    conversationId: "conv_2",
    newCycleToken: "manual_cycle_double_click",
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, "active_cycle_running");
  assert.equal(res.activeCycleToken, "manual_cycle_in_flight");
});

// ==========================================
// CENÁRIO 3: Conversa com ciclo ativo legítimo de outro worker (< 300s) -> recusado
// ==========================================
await runScenario("Ciclo ativo legítimo de outro worker bloqueia autorização", async () => {
  const supabase = createMockSupabase({
    conv_3: {
      id: "conv_3",
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: "worker_cron_active",
        active_cycle_at: new Date(Date.now() - 5000).toISOString(),
        orchestration: {
          technicalRetryCount: 3,
          messageLedger: { msg_3: "pending" },
          outbox: {},
        },
      },
    },
  });

  const res = await authorizeManualAutopilotRetryAtomic({
    supabase,
    conversationId: "conv_3",
    newCycleToken: "manual_3",
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, "active_cycle_running");
});

// ==========================================
// CENÁRIO 4: Conversa com outbox sent no lote -> recusado fail-closed
// ==========================================
await runScenario("Lote com outbox sent anterior é recusado por segurança contra duplicidade", async () => {
  const supabase = createMockSupabase({
    conv_4: {
      id: "conv_4",
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: null,
        orchestration: {
          technicalRetryCount: 3,
          technicalRetryExhaustedAt: new Date().toISOString(),
          messageLedger: { msg_4: "pending" },
          outbox: {
            out_1: { status: "sent", providerMessageId: "meta_msg_999" },
          },
        },
      },
    },
  });

  const res = await authorizeManualAutopilotRetryAtomic({
    supabase,
    conversationId: "conv_4",
    newCycleToken: "manual_4",
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, "outbox_already_sent");
});

// ==========================================
// CENÁRIO 5: Conversa com outbox dispatch_uncertain -> recusado fail-closed
// ==========================================
await runScenario("Lote com outbox incerta (dispatch_uncertain) é recusado fail-closed", async () => {
  const supabase = createMockSupabase({
    conv_5: {
      id: "conv_5",
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: null,
        orchestration: {
          technicalRetryCount: 3,
          technicalRetryExhaustedAt: new Date().toISOString(),
          messageLedger: { msg_5: "pending" },
          outbox: {
            out_1: { status: "dispatch_uncertain", isUncertain: true },
          },
        },
      },
    },
  });

  const res = await authorizeManualAutopilotRetryAtomic({
    supabase,
    conversationId: "conv_5",
    newCycleToken: "manual_5",
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, "outbox_uncertain");
});

// ==========================================
// CENÁRIO 6: Conversa com outbox sending ativo -> recusado
// ==========================================
await runScenario("Lote com outbox em sending é recusado", async () => {
  const supabase = createMockSupabase({
    conv_6: {
      id: "conv_6",
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: null,
        orchestration: {
          technicalRetryCount: 3,
          technicalRetryExhaustedAt: new Date().toISOString(),
          messageLedger: { msg_6: "pending" },
          outbox: {
            out_1: { status: "sending" },
          },
        },
      },
    },
  });

  const res = await authorizeManualAutopilotRetryAtomic({
    supabase,
    conversationId: "conv_6",
    newCycleToken: "manual_6",
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, "outbox_sending");
});

// ==========================================
// CENÁRIO 7: Conversa sem mensagens inbound pendentes -> recusado
// ==========================================
await runScenario("Conversa sem pendências no ledger nem inbounds recentes é recusada", async () => {
  const supabase = createMockSupabase({
    conv_7: {
      id: "conv_7",
      ai_auto_respond: true,
      stage_completed_rules: {
        active_cycle_token: null,
        orchestration: {
          technicalRetryCount: 3,
          technicalRetryExhaustedAt: new Date().toISOString(),
          messageLedger: { msg_7: "processed" },
          outbox: {},
        },
      },
    },
  });

  const res = await authorizeManualAutopilotRetryAtomic({
    supabase,
    conversationId: "conv_7",
    newCycleToken: "manual_7",
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, "no_pending_messages");
});

// ==========================================
// CENÁRIO 8: Conversa com autopilot desativado -> recusado
// ==========================================
await runScenario("Conversa com ai_auto_respond = false é recusada", async () => {
  const supabase = createMockSupabase({
    conv_8: {
      id: "conv_8",
      ai_auto_respond: false,
      stage_completed_rules: {
        active_cycle_token: null,
        orchestration: {
          technicalRetryCount: 3,
          technicalRetryExhaustedAt: new Date().toISOString(),
          messageLedger: { msg_8: "pending" },
          outbox: {},
        },
      },
    },
  });

  const res = await authorizeManualAutopilotRetryAtomic({
    supabase,
    conversationId: "conv_8",
    newCycleToken: "manual_8",
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, "autopilot_disabled");
});

// ==========================================
// CENÁRIO 9: Contrato de falha manual (volta para exhausted sem agendamento no cron)
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
// CENÁRIO 10: Contrato de sucesso manual (zera technicalRetryCount e limpa exhausted)
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
  console.log("\x1b[32mTODOS OS 10 CENÁRIOS FORAM APROVADOS COM SUCESSO!\x1b[0m\n");
  process.exit(0);
} else {
  console.log("\x1b[31mALGUNS CENÁRIOS FALHARAM!\x1b[0m\n");
  process.exit(1);
}
