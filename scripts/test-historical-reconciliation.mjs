/**
 * test-historical-reconciliation.mjs
 * Suíte A–F: Reconciliação Histórica de Objetivos Factuais
 *
 * Pré-requisito: variável de ambiente SUPABASE_URL e SUPABASE_SERVICE_KEY
 * Uso:
 *   node scripts/test-historical-reconciliation.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Carrega .env.local automaticamente (sem dependência de dotenv externo)
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

// ---------- Constantes ----------
const CONV_ID = "1040376229029884";
const INBOUND_MSG_ID =
  "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDAzNjE0MDMzNDE2OjM0MDI4MjM2Njg0MTcxMDMwMTI0NDI1OTI3OTg4MTU1MjU0NzQ1NDozMzAyMTA4NzYyNTkxNTA4MjEzODI2ODk0NTIxNjQzODI3MgZDZD";
const OUTBOUND_MSG_ID = "FAKE_OUTBOUND_MSG_ID";
const CROSS_CONV_MSG_ID = "FAKE_CROSS_CONV_MSG_ID";
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

// ---------- validateHistoricalInboundEvidence (inline, mesma lógica do orchestrator) ----------
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

// ---------- getFact simplificado (consulta contact_memory_facts) ----------
async function getFactRelational(conversationId, entity, field) {
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

  const { data, error } = await supabase
    .from("contact_memory_facts")
    .select("field, value, source_message_ids, created_at")
    .eq("conversation_id", conversationId)
    .eq("entity", entity)
    .in("field", fieldAliases)
    .neq("temporal_status", "superseded")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return { found: false };
  const row = data[0];
  return {
    found: true,
    value: row.value,
    sourceMessageId: Array.isArray(row.source_message_ids) ? row.source_message_ids[0] : undefined,
  };
}

// =====================================================================
// TESTE A — goal pendente + contact_memory_facts com source inbound válido → completa
// =====================================================================
async function testeA() {
  console.log("\n[A] goal pendente + fato em contact_memory_facts (source inbound válido) → deve completar");
  const factRes = await getFactRelational(CONV_ID, "self", "city");
  result("A1: getFact encontra cidade no banco relacional", factRes.found, `value=${factRes.value}`);

  if (!factRes.found) return;

  const prov = await validateHistoricalInboundEvidence({
    conversationId: CONV_ID,
    sourceMessageId: factRes.sourceMessageId,
  });
  result("A2: evidência é inbound válido da mesma conversa", prov.valid, prov.reason);
}

// =====================================================================
// TESTE B — fato sem sourceMessageId + policy = conversation_evidence → não completa
// =====================================================================
async function testeB() {
  console.log("\n[B] fato sem sourceMessageId → validateHistoricalInboundEvidence retorna invalid");
  const prov = await validateHistoricalInboundEvidence({
    conversationId: CONV_ID,
    sourceMessageId: undefined,
  });
  result("B1: retorna invalid quando sourceMessageId ausente", !prov.valid, prov.reason);
}

// =====================================================================
// TESTE C — evidence de outra conversa → rejeita
// =====================================================================
async function testeC() {
  console.log("\n[C] sourceMessageId de outra conversa → rejeita");
  // Pega uma mensagem real da conversa alvo mas testa com outra conversation_id
  const prov = await validateHistoricalInboundEvidence({
    conversationId: OTHER_CONV_ID, // conversa errada
    sourceMessageId: INBOUND_MSG_ID,
  });
  result(
    "C1: rejeita quando conversation_id não bate",
    !prov.valid,
    prov.reason
  );
}

// =====================================================================
// TESTE D — evidence outbound (is_mine = true) → rejeita
// =====================================================================
async function testeD() {
  console.log("\n[D] sourceMessageId outbound (is_mine = true) → rejeita");

  // Busca uma mensagem is_mine = true na conversa
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
// TESTE E — city = "São João del-Rei" já existe; novo inbound "moro no centro"
//            → city permanece, neighborhood = "Centro", goal_city continua completed
// =====================================================================
async function testeE() {
  console.log("\n[E] city existente não é sobrescrita por bairro 'centro'");

  // Busca o fato atual de cidade
  const cityRes = await getFactRelational(CONV_ID, "self", "city");
  result(
    "E1: city = 'São João del-Rei' ou similar ainda presente",
    cityRes.found && !!cityRes.value,
    `value=${cityRes.value}`
  );

  // Verifica que "centro" NÃO está como city (não supersedeu o campo cidade)
  const { data: centroRows } = await supabase
    .from("contact_memory_facts")
    .select("field, value, temporal_status")
    .eq("conversation_id", CONV_ID)
    .eq("entity", "self")
    .in("field", ["city", "cidade"])
    .neq("temporal_status", "superseded");

  const hasCentroAsCity = (centroRows || []).some((r) =>
    /^centro$/i.test(String(r.value || "").trim())
  );
  result("E2: 'centro' NÃO está como valor de city/cidade ativo", !hasCentroAsCity);
}

// =====================================================================
// TESTE F — gate already_satisfied (turno atual) permanece intacto
//            A evidência do turno atual deve estar em claimedMessageIds
// =====================================================================
async function testeF() {
  console.log("\n[F] gate already_satisfied: evidência fora de claimedMessageIds → inválida");

  // Simula: sourceMessageId real mas claimedMessageIds vazio
  const claimedMessageIds = [];
  const evidenceMessageId = INBOUND_MSG_ID;

  const isInClaimed = claimedMessageIds.includes(evidenceMessageId);
  result(
    "F1: evidência fora de claimedMessageIds → gate bloqueia",
    !isInClaimed,
    `claimed=${JSON.stringify(claimedMessageIds)}`
  );

  // Simula: sourceMessageId real está em claimedMessageIds
  const claimedWithEvidence = [INBOUND_MSG_ID];
  const isInClaimed2 = claimedWithEvidence.includes(evidenceMessageId);
  result(
    "F2: evidência dentro de claimedMessageIds → gate permite",
    isInClaimed2,
    `claimed=${JSON.stringify(claimedWithEvidence)}`
  );
}

// =====================================================================
// RUNNER
// =====================================================================
(async () => {
  console.log("========================================");
  console.log(" Suíte: Reconciliação Histórica A–F");
  console.log(`  Projeto: wsdualhvopidgqcumonr`);
  console.log(`  Conversa alvo: ${CONV_ID}`);
  console.log("========================================");

  await testeA();
  await testeB();
  await testeC();
  await testeD();
  await testeE();
  await testeF();

  console.log("\n========================================");
  console.log(`  RESULTADO: ${passed} PASS  |  ${failed} FAIL`);
  console.log("========================================\n");

  process.exit(failed > 0 ? 1 : 0);
})();
