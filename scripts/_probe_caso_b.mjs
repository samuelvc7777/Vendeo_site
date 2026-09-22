/**
 * Executa Caso B isolado e captura o output completo do conversation_memory_search
 * e a resposta do Terra, para análise de anti-repetição semântica.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const envPath = path.resolve('./scripts/../.env.local');
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
  console.error('Configs ausentes');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const { runOpenAiBrainTurn } = await import('../supabase/functions/api/openai_brain.ts');

async function fetchAllSessionItems(sessionId) {
  const headers = {
    Authorization: `Bearer ${OPENAI_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'agents=v1',
  };
  const res = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

const convId = `probe_caso_b_${Date.now()}`;
const scopeId = `scope_${Date.now()}_probe`;
const expiresAt = new Date(Date.now() + 300000).toISOString();

await supabase.from('agent_memory_scopes').insert({
  scope_id: scopeId,
  conversation_id: convId,
  cycle_id: `cycle_probe`,
  agent_id: 'test_probe',
  expires_at: expiresAt,
});

// Inserir speech act: Larissa já perguntou profissão
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

console.log('\n=== EXECUTANDO CASO B ===');
console.log('convId:', convId);
console.log('Inbound: "finalmente terminei o expediente por hoje, tô exausto"');

const subagents = [
  { id: 'conexao_inicial', name: 'Conexão Inicial', mission: 'Criar rapport' },
  { id: 'descoberta', name: 'Descoberta', mission: 'Descobrir contexto sem interrogar' },
];

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

console.log('\n=== RESULTADO DO TERRA ===');
console.log('Success:', result.success);
console.log('Responses:', JSON.stringify(result.plan?.responses, null, 2));
console.log('Reasoning:', result.plan?.reasoning);

// Detalhar todas as tool calls da sessão
const sessionId = result.telemetry?.sessionId;
if (sessionId) {
  console.log('\n=== TOOL CALLS DA SESSÃO', sessionId, '===');
  const items = await fetchAllSessionItems(sessionId);
  
  for (const item of items) {
    if (item.type === 'tool_call' || item.type === 'mcp_call' || item.type === 'function_call_output') {
      console.log('\n--- Item type:', item.type, '---');
      if (item.name) console.log('  Name:', item.name);
      if (item.arguments) {
        try {
          console.log('  Arguments:', JSON.stringify(JSON.parse(item.arguments), null, 4));
        } catch { console.log('  Arguments (raw):', item.arguments); }
      }
      if (item.output) {
        try {
          const out = JSON.parse(item.output);
          console.log('  OUTPUT:');
          console.log(JSON.stringify(out, null, 4));
        } catch { console.log('  Output (raw):', item.output?.slice(0, 2000)); }
      }
    }
  }
}

console.log('\n=== TOKENS ===');
console.log('Input:', result.telemetry?.inputTokens);
console.log('Output:', result.telemetry?.outputTokens);

// Limpeza
await supabase.from('conversation_episodic_memory').delete().eq('conversation_id', convId);
await supabase.from('agent_memory_scopes').delete().eq('conversation_id', convId);
console.log('\nLimpeza feita.');
