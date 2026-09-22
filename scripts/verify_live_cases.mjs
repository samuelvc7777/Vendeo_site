import { runOpenAiBrainTurn, buildOpenAiBrainContextMessage } from "../supabase/functions/api/openai_brain.ts";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

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

const subagents = [
  { id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" },
  { id: "descoberta", name: "Descoberta", mission: "Descobrir interesses e contexto" },
];

async function runTest(label, params) {
  console.log(`\n========================================`);
  console.log(`TESTANDO AO VIVO: ${label}`);
  console.log(`========================================`);
  const result = await runOpenAiBrainTurn(params);
  console.log(`Success: ${result.success}`);
  console.log(`ObjectiveDecision: ${result.plan?.objectiveDecision}`);
  console.log(`Reasoning: ${result.plan?.reasoning}`);
  console.log(`Responses:`, result.plan?.responses);
  return result.plan;
}

async function main() {
  // Caso 1: Saudação "Oii, estou bem sim e vc?" com objetivo Cidade pendente (opcional)
  await runTest("CASO 1: Saudação completa com objetivo cidade pendente (opcional: true)", {
    supabase,
    conversationId: "conv_live_case_1",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: false,
    currentObjectiveDescription: "Descobrir onde mora ou contexto geográfico",
    inboundMessages: ["Oii, estou bem sim e vc?"],
    recentMessages: [],
    availableSubagents: subagents,
    agentId: OPENAI_BRAIN_AGENT_ID,
    apiKey: OPENAI_API_KEY,
    strictOpenAiPilot: true,
  });

  // Caso 2: Continuidade fática "Ah que bom rs" com objetivo Cidade pendente (opcional)
  await runTest("CASO 2: Continuidade fática 'Ah que bom rs' com objetivo cidade pendente (opcional: true)", {
    supabase,
    conversationId: "conv_live_case_2",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: false,
    currentObjectiveDescription: "Descobrir onde mora ou contexto geográfico",
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
  });
}

main().catch(console.error);
