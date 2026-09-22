import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=([^\s\n]+)/)[1];
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=([^\s\n]+)/)[1];
const supabase = createClient(url, key);

const TEST_CONV_ID = "998877665544333";

async function cleanup() {
  await supabase.from("audio_delivery_history").delete().eq("conversation_id", TEST_CONV_ID);
  await supabase.from("conversation_episodic_memory").delete().eq("conversation_id", TEST_CONV_ID);
  await supabase.from("instagram_messages").delete().eq("conversation_id", TEST_CONV_ID);
  await supabase.from("instagram_conversations").delete().eq("id", TEST_CONV_ID);
}

async function run() {
  await cleanup();

  console.log("1. Criando conversa para teste de saudação remota...");
  await supabase.from("instagram_conversations").insert({
    id: TEST_CONV_ID,
    username: "saudacao_teste_shadow",
    full_name: "Saudacao Teste Shadow",
    contact_id: TEST_CONV_ID,
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

  console.log("2. Enviando webhook com saudação...");
  const webhookUrl = "https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/instagram/webhook";
  const nowMs = Date.now();
  const mid = `mid_greet_${nowMs}`;

  const payload = {
    entry: [
      {
        messaging: [
          {
            sender: { id: TEST_CONV_ID },
            recipient: { id: "lariresende_0611" },
            timestamp: nowMs,
            message: {
              mid,
              text: "Oii, tudo bem?",
            },
          },
        ],
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("Webhook HTTP Status:", res.status);

  console.log("3. Aguardando processamento da Edge Function remota...");
  for (let i = 1; i <= 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", TEST_CONV_ID)
      .maybeSingle();

    const orchestration = data?.stage_completed_rules?.orchestration;
    const cycles = orchestration?.recentCycles;

    if (cycles && cycles.length > 0 && cycles[0].decision) {
      console.log(`\n✅ SUCESSO! Saudação remota processada na tentativa ${i} (${i * 2}s)!`);
      console.log("Decisão:", JSON.stringify(cycles[0].decision, null, 2));
      await cleanup();
      return;
    }
    process.stdout.write(`[${i}] `);
  }

  console.log("\nTimeout no polling.");
  await cleanup();
}

run().catch(console.error);
