import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fetchSessionRecoveryBootstrap } from "../supabase/functions/api/openai_brain.ts";

// Carrega .env.local
const envPath = path.resolve(import.meta.dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("ERRO: Credenciais do Supabase ausentes em .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const CANARY_CONVERSATION_ID = "2118050112439558";

async function run() {
  console.log("=== TESTE DE LEITURA DO SCHEMA REAL DE INSTAGRAM_MESSAGES ===");
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Canário Conversation ID: ${CANARY_CONVERSATION_ID}\n`);

  // 1. Executa a query canônica diretamente contra o PostgreSQL real
  console.log("[Passo 1] Testando query canônica com fetchSessionRecoveryBootstrap()...");
  const result = await fetchSessionRecoveryBootstrap(supabase, CANARY_CONVERSATION_ID, []);

  console.log(`\nResultado da Query Real:`);
  console.log(`- queryFailed: ${result.queryFailed}`);
  console.log(`- errorMessage: ${result.errorMessage || "nenhum (sucesso)"}`);
  console.log(`- messageCount: ${result.messageCount}`);

  if (result.queryFailed) {
    console.error("\nFALHA: A query canônica falhou no banco real!");
    process.exit(1);
  }

  console.log("\n--- AMOSTRA DO CONTEÚDO RECUPERADO (primeiras 600 chars) ---");
  console.log(result.text.slice(0, 600));
  console.log("---\n");

  // 2. Testando uma query com as colunas antigas inválidas para PROVAR o erro 42703 no PostgreSQL real
  console.log("[Passo 2] Provando que a query antiga com is_from_me/message FALHA no Postgres real...");
  const { data: badRows, error: badError } = await supabase
    .from("instagram_messages")
    .select("id, sender_id, is_from_me, text, message, created_at, timestamp")
    .eq("conversation_id", CANARY_CONVERSATION_ID)
    .limit(5);

  if (badError) {
    console.log(`Erro esperado confirmado no Postgres: code=${badError.code}, message="${badError.message}"`);
  } else {
    console.warn("Aviso inesperado: o Postgres aceitou as colunas antigas");
  }

  // 3. Inspeciona o estado da conversa do canário
  console.log("\n[Passo 3] Inspecionando estado atual da conversa do canário...");
  const { data: conv, error: convErr } = await supabase
    .from("instagram_conversations")
    .select("id, ai_auto_respond, is_restricted, stage_completed_rules")
    .eq("id", CANARY_CONVERSATION_ID)
    .maybeSingle();

  if (convErr || !conv) {
    console.error("Erro ao buscar conversa:", convErr);
  } else {
    const rules = conv.stage_completed_rules || {};
    const orch = rules.orchestration || {};
    const config = rules.config || {};
    console.log(`- ID: ${conv.id}`);
    console.log(`- ai_auto_respond: ${conv.ai_auto_respond}`);
    console.log(`- persistent_agent_session_enabled: ${config.persistent_agent_session_enabled}`);
    console.log(`- openai_session_id atual: ${orch.openai_session_id}`);
    console.log(`- currentStageId: ${orch.currentStageId}`);
  }

  console.log("\n=== TESTE CONCLUÍDO COM SUCESSO ===");
}

run().catch((err) => {
  console.error("Exceção não tratada:", err);
  process.exit(1);
});
