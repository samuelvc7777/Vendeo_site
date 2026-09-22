// scripts/migrate-remove-orchestration-mode.mjs
// Remove a chave obsoleta 'mode' do campo stage_completed_rules->orchestration de todas as conversas
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf8");
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "https://wsdualhvopidgqcumonr.supabase.co";
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error("ERRO: SUPABASE_SERVICE_ROLE_KEY não encontrada em .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  console.log("Conectando ao Supabase:", supabaseUrl);
  
  const { data: convs, error } = await supabase
    .from("instagram_conversations")
    .select("id, username, stage_completed_rules");

  if (error) {
    console.error("Erro ao buscar conversas:", error);
    process.exit(1);
  }

  let updatedCount = 0;
  for (const conv of convs || []) {
    const rules = conv.stage_completed_rules;
    if (rules && rules.orchestration && "mode" in rules.orchestration) {
      const { mode, ...cleanOrchestration } = rules.orchestration;
      const updatedRules = {
        ...rules,
        orchestration: cleanOrchestration,
      };

      const { error: updErr } = await supabase
        .from("instagram_conversations")
        .update({ stage_completed_rules: updatedRules })
        .eq("id", conv.id);

      if (updErr) {
        console.error(`Erro ao atualizar conv ${conv.id}:`, updErr);
      } else {
        console.log(`Conversa ${conv.id} (${conv.username}): chave mode="${mode}" removida com sucesso.`);
        updatedCount++;
      }
    }
  }

  console.log(`\nMigração concluída! Total de conversas atualizadas: ${updatedCount}`);
}

run().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
