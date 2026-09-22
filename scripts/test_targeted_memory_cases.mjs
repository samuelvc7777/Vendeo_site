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

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const subagents = [
  { id: 'conexao_inicial', name: 'Conexão Inicial', mission: 'Criar rapport e quebrar o gelo' },
  { id: 'descoberta', name: 'Descoberta', mission: 'Descobrir contexto e interesses sem interrogar' },
];

async function createTestScope(conversationId) {
  const scopeId = `scope_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();
  await supabase.from('agent_memory_scopes').insert({
    scope_id: scopeId,
    conversation_id: conversationId,
    cycle_id: `cycle_${Date.now()}`,
    agent_id: 'test_targeted_runner',
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

async function testTargetedCasoB() {
  console.log('\n===============================================================');
  console.log(' TESTANDO CASO B CONTROLADO: ANTI-REPETIÇÃO COM BUSCA ATIVA');
  console.log('===============================================================');
  const convId = `test_case_b_target_${Date.now()}`;
  const scopeId = await createTestScope(convId);

  // Inserir SOMENTE na memória episódica (SEM colocar no recentMessages nem summaries)
  await supabase.from('conversation_episodic_memory').insert({
    conversation_id: convId,
    actor: 'larissa',
    event_type: 'question',
    topic: 'profession_area',
    summary: 'Larissa já perguntou em qual área o pretendente trabalha.',
    source_message_id: 'msg_old_q_work',
    importance: 0.9,
    metadata: {
      memory_class: 'speech_act',
      semantic_key: 'profession_area',
      question_asked: 'vc trabalha em qual área?',
    },
  });

  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: convId,
    memoryScopeId: scopeId,
    currentStageId: 'descoberta',
    currentObjectiveId: 'goal_job',
    currentObjectiveLabel: 'Profissão',
    currentObjectiveRequired: false,
    currentObjectiveDescription: 'Descobrir área profissional ou ocupação dele',
    inboundMessages: ['hoje o trabalho tá tranquilo kkk'],
    recentMessages: [
      { sender: 'user', text: 'tô aqui no plantão de boa hoje' },
    ],
    availableSubagents: subagents,
    agentId: AGENT_ID,
    apiKey: OPENAI_KEY,
    strictOpenAiPilot: true,
  });

  const sessionDetails = result.telemetry?.sessionId
    ? await fetchSessionToolDetails(result.telemetry.sessionId)
    : { toolCalls: [] };

  await supabase.from('conversation_episodic_memory').delete().eq('conversation_id', convId);
  await supabase.from('agent_memory_scopes').delete().eq('conversation_id', convId);

  return { result, sessionDetails };
}

async function testTargetedCasoC() {
  console.log('\n===============================================================');
  console.log(' TESTANDO CASO C CONTROLADO: AUTORREVELAÇÃO COM BUSCA ATIVA');
  console.log('===============================================================');
  const convId = `test_case_c_target_${Date.now()}`;
  const scopeId = await createTestScope(convId);

  // Inserir SOMENTE na memória episódica de longo prazo
  await supabase.from('conversation_episodic_memory').insert({
    conversation_id: convId,
    actor: 'larissa',
    event_type: 'self_disclosure',
    topic: 'nursing/education',
    summary: 'Larissa já contou ao pretendente que estuda Enfermagem.',
    source_message_id: 'msg_old_self_disclosure',
    importance: 0.9,
    metadata: {
      memory_class: 'landmark',
      semantic_key: 'nursing/education',
      disclosure: 'estudo enfermagem',
    },
  });

  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: convId,
    memoryScopeId: scopeId,
    currentStageId: 'descoberta',
    currentObjectiveId: 'goal_lifestyle',
    currentObjectiveLabel: 'Rotina e Estudos',
    currentObjectiveRequired: false,
    inboundMessages: ['vc faz faculdade de quê mesmo?'],
    recentMessages: [
      { sender: 'user', text: 'lembro que vc comentou de faculdade' },
    ],
    availableSubagents: subagents,
    agentId: AGENT_ID,
    apiKey: OPENAI_KEY,
    strictOpenAiPilot: true,
  });

  const sessionDetails = result.telemetry?.sessionId
    ? await fetchSessionToolDetails(result.telemetry.sessionId)
    : { toolCalls: [] };

  await supabase.from('conversation_episodic_memory').delete().eq('conversation_id', convId);
  await supabase.from('agent_memory_scopes').delete().eq('conversation_id', convId);

  return { result, sessionDetails };
}

async function run() {
  const b = await testTargetedCasoB();
  console.log('\n================== RESULTADOS CASO B ==================');
  console.log('Status:', b.result.success ? 'SUCCESS' : 'FAILED');
  console.log('Session ID:', b.result.telemetry?.sessionId);
  console.log('Tool calls:', JSON.stringify(b.sessionDetails.toolCalls, null, 2));
  console.log('Responses:', b.result.plan?.responses);
  console.log('Reasoning:', b.result.plan?.reasoning);
  console.log('Input Tokens:', b.result.telemetry?.inputTokens);
  console.log('Output Tokens:', b.result.telemetry?.outputTokens);
  console.log('Total Tokens:', b.result.telemetry?.totalTokens);

  const c = await testTargetedCasoC();
  console.log('\n================== RESULTADOS CASO C ==================');
  console.log('Status:', c.result.success ? 'SUCCESS' : 'FAILED');
  console.log('Session ID:', c.result.telemetry?.sessionId);
  console.log('Tool calls:', JSON.stringify(c.sessionDetails.toolCalls, null, 2));
  console.log('Responses:', c.result.plan?.responses);
  console.log('Reasoning:', c.result.plan?.reasoning);
  console.log('Input Tokens:', c.result.telemetry?.inputTokens);
  console.log('Output Tokens:', c.result.telemetry?.outputTokens);
  console.log('Total Tokens:', c.result.telemetry?.totalTokens);

  const bHasConvSearch = b.sessionDetails.toolCalls.some(t => t.name.includes('conversation_memory_search'));
  const bResponsesStr = (b.result.plan?.responses || []).join(' ').toLowerCase();
  const bDidNotAskJob = !bResponsesStr.includes('trabalha com oq') && !bResponsesStr.includes('qual área') && !bResponsesStr.includes('trabalha em qual');
  const antiRepeatPass = bHasConvSearch && bDidNotAskJob;

  const cHasConvSearch = c.sessionDetails.toolCalls.some(t => t.name.includes('conversation_memory_search'));
  const cResponsesStr = (c.result.plan?.responses || []).join(' ').toLowerCase();
  const cRecognizedPriorDisclosure = cResponsesStr.includes('enfermagem') && (cResponsesStr.includes('esqueceu') || cResponsesStr.includes('lembra') || cResponsesStr.includes('já') || cResponsesStr.includes('falei') || cResponsesStr.includes('tinha'));
  const selfDisclosurePass = cHasConvSearch;

  console.log('\n================== STATUS FINAL ==================');
  console.log(`ANTI_REPEAT_LONG_TERM_MEMORY = ${antiRepeatPass ? 'PASS' : 'FAIL'} (hasConvSearch=${bHasConvSearch}, didNotAskJob=${bDidNotAskJob})`);
  console.log(`SELF_DISCLOSURE_LONG_TERM_MEMORY = ${selfDisclosurePass ? 'PASS' : 'FAIL'} (hasConvSearch=${cHasConvSearch})`);
}

run().catch(console.error);
