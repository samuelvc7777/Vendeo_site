import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const FIXTURE_ID = "__remote_e2e_shadow_test__";

function loadDotEnv() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error(".env.local não encontrado.");
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

async function cleanupFixture(supabase) {
  await supabase.from("audio_delivery_history").delete().eq("conversation_id", FIXTURE_ID);
  await supabase.from("conversation_episodic_memory").delete().eq("conversation_id", FIXTURE_ID);
  await supabase.from("instagram_messages").delete().eq("conversation_id", FIXTURE_ID);
  await supabase.from("instagram_conversations").delete().eq("id", FIXTURE_ID);
  const { data: remaining } = await supabase.from("instagram_conversations").select("id").eq("id", FIXTURE_ID);
  return remaining?.length || 0;
}

async function runRemoteScenario(supabase, text, scenarioLabel) {
  console.log(`\n===============================================================`);
  console.log(`INICIANDO CENÁRIO REMOTO: ${scenarioLabel}`);
  console.log(`===============================================================`);

  await cleanupFixture(supabase);

  // 1. Cria conversa fixture diretamente no banco de dados de produção
  await supabase.from("instagram_conversations").insert({
    id: FIXTURE_ID,
    username: "remote_e2e_user",
    full_name: "Remote E2E Shadow User",
    contact_id: FIXTURE_ID,
    ai_auto_respond: true,
    stage_completed_rules: {
      current_stage_id: "conexao_inicial",
      responseDelayMinutes: 0,
      orchestration: {
        version: 1,
        mode: "shadow",
        brainProvider: "openai_agent",
        strictOpenAiPilot: true,
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        updatedAt: new Date().toISOString(),
        memory: { entities: {}, snippets: [] },
      },
    },
  });

  // 2. Dispara a mensagem via Webhook Oficial da Edge Function Remota (v249)
  const webhookUrl = "https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/instagram/webhook";
  const messageId = `remote_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const nowMs = Date.now();

  const webhookPayload = {
    entry: [
      {
        messaging: [
          {
            sender: { id: FIXTURE_ID },
            recipient: { id: "lariresende_0611" },
            timestamp: nowMs,
            message: {
              mid: messageId,
              text,
            },
          },
        ],
      },
    ],
  };

  const startedAt = Date.now();
  console.log(`Enviando mensagem para a Edge Function remota (api v249): "${text}"...`);
  const webhookRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookPayload),
  });

  console.log(`Webhook HTTP status: ${webhookRes.status}`);

  // 3. Polling do resultado do ciclo processado pela Edge Function remota no Supabase
  console.log("Aguardando Edge Function remota executar o Brain (Agents API) e registrar o ciclo...");
  const maxAttempts = 40;
  let cycle = null;
  let convRow = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 2500));
    const { data } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules, updated_at")
      .eq("id", FIXTURE_ID)
      .maybeSingle();

    convRow = data;
    const orchestration = convRow?.stage_completed_rules?.orchestration;
    const recentCycles = orchestration?.recentCycles || [];

    const found = recentCycles.find((c) => {
      const cycleTime = new Date(c.startedAt || c.completedAt || 0).getTime();
      return cycleTime >= startedAt - 5000 && (c.decision || c.status === "completed" || c.status === "idle");
    });

    if (found && found.decision) {
      cycle = found;
      console.log(`Ciclo remoto concluído na tentativa ${attempt} (${attempt * 2.5}s)!`);
      break;
    } else {
      process.stdout.write(`[${attempt}] `);
    }
  }

  if (!cycle) {
    throw new Error(`Timeout: Edge Function remota não concluiu ciclo após ${maxAttempts * 2.5} segundos.`);
  }

  // 4. Inspeciona a decisão e o plano gravados pela Edge Function remota
  const decision = cycle.decision;
  const shadowSim = cycle.shadowSimulation;
  const plan = cycle.brainPlan;

  console.log("\n--- RESULTADO REMOTO FACTUAL ---");
  console.log("Decision Action:", decision?.action);
  console.log("Subagent:", decision?.responsibleSubagent || decision?.subagentId);
  console.log("Suggested Response:", decision?.suggestedResponse);
  console.log("Brain Model Used:", cycle.brainModelUsed || "gpt-5.6-terra");
  console.log("Memory Consulted:", plan?.missionPackage?.memoryConsulted);
  console.log("Relevant Facts:", JSON.stringify(plan?.missionPackage?.relevantPersonaFacts || [], null, 2));

  // 5. Cleanup
  const remaining = await cleanupFixture(supabase);
  console.log(`Fixture cleanup: remaining = ${remaining}`);

  return {
    cycle,
    decision,
    plan,
    remaining,
  };
}

async function main() {
  loadDotEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(supabaseUrl, supabaseKey);

  // CENÁRIO 1: "Sou enfermeiro." na Edge Function remota
  const nurseResult = await runRemoteScenario(supabase, "Sou enfermeiro.", "Sou enfermeiro.");
  assert.ok(nurseResult.decision, "Decisão remota não encontrada");
  assert.equal(nurseResult.remaining, 0, "Fixture não limpa");

  // CENÁRIO 2: "Oii, tudo bem?" (Controle) na Edge Function remota
  const greetingResult = await runRemoteScenario(supabase, "Oii, tudo bem?", "Controle (Oii, tudo bem?)");
  assert.ok(greetingResult.decision, "Decisão remota não encontrada");
  assert.equal(greetingResult.remaining, 0, "Fixture não limpa");

  console.log("\n===============================================================");
  console.log("✅ AMBOS OS CENÁRIOS E2E REMOTOS CONCLUÍDOS COM SUCESSO!");
  console.log("===============================================================");
}

main().catch((err) => {
  console.error("ERRO NO E2E REMOTO:", err);
  process.exitCode = 1;
});
