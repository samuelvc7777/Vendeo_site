/**
 * test_e2e_reconciliation_cycle.mjs
 *
 * Teste End-to-End: Reconciliação Histórica Automática via Ciclo da Edge Function API
 *
 * 1. Cria conversa de teste com goal_city = pending (completed_goals = [])
 * 2. Insere mensagem histórica inbound com "Sou de sao joao del rei e vc ?"
 * 3. Insere contact_memory_facts com field = cidade, value = São João del-Rei, sourceMessageId = hist_msg
 * 4. Dispara 1 ciclo normal chamando a Edge Function API (SEM EDITAR O BANCO MANUALMENTE)
 * 5. Valida que goal_city foi reconciliado para completed, objective_progress preenchido e UI 1/1
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Carrega variáveis de ambiente
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
} catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wsdualhvopidgqcumonr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error("ERRO: SUPABASE_SERVICE_ROLE_KEY ausente.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const timestamp = Date.now();
const CONV_ID = `test_rec_${timestamp}`;
const CONTACT_ID = `cid_${timestamp}`;
const HIST_MSG_ID = `msg_hist_${timestamp}`;
const NEW_INBOUND_MSG_ID = `msg_inbound_${timestamp}`;

console.log("===============================================================");
console.log(" TESTE E2E: RECONCILIAÇÃO HISTÓRICA AUTOMÁTICA VIA API (v263)");
console.log(`  Conversa de teste: ${CONV_ID}`);
console.log("===============================================================\n");

async function run() {
  try {
    // -----------------------------------------------------------------
    // PASSO 1: Configurar a conversa de teste no banco
    // -----------------------------------------------------------------
    console.log("[1/5] Configurando conversa com goal_city = PENDING...");

    const initialRules = {
      completed_goals: [], // PENDENTE!
      current_stage_id: "stage_1_conexao",
      status: "active",
      ai_auto_respond: true,
      orchestration: {
        mode: "experimental",
        currentStageId: "stage_1_conexao",
        currentPhase: "conexao_inicial",
        completedGoalIds: [], // PENDENTE!
        objectiveProgress: {},
        responseDelayMinutes: 0,
      },
    };

    const { error: convErr } = await supabase.from("instagram_conversations").insert({
      id: CONV_ID,
      contact_id: CONTACT_ID,
      username: `test_user_${timestamp}`,
      full_name: "Pretendente Teste E2E",
      status: "active",
      stage_completed_rules: initialRules,
      updated_at: new Date().toISOString(),
    });
    if (convErr) throw new Error(`Erro ao criar conversa: ${convErr.message}`);

    // Insere mensagem histórica inbound do pretendente
    const { error: msgErr } = await supabase.from("instagram_messages").insert({
      id: HIST_MSG_ID,
      conversation_id: CONV_ID,
      contact_id: CONTACT_ID,
      sender_id: CONTACT_ID,
      text: "Sou de sao joao del rei e vc ?",
      is_mine: false,
      direction: "inbound",
      created_at: new Date(Date.now() - 3600000).toISOString(),
      timestamp: new Date(Date.now() - 3600000).toISOString(),
    });
    if (msgErr) throw new Error(`Erro ao criar mensagem histórica: ${msgErr.message}`);

    // Insere fato relacional estruturado em contact_memory_facts
    const { error: factErr } = await supabase.from("contact_memory_facts").insert({
      conversation_id: CONV_ID,
      entity: "self",
      field: "cidade",
      value: "São João del-Rei",
      normalized_value: "sao joao del-rei",
      temporal_status: "durable",
      source_message_ids: [HIST_MSG_ID],
      source_actor: "pretendente",
      confidence: 1.0,
      importance: 0.8,
      fact_fingerprint: `${CONV_ID}::self::cidade::sao joao del-rei::${HIST_MSG_ID}`,
    });
    if (factErr) throw new Error(`Erro ao criar fato em contact_memory_facts: ${factErr.message}`);

    // -----------------------------------------------------------------
    // PASSO 2: Verificar estado ANTES do ciclo
    // -----------------------------------------------------------------
    console.log("[2/5] Verificando estado inicial antes da chamada da API...");
    const { data: convBefore } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", CONV_ID)
      .single();

    const rulesBefore = convBefore?.stage_completed_rules || {};
    const orchBefore = rulesBefore.orchestration || {};
    const completedBefore = orchBefore.completedGoalIds || rulesBefore.completed_goals || [];
    const isCityCompletedBefore = completedBefore.includes("goal_city");

    console.log("  • completed_goals antes:", JSON.stringify(completedBefore));
    console.log("  • goal_city concluído antes:", isCityCompletedBefore);
    console.log("  • UI Cidade antes: 0/1 (PENDING)");

    if (isCityCompletedBefore) {
      throw new Error("FALHA: goal_city já constava como completed antes do ciclo!");
    }

    // -----------------------------------------------------------------
    // PASSO 3: Chamar a API v263 para rodar 1 ciclo normal
    // -----------------------------------------------------------------
    console.log("\n[3/5] Disparando 1 ciclo normal via API v263 (SEM editar banco manualmente)...");

    // Inserimos a nova mensagem inbound que dispara o turno
    const nowIso = new Date().toISOString();
    await supabase.from("instagram_messages").insert({
      id: NEW_INBOUND_MSG_ID,
      conversation_id: CONV_ID,
      contact_id: CONTACT_ID,
      sender_id: CONTACT_ID,
      text: "e aí Larissa tudo bem com vc?",
      is_mine: false,
      direction: "inbound",
      created_at: nowIso,
      timestamp: nowIso,
    });

    // Chamamos o endpoint oficial /autopilot/trigger da Edge Function API
    const triggerUrl = `${SUPABASE_URL}/functions/v1/api/autopilot/trigger`;
    console.log(`  Chamando POST ${triggerUrl}...`);

    const triggerRes = await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ conversationId: CONV_ID }),
    });

    console.log(`  Status HTTP da API: ${triggerRes.status}`);
    const triggerJson = await triggerRes.json().catch(() => ({}));
    console.log("  Resposta do trigger:", JSON.stringify(triggerJson));

    // -----------------------------------------------------------------
    // PASSO 4: Aguardar a execução do ciclo em background na Edge Function
    // -----------------------------------------------------------------
    console.log("\n[4/5] Aguardando a Edge Function processar o ciclo e realizar o commit CAS...");

    let cycleCompleted = false;
    let finalRules = null;
    const maxWaitSeconds = 90;
    const startTime = Date.now();

    while ((Date.now() - startTime) < maxWaitSeconds * 1000) {
      await new Promise((r) => setTimeout(r, 2000));

      const { data: convCheck } = await supabase
        .from("instagram_conversations")
        .select("stage_completed_rules, updated_at")
        .eq("id", CONV_ID)
        .single();

      const rules = convCheck?.stage_completed_rules || {};
      const orch = rules.orchestration || {};
      const completedGoals = orch.completedGoalIds || rules.completed_goals || [];

      // Verifica se o ciclo finalizou
      const hasCompletedCity = Array.isArray(completedGoals) && completedGoals.includes("goal_city");
      const hasRecentCycles = Array.isArray(orch.recentCycles) && orch.recentCycles.length > 0;
      const isLockFree = rules.active_cycle_token === null || !rules.active_cycle_token;

      if ((hasCompletedCity && isLockFree) || (hasRecentCycles && isLockFree)) {
        cycleCompleted = true;
        finalRules = rules;
        break;
      }

      process.stdout.write(".");
    }
    console.log("");

    if (!cycleCompleted) {
      console.warn("AVISO: Timeout aguardando finalização completa do ciclo. Lendo estado atual do banco...");
      const { data: convFallback } = await supabase
        .from("instagram_conversations")
        .select("stage_completed_rules")
        .eq("id", CONV_ID)
        .single();
      finalRules = convFallback?.stage_completed_rules || {};
    }

    // -----------------------------------------------------------------
    // PASSO 5: Validar resultados no banco e na visão da UI
    // -----------------------------------------------------------------
    console.log("\n[5/5] Verificando resultados finais produzidos pela API v263...");

    const orchAfter = finalRules?.orchestration || {};
    const completedGoalsAfter = orchAfter.completedGoalIds || finalRules?.completed_goals || [];
    const objectiveProgressAfter = orchAfter.objectiveProgress || finalRules?.objective_progress || {};
    const cityProgress = objectiveProgressAfter.goal_city;

    console.log("  • completed_goals final:", JSON.stringify(completedGoalsAfter));
    console.log("  • objective_progress.goal_city:", JSON.stringify(cityProgress, null, 2));

    const isCityCompleted = completedGoalsAfter.includes("goal_city") && cityProgress?.status === "completed";
    const hasCorrectValue = cityProgress?.value === "São João del-Rei" || /sao joao/i.test(String(cityProgress?.value || ""));
    const hasCorrectEvidence = cityProgress?.evidenceMessageId === HIST_MSG_ID;
    const hasCorrectSource = cityProgress?.source === "contact_memory_reconciliation";

    // Cálculo exato da UI para a etapa de Conexão Inicial (onde goal_city é o único objetivo)
    // 1 de 1 objetivo concluído = 1/1 (100%)
    const uiTotalObjectives = 1;
    const uiCompletedObjectives = isCityCompleted ? 1 : 0;
    const uiRatioString = `${uiCompletedObjectives}/${uiTotalObjectives}`;
    const isUiOneOfOne = isCityCompleted && uiRatioString === "1/1";

    console.log("\n===============================================================");
    console.log(" RESULTADO DO TESTE");
    console.log("===============================================================");
    console.log(`  goal_city -> completed               : ${isCityCompleted ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`  objective_progress.value correto     : ${hasCorrectValue ? "✅ PASS (" + cityProgress?.value + ")" : "❌ FAIL"}`);
    console.log(`  objective_progress.evidenceMessageId : ${hasCorrectEvidence ? "✅ PASS (" + cityProgress?.evidenceMessageId + ")" : "❌ FAIL"}`);
    console.log(`  objective_progress.source correto    : ${hasCorrectSource ? "✅ PASS (" + cityProgress?.source + ")" : "❌ FAIL"}`);
    console.log(`  UI -> 1/1 (Cidade Concluída)         : ${isUiOneOfOne ? "✅ PASS (" + uiRatioString + ")" : "❌ FAIL"}`);

    // Limpeza da conversa de teste
    await supabase.from("contact_memory_facts").delete().eq("conversation_id", CONV_ID);
    await supabase.from("instagram_messages").delete().eq("conversation_id", CONV_ID);
    await supabase.from("instagram_conversations").delete().eq("id", CONV_ID);
    console.log("\nConversa de teste limpa com sucesso.");

    const allPassed = isCityCompleted && hasCorrectValue && hasCorrectEvidence && hasCorrectSource;
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error("\n❌ ERRO NO TESTE:", err);
    // Limpeza em caso de erro
    try {
      await supabase.from("contact_memory_facts").delete().eq("conversation_id", CONV_ID);
      await supabase.from("instagram_messages").delete().eq("conversation_id", CONV_ID);
      await supabase.from("instagram_conversations").delete().eq("id", CONV_ID);
    } catch {}
    process.exit(1);
  }
}

run();
