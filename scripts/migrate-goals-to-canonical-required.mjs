import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
const envVars = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envVars[trimmed.slice(0, eq).trim()] = val;
  }
}

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL || 'https://wsdualhvopidgqcumonr.supabase.co';
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl.includes('wsdualhvopidgqcumonr')) {
  console.error('ERRO DE SEGURANÇA: URL não aponta para o projeto de produção wsdualhvopidgqcumonr!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrateGoals() {
  console.log('Iniciando migração de chat_stages para regra canônica...');
  const { data: stages, error } = await supabase
    .from('chat_stages')
    .select('*')
    .order('stage_order', { ascending: true });

  if (error) {
    console.error('Erro ao buscar chat_stages:', error);
    process.exit(1);
  }

  for (const stage of stages || []) {
    const rawGoals = stage.goals || [];
    const updatedGoals = rawGoals.map((g) => {
      const isEnabled = g.enabled !== false;
      const cleanGoal = { ...g };
      delete cleanGoal.allowedSubagents;
      delete cleanGoal.primarySubagent;
      cleanGoal.enabled = isEnabled;
      cleanGoal.required = isEnabled; // Todo ativo é obrigatório!
      return cleanGoal;
    });

    console.log(`Atualizando etapa ${stage.id} (${stage.name}): ${updatedGoals.length} objetivos (todos ativos obrigatórios, subagentes removidos)`);

    const { error: updateErr } = await supabase
      .from('chat_stages')
      .update({
        goals: updatedGoals,
        updated_at: new Date().toISOString()
      })
      .eq('id', stage.id);

    if (updateErr) {
      console.error(`Erro ao atualizar etapa ${stage.id}:`, updateErr);
      process.exit(1);
    }
  }

  console.log('\nMigração de chat_stages concluída com sucesso!');
}

migrateGoals().catch(console.error);
