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
    // Captura qualquer item que seja tool call, mcp call, function call ou output
    const isCall = it.type === 'tool_call' || it.type === 'mcp_call' || it.type === 'function_call';
    const isOutput = it.type === 'tool_result' || it.type === 'function_call_output' || it.type === 'mcp_call_output';
    if (isCall || isOutput) {
      toolCalls.push({
        type: it.type,
        name: it.name || it.call_id || '',
        arguments: it.arguments || it.input,
        output: it.output || it.content,
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
  console.log(' CASO B — ANTI-REPETIÇÃO SEMÂNTICA DE PROFISSÃO/TRABALHO');
  console.log('===============================================================');
  console.log(' Pre-condição: Larissa JÁ perguntou profissão anteriormente.');
  console.log(' Inbound: "hoje o trabalho tá tranquilo kkk"');
  console.log(' Critério: Terra NÃO pode perguntar profissão/trabalho de nenhuma forma.');
  console.log('');

  const convId = `test_terra_case_b_${Date.now()}`;
  const scopeId = await createTestScope(convId);

  // Pre-condição: Larissa já perguntou profissão/área de trabalho
  await supabase.from('conversation_episodic_memory').insert({
    conversation_id: convId,
    actor: 'larissa',
    event_type: 'question',
    topic: 'profession',
    summary: 'Larissa já perguntou ao pretendente sobre profissão: "vc trabalha em qual área?".',
    source_message_id: 'msg_prev_larissa_q',
    importance: 0.9,
    loop_status: 'open',
    metadata: {
      memory_class: 'speech_act',
      question_topic: 'job',
      semantic_intent: 'PROFISSAO_TRABALHO',
    },
  });

  // Inbound com gancho DIRETO de trabalho → força Terra a consultar memória
  // antes de qualquer pergunta sobre profissão
  const result = await runOpenAiBrainTurn({
    supabase,
    conversationId: convId,
    memoryScopeId: scopeId,
    currentStageId: 'descoberta',
    currentObjectiveId: 'goal_job',
    currentObjectiveLabel: 'Profissão',
    currentObjectiveRequired: false,
    currentObjectiveDescription: 'Descobrir profissão ou ocupação do pretendente',
    inboundMessages: ['hoje o trabalho tá tranquilo kkk'],
    recentMessages: [
      { sender: 'user', text: 'nossa semana tá puxada demais' },
      { sender: 'larissa', text: 'imagino, nem me fale rs' },
    ],
    availableSubagents: subagents,
    agentId: AGENT_ID,
    apiKey: OPENAI_KEY,
    strictOpenAiPilot: true,
  });

  // Buscar TODOS os items da sessão para extrair o output do conversation_memory_search
  let conversationMemoryOutput = null;
  let conversationMemorySearchCalls = 0;
  let allToolCalls = [];
  let speechActsRecovered = [];

  const sessionDetails = result.telemetry?.sessionId
    ? await fetchSessionToolDetails(result.telemetry.sessionId)
    : { toolCalls: [], items: [] };

  // Extrair output real do conversation_memory_search via items brutos
  const rawItems = sessionDetails.items || [];
  for (const item of rawItems) {
    const name = String(item.name || item.call_id || '');

    // Tool call de conversation_memory_search
    if (
      item.type === 'tool_call' ||
      item.type === 'mcp_call' ||
      item.type === 'function_call' ||
      name.includes('conversation_memory_search')
    ) {
      allToolCalls.push({ type: item.type, name, args: item.arguments, output: item.output });

      if (name.includes('conversation_memory_search') || item.type === 'mcp_call') {
        conversationMemorySearchCalls++;
        // Tentar parsear output
        if (item.output) {
          try {
            const parsed = typeof item.output === 'string' ? JSON.parse(item.output) : item.output;
            conversationMemoryOutput = parsed;
            // Extrair speech_acts do output
            const content = parsed?.content?.[0]?.text || parsed?.text || JSON.stringify(parsed);
            try {
              const inner = typeof content === 'string' ? JSON.parse(content) : content;
              speechActsRecovered = inner?.speech_acts || inner?.results || inner?.memories || [];
            } catch {
              speechActsRecovered = [];
            }
          } catch {
            conversationMemoryOutput = item.output;
          }
        }
      }
    }
  }

  // Telemetria
  const convMemCalls = (result.telemetry?.toolsRequested || []).filter(t =>
    t.includes('conversation_memory_search')
  ).length || conversationMemorySearchCalls;

  // ================================================================
  // MOSTRAR SPEECH ACTS RECUPERADOS
  // ================================================================
  console.log('\n--- OUTPUT REAL DO conversation_memory_search ---');
  if (conversationMemoryOutput) {
    console.log(JSON.stringify(conversationMemoryOutput, null, 2));
  } else {
    console.log('(conversation_memory_search não foi chamado OU output não capturado)');
    console.log('toolsRequested:', result.telemetry?.toolsRequested || []);
  }

  console.log('\n--- SPEECH ACTS RECUPERADOS ---');
  if (speechActsRecovered.length > 0) {
    for (const sa of speechActsRecovered) {
      console.log(' •', JSON.stringify(sa));
    }
  } else {
    console.log('(nenhum speech act capturado do output)');
  }

  console.log('\n--- RESPOSTA DO TERRA ---');
  const responses = result.plan?.responses || [];
  for (const r of responses) {
    console.log(' >', r);
  }
  console.log('Reasoning:', result.plan?.reasoning);

  // ================================================================
  // VALIDAÇÃO SEMÂNTICA DE INTENÇÃO PROFISSÃO/TRABALHO
  // Qualquer pergunta sobre profissão, trabalho, ocupação ou área
  // é REPETIÇÃO SEMÂNTICA e deve FALHAR.
  // ================================================================

  /**
   * Detecta se um texto contém pergunta com INTENÇÃO semântica de descobrir
   * profissão/trabalho/ocupação. Não é baseado em string exata.
   *
   * Exemplos que DEVEM ser detectados (REPETIÇÃO PROIBIDA):
   *   "vc trabalha com o quê?"
   *   "qual sua profissão?"
   *   "vc trabalha em qual área?"
   *   "oq vc faz da vida?"
   *   "trabalha com o que?"
   *   "qual é a sua área?"
   *   "é da área de quê?"
   *   "faz o quê?"
   *   "qual seu trampo?"
   *
   * Exemplos que NÃO devem ser detectados (aprofundamento legítimo):
   *   "vc gosta dessa área?"
   *   "é estressante esse tipo de trabalho?"
   *   "tem folga pelo menos?"
   */
  function detectsWorkProfessionQuestionIntent(text) {
    const t = text.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .trim();

    // Expansão de abreviações antes de rodar os padrões:
    // "oq" = "o quê" (muito comum no BR informal)
    // "oqe" = "o que"
    const tExpanded = t
      .replace(/\boq\b/g, 'o que')     // "oq" → "o que"
      .replace(/\boqe\b/g, 'o que')    // "oqe" → "o que"
      .replace(/\boq\?/g, 'o que?')    // "oq?" → "o que?"
      .replace(/\bpq\b/g, 'por que');  // "pq" → "por que" (evita falso positivo futuro)

    const SEMANTIC_PATTERNS = [
      // "trabalha com o quê / com o que / com oq"
      // cobre: "trabalha com oq?", "trabalha com o que?", "trabalha com o quê?"
      /trabalha\s+(com\s+(o\s+)?qu[eê]|em\s+qu[eê]|em\s+qual)/,
      // "trabalha de que / de quê"
      /trabalha\s+de\s+qu[eê]/,
      // "trabalha onde / qual empresa / em qual lugar"
      /trabalha\s+(onde|em\s+qual\s+(empresa|lugar|local))/,
      // "trabalha em que" (normalizado) — cobre "trabalha em que área?" etc.
      /trabalha\s+em\s+que\b/,
      // "qual sua/a/é a profissão"
      /qual\s+\S*\s*(a\s+)?(sua\s+)?profiss[ao]o/,
      // "qual (é a/a/sua) área" — Cobre: "qual é a sua área", "qual sua área", "qual a área"
      /qual\s+(\S+\s+)*(area|[aá]rea)\b(?!\s+(vc|voce)\s+(gost|curt|ach))/,
      // "faz o quê da vida / faz da vida"
      /faz\s+(o\s*qu[eê]\s+da\s+vida|da\s+vida)/,
      // "o que você faz" — sem contexto temporal (quando/depois/no tempo/nas horas)
      /o\s+que\s+voc[eê]?\s+faz\b(?!\s+(quando|depois|no\s+tempo|nas\s+horas|no\s+fim))/,
      // "oq vc faz" — abreviado (depois da expansão vira "o que vc faz")
      /o\s+que\s+(vc|voce)\s+faz\b(?!\s+(quando|depois|no\s+tempo|nas\s+horas|no\s+fim))/,
      // "qual seu trampo"
      /qual\s+\S*\s*(o\s+)?(seu|teu)?\s*trampo/,
      // "qual sua ocupação"
      /qual\s+\S*\s*(a\s+)?(sua\s+)?ocupa[co][ao]o/,
      // "é da área de quê" — pergunta de descoberta inicial
      /[eé]\s+da\s+[aá]rea\s+de\s+qu[eê]/,
      // "trabalha como" — descoberta inicial de função/cargo
      /trabalha\s+como\b/,
    ];

    // Rodar os padrões sobre o texto expandido (com abreviações normalizadas)
    return SEMANTIC_PATTERNS.some(p => p.test(tExpanded));
  }

  const responsesText = responses.join(' ');
  const hasWorkQuestionIntent = detectsWorkProfessionQuestionIntent(responsesText);

  // Resultado dos testes
  console.log('\n--- RESULTADOS DO CASO B ---');

  // Teste B1: Terra consultou conversation_memory_search
  // (inbound "hoje o trabalho tá tranquilo" deve disparar consulta)
  const b1Pass = convMemCalls > 0;
  console.log(b1Pass
    ? `  ✅ B1 PASS | conversation_memory_search chamado (${convMemCalls}x)`
    : `  ❌ B1 FAIL | conversation_memory_search NÃO foi chamado — Terra respondeu sem consultar memória`
  );

  // Teste B2: Resposta NÃO pergunta profissão/trabalho (anti-repetição semântica)
  const b2Pass = !hasWorkQuestionIntent;
  console.log(b2Pass
    ? `  ✅ B2 PASS | Resposta não contém pergunta de profissão/trabalho`
    : `  ❌ B2 FAIL | REPETIÇÃO SEMÂNTICA detectada — Terra perguntou profissão/trabalho mesmo já tendo perguntado antes`
  );
  if (!b2Pass) {
    console.log(`         Resposta: "${responsesText}"`);
    console.log('         Equivalentes proibidos detectados pela regex semântica.');
  }

  // Teste B3: Resposta é success
  const b3Pass = result.success === true;
  console.log(b3Pass
    ? `  ✅ B3 PASS | turn success`
    : `  ❌ B3 FAIL | turn falhou: ${result.error}`
  );

  // Limpeza
  await supabase.from('conversation_episodic_memory').delete().eq('conversation_id', convId);
  await supabase.from('agent_memory_scopes').delete().eq('conversation_id', convId);

  return {
    name: 'CASO B — ANTI-REPETIÇÃO SEMÂNTICA',
    convId,
    result,
    sessionDetails,
    assertions: {
      b1_conv_memory_called: b1Pass,
      b2_no_profession_question: b2Pass,
      b3_success: b3Pass,
      all_pass: b1Pass && b2Pass && b3Pass,
    },
    debug: {
      conversationMemorySearchCalls: convMemCalls,
      speechActsRecovered,
      responsesText,
      hasWorkQuestionIntent,
    },
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

    const personaCalls = calls.filter((x) => String(x.name || '').includes('persona_memory'));
    const contactCalls = calls.filter((x) => String(x.name || '').includes('contact_memory'));
    const convCalls = calls.filter((x) => String(x.name || '').includes('conversation_memory'));

    console.log(`\n--- ${c.name} ---`);
    console.log(`Status: ${c.result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Session ID: ${t.sessionId}`);
    console.log(`Responses:`, plan.responses);
    console.log(`Reasoning: ${plan.reasoning}`);
    console.log(`personaMemorySearchCalls: ${personaCalls.length}`);
    console.log(`contactMemorySearchCalls: ${contactCalls.length}`);
    console.log(`conversationMemorySearchCalls: ${convCalls.length}`);
    
    for (const call of calls) {
      console.log(`  - Tool [${call.type}]: ${call.name}`);
      if (call.arguments) console.log(`    Arguments: ${JSON.stringify(call.arguments)}`);
      if (call.output)    console.log(`    Output (resumo): ${JSON.stringify(call.output).slice(0, 300)}`);
    }

    console.log(`agentInputTokens: ${t.inputTokens}`);
    console.log(`agentOutputTokens: ${t.outputTokens}`);
    console.log(`agentTotalTokens: ${t.totalTokens}`);
  }

  // ================================================================
  // SCORE FINAL — CASO B ASSERÇÕES SEMÂNTICAS
  // ================================================================
  console.log('\n===============================================================');
  console.log(' SCORE FINAL — CASO B (ANTI-REPETIÇÃO SEMÂNTICA)');
  console.log('===============================================================');

  const assertions = caseB.assertions || {};
  const debug = caseB.debug || {};

  console.log(`B1 conversation_memory_search chamado : ${assertions.b1_conv_memory_called ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`B2 sem pergunta semântica profissão    : ${assertions.b2_no_profession_question ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`B3 turn success                        : ${assertions.b3_success ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');
  console.log(`conversationMemorySearchCalls : ${debug.conversationMemorySearchCalls || 0}`);
  console.log(`speechActsRecovered           : ${(debug.speechActsRecovered || []).length}`);
  console.log(`responsesText                 : "${debug.responsesText || ''}"`);
  console.log(`hasWorkQuestionIntent         : ${debug.hasWorkQuestionIntent}`);
  console.log('');

  if (assertions.all_pass) {
    console.log('🟢 CASO B — GO: anti-repetição semântica confirmada');
  } else {
    console.log('🔴 CASO B — NO-GO: falha de anti-repetição semântica');
    if (!assertions.b1_conv_memory_called) {
      console.log('   → Terra não consultou conversation_memory_search.');
      console.log('   → Anti-repetição não pode ser provada sem consulta de memória.');
    }
    if (!assertions.b2_no_profession_question) {
      console.log('   → Terra perguntou profissão/trabalho sendo que já tinha perguntado antes.');
      console.log('   → Padrão semântico detectado na resposta.');
    }
  }

  // Verificação de isolamento de scope (Step 7)
  console.log('\n===============================================================');
  console.log(' TESTE DE ISOLAMENTO CROSS-CONVERSATION (STEP 7)');
  console.log('===============================================================');
  const VENDEO_MCP_TOKEN = env.VENDEO_BRAIN_MCP_TOKEN;
  const MCP_URL = `${SUPABASE_URL}/functions/v1/vendeo-brain-mcp`;

  if (!VENDEO_MCP_TOKEN) {
    console.log('crossConversationIsolation = SKIP (VENDEO_BRAIN_MCP_TOKEN ausente)');
  } else {
    const fakeScopeRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VENDEO_MCP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 999,
        method: 'tools/call',
        params: {
          name: 'contact_memory_search',
          arguments: { scope: 'scope_cross_conv_attacker', query: 'segredos' },
        },
      }),
    }).then((r) => r.json());

    const isCrossIsolated = fakeScopeRes.error || (fakeScopeRes.result?.isError === true);
    console.log(`crossConversationIsolation = ${isCrossIsolated ? 'PASS' : 'FAIL'}`);
  }

  // Exit code baseado no Caso B
  process.exit(assertions.all_pass ? 0 : 1);
}

main().catch(console.error);

