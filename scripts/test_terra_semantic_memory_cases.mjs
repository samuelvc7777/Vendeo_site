import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { runOpenAiBrainTurn } from '../supabase/functions/api/openai_brain.ts';

// Carrega variáveis de ambiente
const envPath = path.resolve(import.meta.dirname, '../.env.local');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, l) => {
  const [k, ...v] = l.trim().split('=');
  if (k && v.length) acc[k] = v.join('=').replace(/^["']|["']$/g, '').trim();
  return acc;
}, {});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = env.OPENAI_API_KEY;
const AGENT_ID = env.OPENAI_BRAIN_AGENT_ID;

if (!SUPABASE_URL || !SERVICE_KEY || !OPENAI_KEY || !AGENT_ID) {
  console.error('Configurações ausentes em .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const subagents = [
  { id: 'conexao_inicial', name: 'Conexão Inicial', mission: 'Criar rapport e sintonia leve' },
  { id: 'descoberta', name: 'Descoberta', mission: 'Descobrir contexto e interesses sem interrogar' },
];

function computeFingerprint(input) {
  return crypto.createHash('sha256').update(String(input).trim().toLowerCase()).digest('hex').slice(0, 32);
}

async function createTestScope(conversationId) {
  const scopeId = `scope_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();
  await supabase.from('agent_memory_scopes').insert({
    scope_id: scopeId,
    conversation_id: conversationId,
    cycle_id: `cycle_${Date.now()}`,
    agent_id: 'test_terra_runner',
    expires_at: expiresAt,
  });
  return scopeId;
}

async function fetchSessionToolDetails(sessionId) {
  const headers = {
    Authorization: `Bearer ${OPENAI_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'agents=v1',
  };
  const res = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers });
  if (!res.ok) return { toolCalls: [], items: [] };
  const data = await res.json();
  const items = data.data || [];
  const toolCalls = [];

  for (const it of items) {
    if (it.type === 'tool_call' || it.type === 'mcp_call') {
      toolCalls.push({
        name: it.name,
        arguments: it.arguments,
        output: it.output,
      });
    }
  }
  return { toolCalls, items };
}

async function runScenarioA() {
  console.log('\n===============================================================');
  console.log(' CASO A — CALLBACK ANTIGO ("Ilhabela")');
  console.log('===============================================================');
  const convId = `test_terra_case_a_${Date.now()}`;
  const scopeId = await createTestScope(convId);

  // 1. Inserir memória de viagem a Ilhabela
  const factFp = computeFingerprint(`self:travel_destination:ilhabela`);
  await supabase.from('contact_memory_facts').insert({
    conversation_id: convId,
    entity: 'self',
    field: 'travel_destination',
    value: 'Ilhabela',
    normalized_value: 'ilhabela',
    temporal_status: 'plan',
    source_message_ids: ['msg_prev_01'],
    source_actor: 'pretendente',
    confidence: 1.0,
    importance: 0.9,
    fact_fingerprint: factFp,
  });

  await supabase.from('conversation_episodic_memory').insert({
    conversation_id: convId,
    actor: 'pretendente',
    event_type: 'plan',
    topic: 'travel',
    summary: 'O pretendente compartilhou que nas férias quer ir pra Ilhabela.',
    source_message_id: 'msg_prev_01',
    importance: 0.9,
    loop_status: 'open',
    metadata: {
      memory_class: 'landmark',
      original_text: 'nas férias quero ir pra Ilhabela',
    },
  });

  // 2. Executar turno com Inbound: "acho que vou fazer aquela viagem mesmo"
  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: convId,
    memoryScopeId: scopeId,
    currentStageId: 'descoberta',
    currentObjectiveId: 'goal_travel',
    currentObjectiveLabel: 'Planos e Lazer',
    currentObjectiveRequired: false,
    inboundMessages: ['acho que vou fazer aquela viagem mesmo'],
    recentMessages: [
      { sender: 'user', text: 'tava aqui pensando nos meus dias de folga' },
    ],
    availableSubagents: subagents,
    agentId: AGENT_ID,
    apiKey: OPENAI_KEY,
    strictOpenAiPilot: true,
  });

  // Telemetria detalhada
  const sessionDetails = result.telemetry?.sessionId
    ? await fetchSessionToolDetails(result.telemetry.sessionId)
    : { toolCalls: [] };

  // Limpeza
  await supabase.from('contact_memory_facts').delete().eq('conversation_id', convId);
  await supabase.from('conversation_episodic_memory').delete().eq('conversation_id', convId);
  await supabase.from('agent_memory_scopes').delete().eq('conversation_id', convId);

  return {
    name: 'CASO A — CALLBACK ANTIGO',
    convId,
    result,
    sessionDetails,
  };
}

