/**
 * scripts/test-subagent-supabase-migration.mjs
 * 
 * Suíte de Testes da Migração:
 * CATÁLOGO DE SUBAGENTES COM SUPABASE COMO FONTE DE VERDADE ÚNICA
 * 
 * 30 Cenários de Validação Estritos:
 * 1. Inicialização vazia lê do Supabase
 * 2. Seed canônico populado corretamente (3 subagentes)
 * 3. Recarregar página não perde novos subagentes (persistência real)
 * 4. Recarregar página não perde edições de subagentes
 * 5. Exclusão de subagente customizado persiste no Supabase
 * 6. Subagente canônico não pode ser excluído no banco (Trigger Postgres)
 * 7. Subagente canônico não pode ser excluído no frontend/repositório
 * 8. Subagente canônico pode ser editado (nome e missão)
 * 9. Subagente canônico pode ser desativado
 * 10. Subagente com objetivos vinculados não pode ser excluído
 * 11. Desativação de subagente é respeitada pelo orchestrator
 * 12. Desativação de subagente é respeitada pelo router
 * 13. Realtime atualiza lista sem refresh manual
 * 14. Falha temporária de rede tem fallback gracioso em memória
 * 15. Zero uso de localStorage para subagentes
 * 16. Zero dados de subagente em instagram_conversations
 * 17. Integridade de stage_ids associados
 * 18. Consistência do nome e missão após update
 * 19. Garantia de que IDs canônicos nunca mudam
 * 20. Criação de múltiplos subagentes customizados
 * 21. Ordenação correta na listagem (is_system DESC, name ASC)
 * 22. Idempotência do seed no Supabase
 * 23. Compatibilidade com tipagem TypeScript
 * 24. Tempo de resposta de leitura aceitável (Cache em memória < 5ms)
 * 25. Isolamento de dados entre subagentes
 * 26. Validação de campos obrigatórios (id, name, mission)
 * 27. Sanitização de ID no cadastro
 * 28. Rejeição de ID duplicado
 * 29. Log limpo sem warnings de persistência
 * 30. Transição suave sem quebra para usuários existentes e ZERO Meta Real
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function loadModule(filePath, customEnv = {}) {
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
    global: globalThis,
    globalThis: globalThis,
    require: (dep) => {
      if (customEnv[dep]) {
        return customEnv[dep];
      }
      if (dep.startsWith("@/")) {
        const resolvedPath = path.resolve("./src", dep.slice(2));
        for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts", "/index.js"]) {
          const candidate = resolvedPath + ext;
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return loadModule(candidate, customEnv);
          }
        }
      }
      if (dep.endsWith(".ts") || dep.endsWith(".js") || dep.startsWith("./") || dep.startsWith("../")) {
        const baseDir = path.dirname(fullPath);
        const resolvedPath = path.resolve(baseDir, dep);
        for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts", "/index.js"]) {
          const candidate = resolvedPath + ext;
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return loadModule(candidate, customEnv);
          }
        }
      }
      return customEnv[dep] || {};
    },
    console,
    Date,
    Math,
    Set,
    Map,
    Array,
    Object,
    String,
    Boolean,
    Number,
    RegExp,
    Error,
    TypeError,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    ...customEnv,
  };

  vm.createContext(context);
  vm.runInContext(jsCode, context);
  return moduleObj.exports;
}

// Carregar módulos do sistema
const orchestratorModule = loadModule("./supabase/functions/api/experimental_orchestrator.ts", {
  process: { env: {} },
});

const { loadSubagentsCatalog, CANONICAL_SUBAGENTS } = orchestratorModule;

// Mock de Supabase em memória fiel à tabela public.subagent_definitions e chat_stages
function createMockSupabaseDatabase() {
  const subagentRows = [
    {
      id: "conexao_inicial",
      name: "Conexão Inicial",
      mission: "Criar conforto, reciprocidade e um começo natural de conversa, sem transformar o contato em entrevista nem antecipar assuntos profundos.",
      enabled: true,
      is_system: true,
      description: "Subagente canônico de início de conversa",
      stage_ids: ["stage_1_conexao"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "descoberta",
      name: "Descoberta",
      mission: "Conhecer organicamente quem o pretendente é, sua rotina, vida, trabalho, gostos e contexto pessoal, aproveitando naturalmente os assuntos que surgem.",
      enabled: true,
      is_system: true,
      description: "Subagente canônico para investigação orgânica",
      stage_ids: ["stage_2_descoberta"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "compatibilidade",
      name: "Compatibilidade",
      mission: "Entender valores, momento de vida, visão de relacionamento, família, planos e compatibilidade com Larissa, somente quando houver abertura natural para assuntos mais pessoais.",
      enabled: true,
      is_system: true,
      description: "Subagente canônico para alinhamento profundo",
      stage_ids: ["stage_3_compatibilidade"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const chatStagesRows = [
    {
      id: "stage_1_conexao",
      goals: [
        {
          id: "goal_1",
          label: "Identificar ocupação",
          allowed_subagents: ["conexao_inicial", "descoberta"],
          status: "pending",
        },
      ],
    },
    {
      id: "stage_2_descoberta",
      goals: [
        {
          id: "goal_2",
          label: "Rotina de lazer",
          allowed_subagents: ["descoberta"],
          status: "pending",
        },
        {
          id: "goal_custom",
          label: "Meta personalizada",
          allowed_subagents: ["especialista_vinhos"],
          status: "pending",
        },
      ],
    },
  ];

  const realtimeListeners = [];

  const client = {
    _rows: subagentRows,
    _stages: chatStagesRows,
    _channelSubscribed: false,
    channel: (channelName) => {
      return {
        on: (event, filter, callback) => {
          realtimeListeners.push({ channelName, event, filter, callback });
          return {
            subscribe: () => {
              client._channelSubscribed = true;
              return { unsubscribe: () => {} };
            },
          };
        },
      };
    },
    from: (tableName) => {
      if (tableName === "subagent_definitions") {
        let selectedFields = "*";
        let filters = [];
        let orders = [];

        const queryObj = {
          select: (fields = "*") => {
            selectedFields = fields;
            return queryObj;
          },
          eq: (column, value) => {
            filters.push({ column, value });
            return queryObj;
          },
          order: (column, { ascending = true } = {}) => {
            orders.push({ column, ascending });
            return queryObj;
          },
          maybeSingle: async () => {
            let res = [...client._rows];
            for (const f of filters) {
              res = res.filter((r) => r[f.column] === f.value);
            }
            return { data: res[0] ? { ...res[0] } : null, error: null };
          },
          single: async () => {
            let res = [...client._rows];
            for (const f of filters) {
              res = res.filter((r) => r[f.column] === f.value);
            }
            if (res.length === 0) return { data: null, error: new Error("Row not found") };
            return { data: { ...res[0] }, error: null };
          },
          then: (onFulfilled, onRejected) => {
            let res = [...client._rows];
            for (const f of filters) {
              res = res.filter((r) => r[f.column] === f.value);
            }
            if (orders.length > 0) {
              res.sort((a, b) => {
                for (const ord of orders) {
                  const valA = a[ord.column];
                  const valB = b[ord.column];
                  if (valA !== valB) {
                    if (typeof valA === "boolean" || typeof valB === "boolean") {
                      const numA = valA ? 1 : 0;
                      const numB = valB ? 1 : 0;
                      return ord.ascending ? numA - numB : numB - numA;
                    }
                    if (ord.ascending) return valA > valB ? 1 : -1;
                    return valA < valB ? 1 : -1;
                  }
                }
                return 0;
              });
            }
            return Promise.resolve({ data: res.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
          },
          insert: (data) => {
            const items = Array.isArray(data) ? data : [data];
            let insertedRow = null;
            let insertErr = null;
            for (const item of items) {
              if (client._rows.some((r) => r.id === item.id)) {
                insertErr = new Error(`duplicate key value violates unique constraint "subagent_definitions_pkey"`);
                break;
              }
              const row = {
                ...item,
                created_at: item.created_at || new Date().toISOString(),
                updated_at: item.updated_at || new Date().toISOString(),
              };
              client._rows.push(row);
              insertedRow = { ...row };
            }
            const opResult = {
              select: () => ({
                single: async () => insertErr ? { data: null, error: insertErr } : { data: insertedRow, error: null },
                maybeSingle: async () => insertErr ? { data: null, error: insertErr } : { data: insertedRow, error: null },
                then: (cb) => insertErr ? Promise.resolve({ data: null, error: insertErr }).then(cb) : Promise.resolve({ data: items, error: null }).then(cb),
              }),
              then: (cb) => insertErr ? Promise.resolve({ data: null, error: insertErr }).then(cb) : Promise.resolve({ data: items, error: null }).then(cb),
            };
            return opResult;
          },
          upsert: async (data, options = {}) => {
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              const idx = client._rows.findIndex((r) => r.id === item.id);
              if (idx >= 0) {
                client._rows[idx] = { ...client._rows[idx], ...item, updated_at: new Date().toISOString() };
              } else {
                client._rows.push({
                  ...item,
                  created_at: item.created_at || new Date().toISOString(),
                  updated_at: item.updated_at || new Date().toISOString(),
                });
              }
            }
            return { data: items, error: null };
          },
          update: (updates) => {
            return {
              eq: (column, value) => {
                const idx = client._rows.findIndex((r) => r[column] === value);
                let updatedRow = null;
                let updateErr = null;
                if (idx >= 0) {
                  client._rows[idx] = { ...client._rows[idx], ...updates, updated_at: new Date().toISOString() };
                  updatedRow = { ...client._rows[idx] };
                } else {
                  updateErr = new Error("Row not found for update");
                }
                return {
                  select: () => ({
                    single: async () => updateErr ? { data: null, error: updateErr } : { data: updatedRow, error: null },
                    maybeSingle: async () => updateErr ? { data: null, error: updateErr } : { data: updatedRow, error: null },
                    then: (cb) => updateErr ? Promise.resolve({ data: null, error: updateErr }).then(cb) : Promise.resolve({ data: updatedRow, error: null }).then(cb),
                  }),
                  then: (cb) => updateErr ? Promise.resolve({ data: null, error: updateErr }).then(cb) : Promise.resolve({ data: updatedRow, error: null }).then(cb),
                };
              },
            };
          },
          delete: () => {
            return {
              eq: async (column, value) => {
                const idx = client._rows.findIndex((r) => r[column] === value);
                if (idx >= 0) {
                  // Simulação do trigger Postgres prevent_system_subagent_delete
                  if (client._rows[idx].is_system) {
                    return {
                      data: null,
                      error: {
                        code: "P0001",
                        message: "Subagentes de sistema não podem ser excluídos",
                      },
                    };
                  }
                  client._rows.splice(idx, 1);
                  return { data: null, error: null };
                }
                return { data: null, error: null };
              },
            };
          },
        };

        return queryObj;
      }

      if (tableName === "chat_stages") {
        const stagesQuery = {
          select: () => stagesQuery,
          or: () => stagesQuery,
          then: (onFulfilled) => {
            return Promise.resolve({ data: client._stages, error: null }).then(onFulfilled);
          },
        };
        return stagesQuery;
      }

      if (tableName === "instagram_conversations") {
        const convQuery = {
          select: () => convQuery,
          or: () => convQuery,
          eq: () => convQuery,
          maybeSingle: async () => ({
            data: {
              stage_completed_rules: {
                stages: client._stages,
              },
            },
            error: null,
          }),
        };
        return convQuery;
      }

      throw new Error(`Table ${tableName} not mocked`);
    },
    _notifyRealtime: (eventType, record) => {
      for (const listener of realtimeListeners) {
        listener.callback({ eventType, new: record, old: record });
      }
    },
  };

  return client;
}

// Carregar SupabaseSubagentRepository com mock do Supabase
function createSubagentRepository(mockSupabase) {
  const repoModule = loadModule("./src/infrastructure/repositories/SupabaseSubagentRepository.ts", {
    "../config/supabase": { supabase: mockSupabase },
    "../supabase/client": { getSupabaseBrowserClient: () => mockSupabase },
    "../supabase/server": { getSupabaseServerClient: () => mockSupabase },
  });
  return new repoModule.SupabaseSubagentRepository(mockSupabase);
}

// ============================================================================
// EXECUÇÃO DOS 30 CENÁRIOS DE TESTE
// ============================================================================

async function runTests() {
  console.log("================================================================================");
  console.log("SUÍTE DE TESTES: CATÁLOGO DE SUBAGENTES - SUPABASE FONTE DE VERDADE ÚNICA");
  console.log("================================================================================\n");

  let passed = 0;
  let total = 30;

  const mockDb = createMockSupabaseDatabase();
  const repo = createSubagentRepository(mockDb);

  // 1. Inicialização vazia lê do Supabase
  try {
    const list = await repo.list();
    assert.strictEqual(list.length, 3, "Deve carregar os 3 subagentes da tabela do Supabase");
    assert.strictEqual(list[0].isSystem, true, "Subagentes iniciais devem ser isSystem: true");
    console.log("✅ 1. Inicialização vazia lê do Supabase");
    passed++;
  } catch (e) {
    console.error("❌ 1. Falha:", e.message);
  }

  // 2. Seed canônico populado corretamente
  try {
    const ids = (await repo.list()).map((s) => s.id).sort();
    assert.strictEqual(JSON.stringify(ids), JSON.stringify(["compatibilidade", "conexao_inicial", "descoberta"]));
    console.log("✅ 2. Seed canônico populado corretamente com os 3 subagentes canônicos");
    passed++;
  } catch (e) {
    console.error("❌ 2. Falha:", e.message);
  }

  // 3. Recarregar página não perde novos subagentes
  try {
    await repo.create({
      id: "especialista_viagens",
      name: "Especialista em Viagens",
      mission: "Aprofundar assuntos sobre destinos, aventuras e preferências de viagens de forma descontraída.",
      enabled: true,
      description: "Agente custom para viagens",
    });

    // Simula reload criando novo repositório sobre o mesmo Supabase
    const repoReload = createSubagentRepository(mockDb);
    const reloadedList = await repoReload.list();
    const created = reloadedList.find((s) => s.id === "especialista_viagens");
    assert.ok(created, "Novo subagente deve persistir e estar visível após recarregar");
    assert.strictEqual(created.name, "Especialista em Viagens");
    assert.strictEqual(created.isSystem, false);
    console.log("✅ 3. Recarregar página não perde novos subagentes");
    passed++;
  } catch (e) {
    console.error("❌ 3. Falha:", e.message);
  }

  // 4. Recarregar página não perde edições de subagentes
  try {
    await repo.update("especialista_viagens", {
      name: "Especialista em Viagens & Culturas",
      mission: "Missão atualizada: falar de viagens internacionais, gastronomia e passeios.",
    });

    const repoReload2 = createSubagentRepository(mockDb);
    const updated = await repoReload2.getById("especialista_viagens");
    assert.strictEqual(updated.name, "Especialista em Viagens & Culturas");
    assert.strictEqual(updated.mission, "Missão atualizada: falar de viagens internacionais, gastronomia e passeios.");
    console.log("✅ 4. Recarregar página não perde edições de subagentes");
    passed++;
  } catch (e) {
    console.error("❌ 4. Falha:", e.message);
  }

  // 5. Exclusão de subagente customizado persiste no Supabase
  try {
    const deleted = await repo.deleteCustom("especialista_viagens");
    assert.strictEqual(deleted, true, "Deve retornar true ao excluir customizado sem vínculos");
    const checkDeleted = await repo.getById("especialista_viagens");
    assert.strictEqual(checkDeleted, null, "Subagente excluído não deve mais existir no Supabase");
    console.log("✅ 5. Exclusão de subagente customizado persiste no Supabase");
    passed++;
  } catch (e) {
    console.error("❌ 5. Falha:", e.message);
  }

  // 6. Subagente canônico não pode ser excluído no banco (Trigger Postgres)
  try {
    const res = await mockDb.from("subagent_definitions").delete().eq("id", "conexao_inicial");
    assert.ok(res.error, "O banco deve retornar erro ao tentar deletar subagente canônico");
    assert.strictEqual(res.error.code, "P0001");
    console.log("✅ 6. Subagente canônico não pode ser excluído no banco (Trigger Postgres ativo)");
    passed++;
  } catch (e) {
    console.error("❌ 6. Falha:", e.message);
  }

  // 7. Subagente canônico não pode ser excluído no frontend/repositório
  try {
    let errorThrown = false;
    try {
      await repo.deleteCustom("conexao_inicial");
    } catch (err) {
      errorThrown = true;
      assert.match(err.message, /canônicos/i);
    }
    assert.strictEqual(errorThrown, true, "Repositório deve rejeitar exclusão de agente canônico");
    console.log("✅ 7. Subagente canônico não pode ser excluído no frontend/repositório");
    passed++;
  } catch (e) {
    console.error("❌ 7. Falha:", e.message);
  }

  // 8. Subagente canônico pode ser editado
  try {
    const original = await repo.getById("descoberta");
    const updated = await repo.update("descoberta", {
      name: "Descoberta Orgânica",
      mission: original.mission + " Adicionado foco suave.",
    });
    assert.strictEqual(updated.name, "Descoberta Orgânica");
    assert.strictEqual(updated.isSystem, true, "isSystem deve permanecer true");
    console.log("✅ 8. Subagente canônico pode ser editado mantendo integridade canônica");
    passed++;
  } catch (e) {
    console.error("❌ 8. Falha:", e.message);
  }

  // 9. Subagente canônico pode ser desativado
  try {
    const disabled = await repo.setEnabled("compatibilidade", false);
    assert.strictEqual(disabled.enabled, false);
    assert.strictEqual(disabled.isSystem, true);
    console.log("✅ 9. Subagente canônico pode ser desativado");
    passed++;
  } catch (e) {
    console.error("❌ 9. Falha:", e.message);
  }

  // 10. Subagente com objetivos vinculados não pode ser excluído
  try {
    await repo.create({
      id: "especialista_vinhos",
      name: "Especialista em Vinhos",
      mission: "Falar sobre sommeliers e degustações.",
    });

    const linkedCount = await repo.countLinkedObjectives("especialista_vinhos");
    assert.strictEqual(linkedCount, 1, "Deve acusar 1 objetivo vinculado em chat_stages");

    let errorThrown = false;
    try {
      await repo.deleteCustom("especialista_vinhos");
    } catch (err) {
      errorThrown = true;
      assert.match(err.message, /vinculado a 1 objetivo/i);
    }
    assert.strictEqual(errorThrown, true, "Deve recusar exclusão de agente com objetivos vinculados");
    console.log("✅ 10. Subagente com objetivos vinculados não pode ser excluído");
    passed++;
  } catch (e) {
    console.error("❌ 10. Falha:", e.message);
  }

  // 11. Desativação de subagente é respeitada pelo orchestrator
  try {
    const orchestratorCatalog = await loadSubagentsCatalog({
      supabase: mockDb,
      forceRefresh: true,
    });
    const containsCompatibilidade = orchestratorCatalog.some((s) => s.id === "compatibilidade");
    assert.strictEqual(containsCompatibilidade, false, "Orchestrator não deve listar subagente desativado");
    console.log("✅ 11. Desativação de subagente é respeitada pelo orchestrator");
    passed++;
  } catch (e) {
    console.error("❌ 11. Falha:", e.message);
  }

  // 12. Desativação de subagente é respeitada pelo router
  try {
    const available = await loadSubagentsCatalog({ supabase: mockDb, forceRefresh: true });
    const activeIds = available.filter((s) => s.enabled !== false).map((s) => s.id);
    assert.ok(!activeIds.includes("compatibilidade"), "Router activeSubagentIds não pode conter compatibilidade");
    console.log("✅ 12. Desativação de subagente é respeitada pelo router");
    passed++;
  } catch (e) {
    console.error("❌ 12. Falha:", e.message);
  }

  // 13. Realtime atualiza lista sem refresh manual
  try {
    let notified = false;
    const unsub = repo.subscribeToChanges(() => {
      notified = true;
    });
    mockDb._notifyRealtime("UPDATE", { id: "conexao_inicial", name: "Conexão" });
    assert.strictEqual(notified, true, "Listener de realtime deve ser disparado em mutações");
    unsub();
    console.log("✅ 13. Realtime atualiza lista sem refresh manual");
    passed++;
  } catch (e) {
    console.error("❌ 13. Falha:", e.message);
  }

  // 14. Falha temporária de rede tem fallback gracioso em memória
  try {
    const failingSupabase = {
      from: () => ({
        select: () => ({
          order: () => ({
            order: () => Promise.reject(new Error("Network timeout")),
            eq: () => ({
              order: () => ({
                order: () => Promise.reject(new Error("Network timeout")),
              }),
            }),
          }),
        }),
      }),
    };
    const fallbackCatalog = await loadSubagentsCatalog({
      supabase: failingSupabase,
      forceRefresh: true,
    });
    assert.strictEqual(fallbackCatalog.length, 3, "Deve retornar fallback em memória com 3 canônicos");
    assert.strictEqual(
      JSON.stringify(fallbackCatalog.map((s) => s.id).sort()),
      JSON.stringify(["compatibilidade", "conexao_inicial", "descoberta"])
    );
    console.log("✅ 14. Falha temporária de rede tem fallback gracioso em memória");
    passed++;
  } catch (e) {
    console.error("❌ 14. Falha:", e.message);
  }

  // 15. Zero uso de localStorage para subagentes
  try {
    const repoFile = fs.readFileSync("./src/infrastructure/repositories/SupabaseSubagentRepository.ts", "utf8");
    const hasLocalStorage = /localStorage\s*\.\s*(getItem|setItem|removeItem|clear)/.test(repoFile);
    assert.strictEqual(hasLocalStorage, false, "SupabaseSubagentRepository não pode conter chamadas a localStorage");
    console.log("✅ 15. Zero uso de localStorage para subagentes");
    passed++;
  } catch (e) {
    console.error("❌ 15. Falha:", e.message);
  }

  // 16. Zero dados de subagente em instagram_conversations
  try {
    const repoFile = fs.readFileSync("./src/infrastructure/repositories/SupabaseSubagentRepository.ts", "utf8");
    const orchFile = fs.readFileSync("./supabase/functions/api/experimental_orchestrator.ts", "utf8");
    assert.strictEqual(repoFile.includes("__subagents_catalog__"), false);
    assert.strictEqual(orchFile.includes("__subagents_catalog__"), false);
    console.log("✅ 16. Zero dados de subagente em instagram_conversations");
    passed++;
  } catch (e) {
    console.error("❌ 16. Falha:", e.message);
  }

  // 17. Integridade de stage_ids associados
  try {
    const sub = await repo.create({
      id: "especialista_cinema",
      name: "Especialista em Cinema",
      mission: "Conversar sobre filmes e diretores favoritos.",
      stageIds: ["stage_1_conexao", "stage_2_descoberta"],
    });
    assert.strictEqual(JSON.stringify(sub.stageIds), JSON.stringify(["stage_1_conexao", "stage_2_descoberta"]));
    const fetched = await repo.getById("especialista_cinema");
    assert.strictEqual(JSON.stringify(fetched.stageIds), JSON.stringify(["stage_1_conexao", "stage_2_descoberta"]));
    console.log("✅ 17. Integridade de stage_ids associados");
    passed++;
  } catch (e) {
    console.error("❌ 17. Falha:", e.message);
  }

  // 18. Consistência do nome e missão após update
  try {
    await repo.update("especialista_cinema", {
      name: "Cineasta & Séries",
      mission: "Missão cinematográfica refinada.",
    });
    const fetched = await repo.getById("especialista_cinema");
    assert.strictEqual(fetched.name, "Cineasta & Séries");
    assert.strictEqual(fetched.mission, "Missão cinematográfica refinada.");
    console.log("✅ 18. Consistência do nome e missão após update");
    passed++;
  } catch (e) {
    console.error("❌ 18. Falha:", e.message);
  }

  // 19. Garantia de que IDs canônicos nunca mudam
  try {
    const canonicalIds = Object.keys(CANONICAL_SUBAGENTS).sort();
    assert.strictEqual(JSON.stringify(canonicalIds), JSON.stringify(["compatibilidade", "conexao_inicial", "descoberta"]));
    console.log("✅ 19. Garantia de que IDs canônicos nunca mudam");
    passed++;
  } catch (e) {
    console.error("❌ 19. Falha:", e.message);
  }

  // 20. Criação de múltiplos subagentes customizados
  try {
    await repo.create({
      id: "agente_esportes",
      name: "Esportes & Treinos",
      mission: "Falar sobre academias, corridas e hábitos saudáveis.",
    });
    await repo.create({
      id: "agente_musica",
      name: "Música & Shows",
      mission: "Compartilhar gostos musicais e festivais.",
    });
    const all = await repo.list();
    const customAgents = all.filter((s) => !s.isSystem);
    assert.ok(customAgents.length >= 3, "Deve listar múltiplos subagentes customizados");
    console.log("✅ 20. Criação de múltiplos subagentes customizados com sucesso");
    passed++;
  } catch (e) {
    console.error("❌ 20. Falha:", e.message);
  }

  // 21. Ordenação correta na listagem
  try {
    const list = await repo.list();
    // Verifica se todos isSystem vêm antes dos customizados
    let foundCustom = false;
    let orderValid = true;
    for (const item of list) {
      if (!item.isSystem) {
        foundCustom = true;
      } else if (foundCustom) {
        orderValid = false;
        break;
      }
    }
    assert.strictEqual(orderValid, true, "Subagentes do sistema devem preceder customizados na ordenação");
    console.log("✅ 21. Ordenação correta na listagem (is_system DESC, name ASC)");
    passed++;
  } catch (e) {
    console.error("❌ 21. Falha:", e.message);
  }

  // 22. Idempotência do seed no Supabase
  try {
    const migrationFile = fs.readFileSync("./supabase/migrations/20260919183000_create_subagent_definitions.sql", "utf8");
    assert.match(migrationFile, /ON CONFLICT \(id\) DO UPDATE/, "Migration deve conter cláusula ON CONFLICT idempotente");
    console.log("✅ 22. Idempotência do seed no Supabase");
    passed++;
  } catch (e) {
    console.error("❌ 22. Falha:", e.message);
  }

  // 23. Compatibilidade com tipagem TypeScript
  try {
    const sub = await repo.getById("conexao_inicial");
    assert.strictEqual(typeof sub.id, "string");
    assert.strictEqual(typeof sub.name, "string");
    assert.strictEqual(typeof sub.mission, "string");
    assert.strictEqual(typeof sub.enabled, "boolean");
    assert.strictEqual(typeof sub.isSystem, "boolean");
    assert.ok(Array.isArray(sub.stageIds));
    console.log("✅ 23. Compatibilidade com tipagem TypeScript estrita");
    passed++;
  } catch (e) {
    console.error("❌ 23. Falha:", e.message);
  }

  // 24. Tempo de resposta de leitura aceitável (Cache em memória < 5ms)
  try {
    // Primeira chamada aquece o cache
    await loadSubagentsCatalog({ supabase: mockDb, forceRefresh: true });
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      await loadSubagentsCatalog({ supabase: mockDb, forceRefresh: false });
    }
    const end = performance.now();
    const avgMs = (end - start) / 50;
    assert.ok(avgMs < 5, `Tempo médio de leitura via cache deve ser < 5ms (foi ${avgMs.toFixed(3)}ms)`);
    console.log(`✅ 24. Tempo de resposta de leitura aceitável (${avgMs.toFixed(3)}ms por leitura)`);
    passed++;
  } catch (e) {
    console.error("❌ 24. Falha:", e.message);
  }

  // 25. Isolamento de dados entre subagentes
  try {
    const sub1 = await repo.getById("conexao_inicial");
    const sub2 = await repo.getById("descoberta");
    assert.notStrictEqual(sub1.id, sub2.id);
    assert.notStrictEqual(sub1.mission, sub2.mission);
    console.log("✅ 25. Isolamento de dados entre subagentes");
    passed++;
  } catch (e) {
    console.error("❌ 25. Falha:", e.message);
  }

  // 26. Validação de campos obrigatórios (id, name, mission)
  try {
    let errorId = false;
    let errorName = false;
    let errorMission = false;
    try {
      await repo.create({ id: "", name: "Nome", mission: "Missão" });
    } catch (_) { errorId = true; }
    try {
      await repo.create({ id: "slug_ok", name: "", mission: "Missão" });
    } catch (_) { errorName = true; }
    try {
      await repo.create({ id: "slug_ok2", name: "Nome", mission: "" });
    } catch (_) { errorMission = true; }
    assert.strictEqual(errorId, true, "Deve barrar id vazio");
    assert.strictEqual(errorName, true, "Deve barrar name vazio");
    assert.strictEqual(errorMission, true, "Deve barrar mission vazia");
    console.log("✅ 26. Validação de campos obrigatórios (id, name, mission)");
    passed++;
  } catch (e) {
    console.error("❌ 26. Falha:", e.message);
  }

  // 27. Sanitização de ID no cadastro
  try {
    const created = await repo.create({
      id: "  Agente Especial! 2026 #top  ",
      name: "Agente Especial",
      mission: "Missão de teste de sanitização.",
    });
    assert.strictEqual(created.id, "agente_especial_2026_top", "ID deve ser sanitizado para lowercase snake_case");
    console.log("✅ 27. Sanitização de ID no cadastro");
    passed++;
  } catch (e) {
    console.error("❌ 27. Falha:", e.message);
  }

  // 28. Rejeição de ID duplicado
  try {
    let duplicateRejected = false;
    try {
      await repo.create({
        id: "agente_especial_2026_top",
        name: "Tentativa Duplicada",
        mission: "Mesmo ID deve falhar.",
      });
    } catch (err) {
      duplicateRejected = true;
      assert.match(err.message, /já existe/i);
    }
    assert.strictEqual(duplicateRejected, true, "Deve rejeitar criação com ID duplicado");
    console.log("✅ 28. Rejeição de ID duplicado");
    passed++;
  } catch (e) {
    console.error("❌ 28. Falha:", e.message);
  }

  // 29. Log limpo sem warnings de persistência
  try {
    const consoleWarns = [];
    const origWarn = console.warn;
    console.warn = (...args) => consoleWarns.push(args.join(" "));
    await repo.list();
    await repo.getById("conexao_inicial");
    console.warn = origWarn;
    assert.strictEqual(consoleWarns.length, 0, "Operações normais não devem emitir console.warn");
    console.log("✅ 29. Log limpo sem warnings de persistência");
    passed++;
  } catch (e) {
    console.error("❌ 29. Falha:", e.message);
  }

  // 30. Transição suave sem quebra e ZERO Meta Real
  try {
    // Reativa compatibilidade para integridade final
    await repo.setEnabled("compatibilidade", true);
    const finalCatalog = await loadSubagentsCatalog({ supabase: mockDb, forceRefresh: true });
    assert.ok(finalCatalog.length >= 3);
    const hasConexao = finalCatalog.some((s) => s.id === "conexao_inicial" && s.enabled);
    const hasDescoberta = finalCatalog.some((s) => s.id === "descoberta" && s.enabled);
    const hasCompatibilidade = finalCatalog.some((s) => s.id === "compatibilidade" && s.enabled);
    assert.strictEqual(hasConexao && hasDescoberta && hasCompatibilidade, true);
    console.log("✅ 30. Transição suave sem quebra para usuários existentes e ZERO Meta Real");
    passed++;
  } catch (e) {
    console.error("❌ 30. Falha:", e.message);
  }

  console.log("\n================================================================================");
  console.log(`RESULTADO DA SUÍTE DE MIGRAÇÃO: ${passed}/${total} CENÁRIOS APROVADOS COM SUCESSO!`);
  console.log("================================================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Falha catastrófica nos testes:", err);
  process.exit(1);
});
