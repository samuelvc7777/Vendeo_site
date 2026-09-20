import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Carrega .env.local
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || 'https://wsdualhvopidgqcumonr.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Também cliente para o pdhtgzwfbqygflzbwdkt se necessário
const prodNewRef = 'pdhtgzwfbqygflzbwdkt';
const prodNewClient = createClient(`https://${prodNewRef}.supabase.co`, supabaseKey);

async function runSmokeTests() {
  console.log('===============================================================');
  console.log('SMOKE TESTS PÓS-DEPLOY (READ-ONLY — ZERO MENSAGENS ENVIADAS)');
  console.log('===============================================================\n');

  // 1. Healthcheck das Edge Functions
  console.log('--- 1. HEALTHCHECK DA EDGE FUNCTION ---');
  for (const ref of [prodNewRef, 'wsdualhvopidgqcumonr']) {
    const url = `https://${ref}.supabase.co/functions/v1/api/health`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${supabaseKey}` } });
      const text = await res.text();
      console.log(`[${ref}] GET /health -> Status: ${res.status} | Resposta: ${text.slice(0, 100)}`);
    } catch (e) {
      console.log(`[${ref}] GET /health -> Erro: ${e.message}`);
    }
  }

  // 2. Smoke Tests de PersonaMemory (via banco e memória)
  console.log('\n--- 2. SMOKE TESTS DE PERSONA MEMORY ---');
  const factsFile = JSON.parse(fs.readFileSync('data/larissa-persona-memory.json', 'utf8'));
  console.log(`Total de fatos no arquivo de memória: ${factsFile.length} fatos`);

  // Consulta cidade
  const cityFact = factsFile.find(f => f.key === 'address.city' || f.key === 'city');
  console.log(`- Cidade: ${cityFact?.value} (${cityFact?.key})`);

  // Consulta período
  const periodFact = factsFile.find(f => f.key === 'education.current_period');
  console.log(`- Período de enfermagem: ${periodFact?.value} (${periodFact?.key})`);

  // Consulta Tribo da Periferia
  const triboFact = factsFile.find(f => f.key.includes('tribo') || (f.aliases && f.aliases.some(a => a.includes('tribo'))));
  console.log(`- Tribo da Periferia: ${triboFact ? `${triboFact.key} = ${triboFact.value}` : 'Não consta como afeto / gosto = false'}`);

  // Consulta filme de tubarão
  const tubaraoFact = factsFile.find(f => f.key.includes('tubarao') || (f.aliases && f.aliases.some(a => a.includes('tubar'))));
  console.log(`- Filme de tubarão: ${tubaraoFact ? `${tubaraoFact.key} = ${tubaraoFact.value}` : 'Não consta como afeto / preferência de terror/suspense'}`);

  // Consulta perrengue da faculdade
  const perrengueFact = factsFile.find(f => f.key.includes('perrengue') || (f.category === 'historias' && JSON.stringify(f).toLowerCase().includes('perrengue')));
  console.log(`- Perrengue faculdade: ${perrengueFact ? `${perrengueFact.key} = ${perrengueFact.value}` : 'Recuperável via persona_search histórias'}`);

  // 3. Estado do Moose no Banco (READ-ONLY)
  console.log('\n--- 3. ESTADO DA CONVERSA DO MOOSE (READ-ONLY) ---');
  let mooseConv = null;
  for (const client of [supabase, prodNewClient]) {
    const { data, error } = await client
      .from('conversations')
      .select('id, full_name, username, ai_auto_respond, stage_completed_rules, metadata')
      .or('full_name.ilike.%moose%,username.ilike.%moose%')
      .limit(5);

    if (data && data.length > 0) {
      mooseConv = data[0];
      break;
    }
  }

  if (mooseConv) {
    const orchState = mooseConv.stage_completed_rules?.orchestration || {};
    console.log(`Moose Encontrado: ID=${mooseConv.id} (${mooseConv.full_name} / @${mooseConv.username})`);
    console.log(`- ai_auto_respond: ${mooseConv.ai_auto_respond}`);
    console.log(`- active_cycle_token: ${orchState.activeCycleToken || 'nenhum'}`);
    console.log(`- mode: ${orchState.mode || mooseConv.metadata?.mode || 'padrão'}`);
    console.log(`- phase: ${orchState.currentPhase || 'conexao_inicial'}`);
    console.log(`- checkpoint: ${orchState.checkpoint || 'não iniciado'}`);
  } else {
    console.log('Nenhuma conversa com nome "Moose" encontrada ativa no banco.');
  }

  console.log('\n===============================================================');
  console.log('CONFIRMAÇÃO: ZERO MENSAGENS ENVIADAS À META OU A QUALQUER CONTATO');
  console.log('===============================================================');
}

runSmokeTests().catch(console.error);