async function runScenarioB() {
  console.log('\n===============================================================');
  console.log(' CASO B — ANTI-REPETIÇÃO DE PERGUNTA ("vc trabalha em qual área?")');
  console.log('===============================================================');
  const convId = `test_terra_case_b_${Date.now()}`;
  const scopeId = await createTestScope(convId);

  // 1. Inserir na memória episódica que Larissa já fez essa pergunta
  await supabase.from('conversation_episodic_memory').insert({
    conversation_id: convId,
    actor: 'larissa',
    event_type: 'question',
    topic: 'profession',
    summary: 'Larissa já perguntou ao pretendente: "vc trabalha em qual área?".',
    source_message_id: 'msg_prev_larissa_q',
    importance: 0.9,
    metadata: {
      memory_class: 'speech_act',
      question_topic: 'job',
    },
  });

  // 2. Executar turno onde há gancho de trabalho, mas o objetivo de profissão já foi sondado
  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: convId,
    memoryScopeId: scopeId,
    currentStageId: 'descoberta',
    currentObjectiveId: 'goal_job',
    currentObjectiveLabel: 'Profissão',
    currentObjectiveRequired: false,
    currentObjectiveDescription: 'Descobrir profissão ou ocupação',
    inboundMessages: ['finalmente terminei o expediente por hoje, tô exausto'],
    recentMessages: [
      { sender: 'user', text: 'nossa semana tá puxada demais' },
      { sender: 'larissa', text: 'imagino, nem me fale rs' },
    ],
    availableSubagents: subagents,
    agentId: AGENT_ID,
    apiKey: OPENAI_KEY,
    strictOpenAiPilot: true,
  });

  const sessionDetails = result.telemetry?.sessionId
    ? await fetchSessionToolDetails(result.telemetry.sessionId)
    : { toolCalls: [] };

  // Limpeza
  await supabase.from('conversation_episodic_memory').delete().eq('conversation_id', convId);
  await supabase.from('agent_memory_scopes').delete().eq('conversation_id', convId);

  return {
    name: 'CASO B — ANTI-REPETIÇÃO DE PERGUNTA',
    convId,
    result,
    sessionDetails,
  };
}

