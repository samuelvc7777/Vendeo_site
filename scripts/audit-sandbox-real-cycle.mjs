// scripts/audit-sandbox-real-cycle.mjs
// Executa ciclo real no /ai/test-autopilot com ai_auto_respond: true
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "https://wsdualhvopidgqcumonr.supabase.co";
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const testConvId = "test_sandbox_audit_" + Date.now();
  console.log("1. Criando conversa de sandbox ativa com ai_auto_respond = true:", testConvId);
  
  await supabase.from("instagram_conversations").upsert({
    id: testConvId,
    username: "sandbox_user_audit",
    full_name: "Usuário Sandbox Auditoria",
    status: "active",
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      status: "active",
      cancel_current_cycle: false,
      orchestration: {
        version: 1,
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
      }
    },
    updated_at: new Date().toISOString(),
  });

  // Insere a mensagem na tabela para provenance completa
  const msgId = "test_msg_" + Date.now();
  await supabase.from("instagram_messages").upsert({
    id: msgId,
    conversation_id: testConvId,
    sender_id: "them",
    is_mine: false,
    text: "Oi Larissa, tudo bem com você?",
    status: "delivered",
    created_at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  });

  console.log("2. Disparando /ai/test-autopilot...");
  const url = `${supabaseUrl}/functions/v1/api/ai/test-autopilot`;
  const payload = {
    conversationId: testConvId,
    currentMessages: [
      { sender: "them", text: "Oi Larissa, tudo bem com você?", timestamp: new Date().toISOString() }
    ]
  };

  const start = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const durationMs = Date.now() - start;
  console.log(`\nStatus HTTP: ${res.status} (${durationMs}ms)`);
  const data = await res.json();
  console.log("Resposta do Brain:", JSON.stringify(data, null, 2));

  // 3. Consulta o estado gravado e o ciclo no banco para auditar a telemetria do Brain
  const { data: convRow } = await supabase
    .from("instagram_conversations")
    .select("stage_completed_rules")
    .eq("id", testConvId)
    .single();

  const orch = convRow?.stage_completed_rules?.orchestration;
  console.log("\n--- Telemetria do Ciclo Gravado no Banco ---");
  console.log("Decisão do Brain:", JSON.stringify(orch?.lastDecision, null, 2));
  console.log("Status de Processamento:", orch?.lastProcessingStatus);
  console.log("Correlation ID:", orch?.lastCorrelationId);
  const cycle = orch?.recentCycles?.[0] || orch?.activeCycle;
  console.log("Brain Model:", cycle?.brainModel);
  console.log("Status do ciclo:", cycle?.status);
  console.log("Trace do ciclo:", JSON.stringify(cycle?.trace, null, 2));
  console.log("Métricas do ciclo:", JSON.stringify(cycle?.metrics, null, 2));

  // Limpeza
  await supabase.from("instagram_messages").delete().eq("conversation_id", testConvId);
  await supabase.from("instagram_conversations").delete().eq("id", testConvId);
  console.log("\nConversa e mensagens de auditoria limpas.");
}

run().catch(console.error);
