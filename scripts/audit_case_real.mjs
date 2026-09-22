import { runOpenAiBrainTurn, buildOpenAiBrainContextMessage } from "../supabase/functions/api/openai_brain.ts";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BRAIN_AGENT_ID = process.env.OPENAI_BRAIN_AGENT_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function audit() {
  console.log("=== INICIANDO AUDITORIA DO CASO REAL ===");

  const subagents = [
    { id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" },
    { id: "descoberta", name: "Descoberta", mission: "Descobrir interesses e contexto" },
  ];

  const params = {
    supabase,
    conversationId: "conv_audit_real_bom_saber",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    inboundMessages: ["Ah que bom rs"],
    recentMessages: [
      { sender: "user", text: "Oii, estou bem sim e vc?" },
      { sender: "larissa", text: "Tô bem tbm, obrigada" },
      { sender: "user", text: "Ah que bom rs" },
    ],
    availableSubagents: subagents,
    agentId: OPENAI_BRAIN_AGENT_ID,
    apiKey: OPENAI_API_KEY,
    strictOpenAiPilot: true,
  };

  const contextMessage = buildOpenAiBrainContextMessage(params);
  console.log("--- PROMPT ENVIADO AO AGENT ---");
  console.log(contextMessage.slice(0, 1000));
  console.log("...\n--- FIM PREVIEW PROMPT ---");

  console.log("\nChamando OpenAI Agent real...");
  const result = await runOpenAiBrainTurn(params);

  console.log("\n=== RESULTADO DA AUDITORIA ===");
  console.log("Success:", result.success);
  console.log("Telemetry:", result.telemetry);
  console.log("Plano Retornado:", JSON.stringify(result.plan, null, 2));

  if (result.plan) {
    console.log("\n--- DETALHAMENTO DO PLANO ---");
    console.log("currentStageId:", params.currentStageId);
    console.log("currentObjectiveId:", params.currentObjectiveId);
    console.log("currentObjectiveLabel:", params.currentObjectiveLabel);
    console.log("objectiveDecision:", result.plan.objectiveDecision);
    console.log("questionRecommendation:", result.plan.questionRecommendation || result.plan.missionPackage?.questionRecommendation || "none");
    console.log("currentTopic:", result.plan.currentTopic || result.plan.liveStatePatch?.currentTopic);
    console.log("bestHook:", result.plan.bestHook);
    console.log("responsibleSubagent:", result.plan.responsibleSubagent);
    console.log("responses:", result.plan.responses);
  }
}

audit().catch((err) => {
  console.error("ERRO NA AUDITORIA:", err);
  process.exit(1);
});