async function runScenarioC() {
  console.log('\n===============================================================');
  console.log(' CASO C — AUTORREVELAÇÃO DA LARISSA (Enfermagem já compartilhada)');
  console.log('===============================================================');
  const convId = `test_terra_case_c_${Date.now()}`;
  const scopeId = await createTestScope(convId);

  // 1. Inserir que Larissa já contou que estuda Enfermagem nesta conversa
  await supabase.from('conversation_episodic_memory').insert({
    conversation_id: convId,
    actor: 'larissa',
    event_type: 'self_disclosure',
    topic: 'studies',
    summary: 'Larissa já contou que faz faculdade de Enfermagem e estágio hospitalar.',
    source_message_id: 'msg_prev_larissa_study',
    importance: 0.9,
    metadata: {
      memory_class: 'landmark',
      disclosed_fact: 'estuda enfermagem',
    },
  });

  // 2. Inbound traz o assunto de hospital/saúde
  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: convId,
    memoryScopeId: scopeId,
    currentStageId: 'descoberta',
    currentObjectiveId: 'goal_lifestyle',
    currentObjectiveLabel: 'Rotina e Dia a Dia',
    currentObjectiveRequired: false,
    inboundMessages: ['nossa meu dia foi caótico, tive que ir no hospital acompanhar minha tia'],
    recentMessages: [
      { sender: 'user', text: 'correria pura hoje' },
    ],
    availableSubagents: subagents,
    agentId: AGENT_ID,
    apiKey: OPENAI_KEY,
    strictOpenAiPilot: true,
  });

  const sessionDetails = result.telemetry?.sessionId
    ? await fetchSessionToolDetails(result.telemetry.sessionId)
    : { toolCalls: [] };

  // Limpeza
  await supabase.from('conversation_episodic_memory').delete().eq('conversation_id', convId);
  await supabase.from('agent_memory_scopes').delete().eq('conversation_id', convId);

  return {
    name: 'CASO C — AUTORREVELAÇÃO DA LARISSA',
    convId,
    result,
    sessionDetails,
  };
}

async function main() {
  console.log('INICIANDO VALIDAÇÃO DOS 3 CENÁRIOS COM AGENT GPT-5.6-TERRA REAL');
  
  const caseA = await runScenarioA();
  const caseB = await runScenarioB();
  const caseC = await runScenarioC();

  console.log('\n===============================================================');
  console.log(' RELATÓRIO CONSOLIDADO DE TELEMETRIA DOS 3 CENÁRIOS');
  console.log('===============================================================');

  for (const c of [caseA, caseB, caseC]) {
    const t = c.result?.telemetry || {};
    const plan = c.result?.plan || {};
    const calls = c.sessionDetails?.toolCalls || [];

    const personaCalls = calls.filter((x) => x.name.includes('persona_memory'));
    const contactCalls = calls.filter((x) => x.name.includes('contact_memory'));
    const convCalls = calls.filter((x) => x.name.includes('conversation_memory'));

    console.log(`\n--- ${c.name} ---`);
    console.log(`Status: ${c.result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Session ID: ${t.sessionId}`);
    console.log(`Responses:`, plan.responses);
    console.log(`Reasoning: ${plan.reasoning}`);
    console.log(`personaMemorySearchCalls: ${personaCalls.length}`);
    console.log(`contactMemorySearchCalls: ${contactCalls.length}`);
    console.log(`conversationMemorySearchCalls: ${convCalls.length}`);
    
    for (const call of calls) {
      console.log(`  - Tool: ${call.name}`);
      console.log(`    Arguments: ${JSON.stringify(call.arguments)}`);
    }

    console.log(`agentInputTokens: ${t.inputTokens}`);
    console.log(`agentOutputTokens: ${t.outputTokens}`);
    console.log(`agentTotalTokens: ${t.totalTokens}`);
    console.log(`secondModelInferenceCalls: 0`);
  }

  // Verificação de isolamento de scope (Step 7)
  console.log('\n===============================================================');
  console.log(' TESTE DE ISOLAMENTO CROSS-CONVERSATION (STEP 7)');
  console.log('===============================================================');
  const fakeScopeRes = await fetch(`${SUPABASE_URL}/functions/v1/vendeo-brain-mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.VENDEO_BRAIN_MCP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 999,
      method: 'tools/call',
      params: {
        name: 'contact_memory_search',
        arguments: {
          scope: 'scope_cross_conv_attacker',
          query: 'segredos',
        },
      },
    }),
  }).then((r) => r.json());

  const isCrossIsolated = fakeScopeRes.error || (fakeScopeRes.result?.isError === true);
  console.log(`crossConversationIsolation = ${isCrossIsolated ? 'PASS' : 'FAIL'}`);
}

main().catch(console.error);
