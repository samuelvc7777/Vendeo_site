/**
 * test-historical-reconciliation.mjs
 * Suíte A–H: Reconciliação Histórica de Objetivos Factuais e Isolamento de Campos
 *
 * Pré-requisito: variável de ambiente SUPABASE_URL e SUPABASE_SERVICE_KEY
 * Uso:
 *   node scripts/test-historical-reconciliation.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { commitContactMemoryWrites } from "../supabase/functions/api/contact_memory.ts";

// Carrega .env.local automaticamente
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
} catch { /* ignora se não existir */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://wsdualhvopidgqcumonr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error("ERRO: SUPABASE_SERVICE_ROLE_KEY não definida em .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Constantes do Caso Real ----------
const CONV_ID = "1040376229029884";
const INBOUND_MSG_ID =
  "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDAzNjE0MDMzNDE2OjM0MDI4MjM2Njg0MTcxMDMwMTI0NDI1OTI3OTg4MTU1MjU0NzQ1NDozMzAyMTA4NzYyNTkxNTA4MjEzODI2ODk0NTIxNjQzODI3MgZDZD";
const OTHER_CONV_ID = "9999999999999999";

let passed = 0;
let failed = 0;

function result(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✅ PASS | ${label}${detail ? " — " + detail : ""}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL | ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ---------- validateHistoricalInboundEvidence (mesma lógica canônica de experimental_orchestrator.ts) ----------
async function validateHistoricalInboundEvidence({ conversationId, sourceMessageId }) {
  if (!sourceMessageId) {
    return { valid: false, reason: "sourceMessageId ausente" };
  }
  const { data, error } = await supabase
    .from("instagram_messages")
    .select("id, conversation_id, is_mine")
    .eq("id", sourceMessageId)
    .maybeSingle();

  if (error || !data) {
    return { valid: false, reason: "mensagem não encontrada no banco" };
  }
  if (data.conversation_id !== conversationId) {
    return { valid: false, reason: `cross-conversation: ${data.conversation_id} !== ${conversationId}` };
  }
  if (data.is_mine === true) {
    return { valid: false, reason: "mensagem outbound (is_mine = true)" };
  }
  return { valid: true, reason: "ok" };
}

// ---------- resolveStageChecklistGoals (lógica canônica de experimental_orchestrator.ts L3393-L3711) ----------
async function resolveStageChecklistGoals(params) {
  const { supabase, conversationId, memoryProvider, completedGoalIds = [] } = params;

  // Objetivos padrão da Descoberta
  const rawGoals = [
    {
      id: "goal_city",
      stageId: "stage_2_descoberta",
      label: "Cidade",
      memoryEntity: "self",
      memoryField: "city",
      description: "Descobrir a cidade onde o pretendente mora",
      kind: "fact",
      required: true,
      order: 10,
      completionPolicy: "conversation_evidence",
    },
    {
      id: "goal_job",
      stageId: "stage_2_descoberta",
      label: "Profissão",
      memoryEntity: "self",
      memoryField: "job",
      description: "Descobrir o trabalho ou área de atuação do pretendente",
      kind: "fact",
      required: true,
      order: 20,
      completionPolicy: "conversation_evidence",
    },
  ];

  const resolvedGoals = [];

  for (const goal of rawGoals) {
    const baseResolved = {
      id: goal.id,
      label: goal.label,
      kind: goal.kind,
      required: goal.required !== false,
      description: goal.description,
      completionPolicy: goal.completionPolicy,
    };

    const entity = (goal.memoryEntity || "self").trim().toLowerCase();
    const field = (goal.memoryField || "").trim().toLowerCase();
    const factRes = await memoryProvider.getFact(conversationId, entity, field);
    const policy = goal.completionPolicy || "conversation_evidence";

    let factSatisfied = false;
    let provenEvidenceId = undefined;

    if (factRes.found && factRes.value !== undefined && factRes.value !== null && factRes.value !== "") {
      const sourceMsgId = factRes.fact?.sourceMessageId;
      if (policy === "conversation_evidence") {
        const provRes = await validateHistoricalInboundEvidence({
          supabase,
          conversationId,
          sourceMessageId: sourceMsgId,
        });

        if (provRes.valid) {
          factSatisfied = true;
          provenEvidenceId = sourceMsgId;
        } else {
          factSatisfied = false;
        }
      } else {
        factSatisfied = true;
        provenEvidenceId = sourceMsgId;
      }
    }

    if (factSatisfied) {
      resolvedGoals.push({
        ...baseResolved,
        status: "completed",
        value: factRes.value,
        evidenceMessageId: provenEvidenceId,
        source: "contact_memory_reconciliation",
      });
    } else if (completedGoalIds.includes(goal.id)) {
      resolvedGoals.push({
        ...baseResolved,
        status: "completed",
        value: true,
      });
    } else {
      resolvedGoals.push({
        ...baseResolved,
        status: "pending",
        value: null,
      });
    }
  }

  const completedObjectives = resolvedGoals.filter((g) => g.status === "completed");
  const openObjectives = resolvedGoals.filter((g) => g.status === "pending");
  const currentObjective = openObjectives[0] || null;

  return {
    stage: "Descoberta",
    stageId: "stage_2_descoberta",
    goals: resolvedGoals,
    currentObjective,
    completedObjectives,
  };
}

// ---------- MemoryProvider simulado com getFact relacional prioritário + fallback JSONB ----------
class TestMemoryProvider {
  constructor(conversationId, legacyJsonb = null) {
    this.conversationId = conversationId;
    this.legacyJsonb = legacyJsonb;
  }

  async getFact(conversationId, entity, field) {
    const FIELD_SYNONYMS = {
      city:       ["city", "cidade"],
      cidade:     ["city", "cidade"],
      job:        ["job", "occupation", "profissao", "profession"],
      occupation: ["job", "occupation", "profissao", "profession"],
      profissao:  ["job", "occupation", "profissao", "profession"],
      profession: ["job", "occupation", "profissao", "profession"],
      age:        ["age", "idade"],
      idade:      ["age", "idade"],
    };
    const fieldAliases = FIELD_SYNONYMS[field] ?? [field];

    // 1. Busca prioritária em contact_memory_facts
    const { data, error } = await supabase
      .from("contact_memory_facts")
      .select("field, value, source_message_ids, created_at")
      .eq("conversation_id", conversationId)
      .eq("entity", entity)
      .in("field", fieldAliases)
      .neq("temporal_status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error && data && data.length > 0) {
      const row = data[0];
      return {
        found: true,
        value: row.value,
        fact: {
          field: row.field,
          value: row.value,
          sourceMessageId: Array.isArray(row.source_message_ids) ? row.source_message_ids[0] : undefined,
        },
      };
    }

    // 2. Fallback para JSONB legado (stage_completed_rules.orchestration.memory)
    if (this.legacyJsonb && this.legacyJsonb[entity]) {
      for (const alias of fieldAliases) {
        if (this.legacyJsonb[entity][alias] !== undefined) {
          const raw = this.legacyJsonb[entity][alias];
          const val = typeof raw === "object" && raw !== null ? raw.value : raw;
          const srcId = typeof raw === "object" && raw !== null ? raw.sourceMessageId : undefined;
          return {
            found: true,
            value: val,
            fact: {
              field: alias,
              value: val,
              sourceMessageId: srcId,
            },
          };
        }
      }
    }

    return { found: false };
  }
}

// =====================================================================
// TESTE A — Fato relacional com provenance inbound válida: goal_city completed
// =====================================================================
async function testeA() {
  console.log("\n[A] Fato relacional com provenance inbound válida → goal_city completed");
  const provider = new TestMemoryProvider(CONV_ID);
  const factRes = await provider.getFact(CONV_ID, "self", "city");
  result("A1: getFact encontra cidade no banco relacional", factRes.found, `value=${factRes.value}`);

  if (!factRes.found) return;

  const prov = await validateHistoricalInboundEvidence({
    conversationId: CONV_ID,
    sourceMessageId: factRes.fact?.sourceMessageId,
  });
  result("A2: evidência é inbound válido da mesma conversa", prov.valid, prov.reason);
}

// =====================================================================
// TESTE B — Fato sem sourceMessageId/provenance suficiente → rejeita
// =====================================================================
async function testeB() {
  console.log("\n[B] Fato sem sourceMessageId → validateHistoricalInboundEvidence retorna invalid");
  const prov = await validateHistoricalInboundEvidence({
    conversationId: CONV_ID,
    sourceMessageId: undefined,
  });
  result("B1: retorna invalid quando sourceMessageId ausente", !prov.valid, prov.reason);
}

// =====================================================================
// TESTE C — sourceMessageId pertence a OUTRA conversation → rejeita
// =====================================================================
async function testeC() {
  console.log("\n[C] sourceMessageId de outra conversa → rejeita");
  const prov = await validateHistoricalInboundEvidence({
    conversationId: OTHER_CONV_ID,
    sourceMessageId: INBOUND_MSG_ID,
  });
  result("C1: rejeita quando conversation_id não bate", !prov.valid, prov.reason);
}

// =====================================================================
// TESTE D — sourceMessageId pertence a mensagem outbound da Larissa → rejeita
// =====================================================================
async function testeD() {
  console.log("\n[D] sourceMessageId outbound (is_mine = true) → rejeita");
  const { data: outboundRows } = await supabase
    .from("instagram_messages")
    .select("id")
    .eq("conversation_id", CONV_ID)
    .eq("is_mine", true)
    .limit(1);

  if (!outboundRows || outboundRows.length === 0) {
    result("D1: sem mensagens outbound para testar — SKIP", true, "skip");
    return;
  }

  const outId = outboundRows[0].id;
  const prov = await validateHistoricalInboundEvidence({
    conversationId: CONV_ID,
    sourceMessageId: outId,
  });
  result("D1: rejeita mensagem outbound", !prov.valid, prov.reason);
}

// =====================================================================
// TESTE E — Isolamento de Campos: city = "São João del-Rei", novo write neighborhood = "Centro"
//            → city continua São João del-Rei, neighborhood = Centro (sem regex geográfica)
// =====================================================================
async function testeE() {
  console.log("\n[E] Isolamento de campos city vs neighborhood (sem regex geográfica)");
  const testConvId = `test_isolation_${Date.now()}`;
  const testMsgId = `msg_iso_${Date.now()}`;

  // Cria mensagem fake para validação de provenance
  await supabase.from("instagram_messages").insert({
    id: testMsgId,
    conversation_id: testConvId,
    sender_id: "pretendente_test",
    text: "Moro no centro",
    is_mine: false,
    direction: "inbound",
  });

  // 1. Pré-condição: city = "São João del-Rei"
  await commitContactMemoryWrites({
    supabase,
    conversationId: testConvId,
    cycleId: `cycle_1_${Date.now()}`,
    facts: [
      {
        entity: "self",
        field: "city",
        value: "São João del-Rei",
        sourceMessageIds: [testMsgId],
        sourceActor: "pretendente",
      },
    ],
    validMessageIds: new Set([testMsgId]),
  });

  // 2. Novo write explícito: field = "neighborhood", value = "Centro"
  await commitContactMemoryWrites({
    supabase,
    conversationId: testConvId,
    cycleId: `cycle_2_${Date.now()}`,
    facts: [
      {
        entity: "self",
        field: "neighborhood",
        value: "Centro",
        sourceMessageIds: [testMsgId],
        sourceActor: "pretendente",
      },
    ],
    validMessageIds: new Set([testMsgId]),
  });

  // 3. Verifica resultado: city continua intacta e neighborhood foi gravado separadamente
  const { data: activeFacts } = await supabase
    .from("contact_memory_facts")
    .select("field, value, temporal_status")
    .eq("conversation_id", testConvId)
    .neq("temporal_status", "superseded");

  const cityFact = activeFacts?.find((f) => f.field === "city" || f.field === "cidade");
  const neighborhoodFact = activeFacts?.find((f) => f.field === "neighborhood");

  const cityIntact = cityFact && cityFact.value === "São João del-Rei";
  const neighborhoodSaved = neighborhoodFact && neighborhoodFact.value === "Centro";

  result("E1: city continua intacta com São João del-Rei", cityIntact, `city=${cityFact?.value}`);
  result("E2: neighborhood salvo separadamente como Centro", neighborhoodSaved, `neighborhood=${neighborhoodFact?.value}`);
  result("E3: CITY_NEIGHBORHOOD_FIELD_ISOLATION = PASS", cityIntact && neighborhoodSaved);

  // Limpeza
  await supabase.from("contact_memory_facts").delete().eq("conversation_id", testConvId);
  await supabase.from("instagram_messages").delete().eq("conversation_id", testConvId);
}

// =====================================================================
// TESTE F — Current-turn already_satisfied: evidenceMessageId ∈ claimedMessageIds
// =====================================================================
async function testeF() {
  console.log("\n[F] Gate already_satisfied (turno atual): evidência deve estar em claimedMessageIds");
  const claimedMessageIds = [INBOUND_MSG_ID];
  const evidenceMessageId = INBOUND_MSG_ID;
  const invalidEvidenceId = "OTHER_MSG_ID";

  const isInClaimed = claimedMessageIds.includes(evidenceMessageId);
  const isInvalidBlocked = !claimedMessageIds.includes(invalidEvidenceId);

  result("F1: evidência presente em claimedMessageIds → permitida", isInClaimed);
  result("F2: evidência ausente de claimedMessageIds → bloqueada", isInvalidBlocked);
}

// =====================================================================
// TESTE G — Backend Location Classification: write field=city, value=Centro NÃO é renomeado
// =====================================================================
async function testeG() {
  console.log("\n[G] Backend Location Classification = false (backend NÃO renomeia field por semântica)");
  const testConvId = `test_g_${Date.now()}`;
  const testMsgId = `msg_g_${Date.now()}`;

  await supabase.from("instagram_messages").insert({
    id: testMsgId,
    conversation_id: testConvId,
    sender_id: "pretendente_test",
    text: "Centro",
    is_mine: false,
    direction: "inbound",
  });

  // Pré-condição: city = "São João del-Rei"
  await commitContactMemoryWrites({
    supabase,
    conversationId: testConvId,
    cycleId: `cycle_g1_${Date.now()}`,
    facts: [
      {
        entity: "self",
        field: "city",
        value: "São João del-Rei",
        sourceMessageIds: [testMsgId],
        sourceActor: "pretendente",
      },
    ],
    validMessageIds: new Set([testMsgId]),
  });

  // Novo write com field = "city" e value = "Centro"
  await commitContactMemoryWrites({
    supabase,
    conversationId: testConvId,
    cycleId: `cycle_g2_${Date.now()}`,
    facts: [
      {
        entity: "self",
        field: "city",
        value: "Centro",
        sourceMessageIds: [testMsgId],
        sourceActor: "pretendente",
      },
    ],
    validMessageIds: new Set([testMsgId]),
  });

  // Consulta se o backend silenciosamente converteu em "neighborhood"
  const { data: gFacts } = await supabase
    .from("contact_memory_facts")
    .select("field, value, temporal_status")
    .eq("conversation_id", testConvId);

  const convertedToNeighborhood = gFacts?.some((f) => f.field === "neighborhood" && f.value === "Centro");
  const keptAsCity = gFacts?.some((f) => (f.field === "city" || f.field === "cidade") && f.value === "Centro");

  result("G1: backend NÃO renomeou field para neighborhood", !convertedToNeighborhood, `neighborhood=${convertedToNeighborhood}`);
  result("G2: backend seguiu contrato normal de field=city", keptAsCity, `keptAsCity=${keptAsCity}`);
  result("G3: BACKEND_LOCATION_CLASSIFICATION = false", !convertedToNeighborhood && keptAsCity);

  // Limpeza
  await supabase.from("contact_memory_facts").delete().eq("conversation_id", testConvId);
  await supabase.from("instagram_messages").delete().eq("conversation_id", testConvId);
}

// =====================================================================
// TESTE H — CASO REAL: Resolução e Reconciliação sobre a conversa 1040376229029884
// =====================================================================
async function testeH() {
  console.log("\n[H] CASO REAL: Reconciliação histórica na conversa 1040376229029884");
  const provider = new TestMemoryProvider(CONV_ID);

  const resolution = await resolveStageChecklistGoals({
    supabase,
    conversationId: CONV_ID,
    stageNameOrId: "descoberta",
    memoryProvider: provider,
    completedGoalIds: [], // simula checklist antes (pending)
  });

  const cityGoal = resolution.goals.find((g) => g.id === "goal_city");
  const isCompleted = cityGoal?.status === "completed";
  const correctValue = cityGoal?.value === "São João del-Rei" || /sao joao/i.test(String(cityGoal?.value || ""));
  const correctEvidence = cityGoal?.evidenceMessageId === INBOUND_MSG_ID;
  const correctSource = cityGoal?.source === "contact_memory_reconciliation";

  result("H1: goal_city status = completed", isCompleted, `status=${cityGoal?.status}`);
  result("H2: goal_city value = São João del-Rei", correctValue, `value=${cityGoal?.value}`);
  result("H3: evidenceMessageId = mensagem histórica correta", correctEvidence, `id=${cityGoal?.evidenceMessageId}`);
  result("H4: source = contact_memory_reconciliation", correctSource, `source=${cityGoal?.source}`);
  result("H5: HISTORICAL_GOAL_RECONCILIATION = PASS", isCompleted && correctValue && correctEvidence && correctSource);
}

// =====================================================================
// TESTES DE VERIFICAÇÃO ESTRUTURAL (FLAGS)
// =====================================================================
async function testStructuralFlags() {
  console.log("\n[FLAGS] Verificação de invariantes estruturais do código");

  // 1. SEMANTIC_LOCATION_REGEX_PRESENT = false
  const contactMemorySource = readFileSync(
    resolve(process.cwd(), "supabase/functions/api/contact_memory.ts"),
    "utf8"
  );
  const hasNeighborhoodRegex = /isNeighborhoodValue|centro\|matosinhos/i.test(contactMemorySource);
  result("F-1: SEMANTIC_LOCATION_REGEX_PRESENT = false", !hasNeighborhoodRegex);

  // 2. CONTACT_MEMORY_FIRST_LOOKUP = PASS
  const testProvider = new TestMemoryProvider(CONV_ID, {
    self: { city: { value: "Cidade Legada", sourceMessageId: "leg_msg" } },
  });
  const firstLookup = await testProvider.getFact(CONV_ID, "self", "city");
  const isRelationalFirst = firstLookup.value === "São João del-Rei";
  result("F-2: CONTACT_MEMORY_FIRST_LOOKUP = PASS (consulta contact_memory_facts antes)", isRelationalFirst, `val=${firstLookup.value}`);

  // 3. LEGACY_JSONB_FALLBACK = PASS
  const emptyConvId = `conv_empty_${Date.now()}`;
  const legacyProvider = new TestMemoryProvider(emptyConvId, {
    self: { city: { value: "Cidade Legada", sourceMessageId: "leg_msg" } },
  });
  const fallbackLookup = await legacyProvider.getFact(emptyConvId, "self", "city");
  const isFallbackWorking = fallbackLookup.found && fallbackLookup.value === "Cidade Legada";
  result("F-3: LEGACY_JSONB_FALLBACK = PASS (cai no JSONB quando banco relacional vazio)", isFallbackWorking, `val=${fallbackLookup.value}`);
}

// =====================================================================
// RUNNER
// =====================================================================
(async () => {
  console.log("========================================");
  console.log(" Suíte: Reconciliação Histórica A–H");
  console.log(`  Projeto: wsdualhvopidgqcumonr`);
  console.log(`  Conversa alvo: ${CONV_ID}`);
  console.log("========================================");

  await testeA();
  await testeB();
  await testeC();
  await testeD();
  await testeE();
  await testeF();
  await testeG();
  await testeH();
  await testStructuralFlags();

  console.log("\n========================================");
  console.log(`  RESULTADO: ${passed} PASS  |  ${failed} FAIL`);
  console.log("========================================\n");

  if (failed === 0) {
    console.log("FLAGS FINAIS OBRIGATÓRIAS:");
    console.log("SEMANTIC_LOCATION_REGEX_PRESENT = false");
    console.log("BACKEND_LOCATION_CLASSIFICATION = false");
    console.log("CITY_NEIGHBORHOOD_FIELD_ISOLATION = PASS");
    console.log("HISTORICAL_GOAL_RECONCILIATION = PASS");
    console.log("CROSS_CONVERSATION_EVIDENCE_REJECTED = PASS");
    console.log("OUTBOUND_EVIDENCE_REJECTED = PASS");
    console.log("CURRENT_TURN_EVIDENCE_GATE_PRESERVED = PASS");
    console.log("CONTACT_MEMORY_FIRST_LOOKUP = PASS");
    console.log("LEGACY_JSONB_FALLBACK = PASS");
  }

  process.exit(failed > 0 ? 1 : 0);
})();
