import fs from 'fs';
import path from 'path';
import {
  buildOpenAiBrainContextMessage,
} from '../supabase/functions/api/openai_brain.ts';
import {
  computeDynamicEmojiBudget,
  runStyleLint,
} from '../supabase/functions/api/LarissaChatStyle.ts';
import {
  formatRecentStyleStateForPrompt,
} from '../supabase/functions/api/larissa_interaction_dna.ts';

// 1. Carrega variáveis de ambiente de .env.local
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

const apiKey = envVars.OPENAI_API_KEY;
const agentId = envVars.OPENAI_BRAIN_AGENT_ID || 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482';
const vaultId = envVars.OPENAI_MCP_VAULT_ID || 'vault_06e9b5cb8d2d4b0a9fb5bfcbd8700af3cfbe57dc729c4c4e8f';

if (!apiKey) {
  console.error('ERRO: OPENAI_API_KEY não encontrada em .env.local');
  process.exit(1);
}

const headers = {
  Authorization: 'Bearer ' + apiKey,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

function extractJson(text) {
  if (!text) return null;
  let clean = text.trim();
  const mdMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (mdMatch) clean = mdMatch[1].trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(clean);
  } catch (err) {
    return null;
  }
}

function countEmojis(str) {
  const regex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
  const matches = str.match(regex);
  return matches ? matches.length : 0;
}

function extractEmojis(balloons) {
  const fullText = (balloons || []).join(' ');
  const regex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
  return fullText.match(regex) || [];
}

function isDeadEnd(balloons) {
  if (!Array.isArray(balloons) || balloons.length === 0) return true;
  const fullText = balloons.join(' ').trim().toLowerCase();
  const deadEndPatterns = [
    /^sou de [a-zà-ÿ\s\-]+$/i,
    /^(tenho|faço)\s+\d+\s+anos$/i,
    /^(trabalho com|sou)\s+[a-zà-ÿ\s\-]+$/i,
    /^(sim|não|aham|blz|entendi|que bom|legal|show|ótimo|obrigada)$/i,
  ];
  const hasQuestion = fullText.includes('?');
  const wordCount = fullText.split(/\s+/).length;
  if (hasQuestion) return false;
  if (wordCount > 8) return false;
  return deadEndPatterns.some((pattern) => pattern.test(fullText));
}

// Definição dos 6 turnos sequenciais
const TURNS = [
  {
    turnNumber: 1,
    input: 'oii linda, tô bem e vc?',
    messageId: 'msg_live_t1',
    currentObjective: {
      id: 'goal_city',
      label: 'Cidade',
      description: 'Descobrir ou confirmar a cidade/região onde o pretendente mora ou está no momento.',
      kind: 'fact',
    },
    nextObjectives: [
      { id: 'goal_1790089821922_2wamf', label: 'Descobrir profissão', kind: 'fact', description: 'Entender no que ele trabalha ou estuda' },
      { id: 'goal_1790089822342_oi2ym', label: 'Descobrir idade', kind: 'fact', description: 'Descobrir a faixa etária ou quantos anos tem' },
    ],
    topicHint: 'saudação',
  },
  {
    turnNumber: 2,
    input: 'Sou de Varginha e vc?',
    messageId: 'msg_live_t2',
    currentObjective: {
      id: 'goal_city',
      label: 'Cidade',
      description: 'Descobrir ou confirmar a cidade/região onde o pretendente mora ou está no momento.',
      kind: 'fact',
    },
    nextObjectives: [
      { id: 'goal_1790089821922_2wamf', label: 'Descobrir profissão', kind: 'fact', description: 'Entender no que ele trabalha ou estuda' },
      { id: 'goal_1790089822342_oi2ym', label: 'Descobrir idade', kind: 'fact', description: 'Descobrir a faixa etária ou quantos anos tem' },
    ],
    topicHint: 'cidade',
  },
  {
    turnNumber: 3,
    input: 'trabalho com construção',
    messageId: 'msg_live_t3',
    currentObjective: {
      id: 'goal_1790089821922_2wamf',
      label: 'Descobrir profissão',
      description: 'Entender no que ele trabalha ou estuda',
      kind: 'fact',
    },
    nextObjectives: [
      { id: 'goal_1790089822342_oi2ym', label: 'Descobrir idade', kind: 'fact', description: 'Descobrir a faixa etária ou quantos anos tem' },
      { id: 'goal_1790089822505_sgfph', label: 'Entender rotina', kind: 'fact', description: 'Entender horários e dinâmica do dia a dia' },
    ],
    topicHint: 'trabalho / profissão',
  },
  {
    turnNumber: 4,
    input: 'moro sozinho',
    messageId: 'msg_live_t4',
    currentObjective: {
      id: 'goal_1790089822505_sgfph',
      label: 'Entender rotina',
      description: 'Entender horários e dinâmica do dia a dia',
      kind: 'fact',
    },
    nextObjectives: [
      { id: 'goal_1790089822342_oi2ym', label: 'Descobrir idade', kind: 'fact', description: 'Descobrir a faixa etária ou quantos anos tem' },
      { id: 'goal_1790089822697_ojxwm', label: 'Descobrir hobbies', kind: 'fact', description: 'Descobrir o que ele gosta de fazer no tempo livre' },
    ],
    topicHint: 'moradia / independência',
  },
  {
    turnNumber: 5,
    input: 'hoje o serviço acabou comigo',
    messageId: 'msg_live_t5',
    currentObjective: {
      id: 'goal_1790089822505_sgfph',
      label: 'Entender rotina',
      description: 'Entender horários e dinâmica do dia a dia',
      kind: 'fact',
    },
    nextObjectives: [
      { id: 'goal_1790089822342_oi2ym', label: 'Descobrir idade', kind: 'fact', description: 'Descobrir a faixa etária ou quantos anos tem' },
    ],
    topicHint: 'cansaço / rotina puxada',
  },
  {
    turnNumber: 6,
    input: 'vc é muito fofa kkk',
    messageId: 'msg_live_t6',
    currentObjective: {
      id: 'goal_1790089822697_ojxwm',
      label: 'Descobrir hobbies',
      description: 'Descobrir o que ele gosta de fazer no tempo livre',
      kind: 'fact',
    },
    nextObjectives: [
      { id: 'goal_1790089822845_n3tiz', label: 'Entender estilo de vida', kind: 'fact', description: 'Preferências de passeios, esportes e gostos pessoais' },
    ],
    topicHint: 'elogio / flerte leve',
  },
];

async function callAgent(contextMessage) {
  const sessionPayload = {
    agent_id: agentId,
    environment: { type: 'none' },
    vault_ids: [vaultId],
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: contextMessage,
          },
        ],
      },
    ],
  };

  let createRes = null;
  let lastErr = null;
  for (let retry = 0; retry < 4; retry++) {
    try {
      createRes = await fetch('https://api.openai.com/v1/agents/sessions', {
        method: 'POST',
        headers,
        body: JSON.stringify(sessionPayload),
      });
      if (createRes.ok) break;
      if (createRes.status === 503 || createRes.status === 500 || createRes.status === 429) {
        console.warn(`[OpenAI Session] HTTP ${createRes.status} temporário. Tentando novamente em 3s... (tentativa ${retry + 1}/4)`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw new Error(`Falha ao criar sessão: ${createRes.status} - ${await createRes.text()}`);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  if (!createRes || !createRes.ok) {
    throw new Error(`Falha definitiva ao criar sessão: ${lastErr?.message || createRes?.status}`);
  }

  const session = await createRes.json();
  const sessionId = session.id;

  let finalStatus = session.status;
  for (let attempt = 0; attempt < 35; attempt++) {
    if (finalStatus === 'completed' || finalStatus === 'idle') break;
    if (finalStatus === 'failed') break;
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}`, { headers });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    finalStatus = pollData.status;
    if ((attempt + 1) % 5 === 0) {
      console.log(`[Polling ${sessionId}] status=${finalStatus} (tentativa ${attempt + 1}/35)`);
    }
  }

  if (finalStatus !== 'completed' && finalStatus !== 'idle') {
    throw new Error(`Sessão ${sessionId} encerrou com status=${finalStatus}`);
  }

  const itemsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers });
  if (!itemsRes.ok) {
    throw new Error(`Falha ao buscar items: ${itemsRes.status}`);
  }
  const itemsData = await itemsRes.json();
  const items = itemsData.data || [];

  const assistantMsg = [...items].reverse().find(
    (it) => it.type === 'message' && it.role === 'assistant' && (it.phase === 'final_answer' || !it.phase)
  );

  const rawText = assistantMsg?.content?.[0]?.text || '';
  const parsedPlan = extractJson(rawText);

  return { sessionId, rawText, parsedPlan };
}

async function callAgentWithRetry(contextMessage, maxSessionRetries = 4) {
  let lastErr = null;
  for (let sAttempt = 1; sAttempt <= maxSessionRetries; sAttempt++) {
    try {
      const res = await callAgent(contextMessage);
      if (res && res.parsedPlan) return res;
      throw new Error(`Plano retornado da sessão é nulo. Raw text: ${res?.rawText?.slice(0, 100)}`);
    } catch (err) {
      lastErr = err;
      console.warn(`[OpenAI Session Retry] Falha na sessão (tentativa ${sAttempt}/${maxSessionRetries}): ${err.message}`);
      if (sAttempt < maxSessionRetries) {
        console.log('Aguardando 4s antes de abrir nova sessão com o Luna...');
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }
  throw lastErr;
}

async function runSandboxTest() {
  console.log('================================================================================');
  console.log(' SANDBOX REAL COM LUNA — EXECUÇÃO DOS 6 TURNOS OFICIAIS (PARTE V)');
  console.log('================================================================================');
  console.log(`Agent ID: ${agentId}`);

  const checkpointPath = path.resolve('scripts/sandbox_luna_6turns_checkpoint.json');
  let checkpointData = { conversationHistory: [], turnLogs: [], recentUsedEmojis: [] };
  if (fs.existsSync(checkpointPath)) {
    try {
      checkpointData = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
      console.log(`[Checkpoint] Carregados ${checkpointData.turnLogs?.length || 0} turnos anteriores do disco.`);
    } catch (_e) {}
  }

  const conversationHistory = checkpointData.conversationHistory || [];
  const turnLogs = checkpointData.turnLogs || [];
  const recentUsedEmojis = checkpointData.recentUsedEmojis || [];

  for (const t of TURNS) {
    if (turnLogs.some((l) => l.turnNumber === t.turnNumber)) {
      console.log(`\n▶ TURNO ${t.turnNumber}: "${t.input}" [JÁ PROCESSADO NO CHECKPOINT — REAPROVEITANDO]`);
      continue;
    }

    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`▶ TURNO ${t.turnNumber}: "${t.input}"`);
    console.log(`--------------------------------------------------------------------------------`);

    // Calcula budget e contexto de estilo para este turno
    const isInboundSerious = /hospital|falec|luto|pesado|acabou comigo|dor|cansa[çc]/i.test(t.input);
    const outbounds = conversationHistory.filter((m) => m.sender === 'assistant').map((m) => m.text);
    const emojiBudgetCalc = computeDynamicEmojiBudget(outbounds);
    if (isInboundSerious) {
      emojiBudgetCalc.budget = 0;
      emojiBudgetCalc.allowEmoji = false;
    }

    const recentStyleSnippet = formatRecentStyleStateForPrompt({
      recentEmojis: recentUsedEmojis.slice(-2),
      recentResponses: conversationHistory.filter((m) => m.sender === 'assistant').slice(-2).map((m) => m.text),
    });

    const brainParams = {
      conversationId: 'sandbox_eval_luna_6turns',
      currentInboundMessages: [{ id: t.messageId, text: t.input }],
      recentMessages: conversationHistory,
      currentObjectiveId: t.currentObjective.id,
      currentObjectiveLabel: t.currentObjective.label,
      currentObjectiveDescription: t.currentObjective.description,
      currentObjectiveKind: t.currentObjective.kind,
      nextObjectives: t.nextObjectives,
      recentStyleStateSnippet: recentStyleSnippet,
    };

    const contextMessage = buildOpenAiBrainContextMessage(brainParams);
    console.log(`Enviando para o OpenAI Agent Luna...`);
    const { sessionId, rawText, parsedPlan } = await callAgentWithRetry(contextMessage);

    if (!parsedPlan) {
      console.error(`ERRO: Plano JSON não parseado no turno ${t.turnNumber}! Texto: ${rawText}`);
      throw new Error(`Falha no parse do plano JSON no turno ${t.turnNumber}`);
    }

    const responses = parsedPlan.responses || [];
    const fullOutput = responses.join(' ');
    const questionCount = responses.filter((b) => b.includes('?')).length;
    const emojiCount = countEmojis(fullOutput);
    const deadEnd = isDeadEnd(responses);

    // Style lint evaluation
    const lintResult = runStyleLint(responses, {
      maxBalloons: 4,
      emojiBudget: emojiBudgetCalc.budget,
      recentEmojis: recentUsedEmojis.slice(-2),
    });

    // Registra emojis usados
    const usedInThisTurn = extractEmojis(responses);
    recentUsedEmojis.push(...usedInThisTurn);

    // Registra no histórico da conversa
    conversationHistory.push({ sender: 'user', text: t.input });
    for (const r of responses) {
      conversationHistory.push({ sender: 'assistant', text: r });
    }

    const objectiveCompleted =
      parsedPlan.objectiveDecision === 'already_satisfied' &&
      parsedPlan.satisfiedObjectiveId === t.currentObjective.id;

    const turnLog = {
      turnNumber: t.turnNumber,
      input: t.input,
      currentObjective: t.currentObjective.id,
      objectiveDecision: parsedPlan.objectiveDecision,
      objectiveCompleted: objectiveCompleted,
      nextPendingObjective: t.nextObjectives?.[0]?.id || 'nenhum',
      output: responses,
      questionCount: questionCount,
      questionIntent: parsedPlan.questionIntents || [],
      topicRelation: t.topicHint,
      deadEnd: deadEnd,
      emojiCount: emojiCount,
      emojiBudget: emojiBudgetCalc.budget,
      styleLintResult: lintResult.passed ? 'PASS' : `FAIL (${lintResult.violations.map((v) => v.rule).join(', ')})`,
      reasoning: parsedPlan.reasoning,
    };

    turnLogs.push(turnLog);
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({ conversationHistory, turnLogs, recentUsedEmojis }, null, 2),
      'utf8'
    );

    console.log(`OUTPUT: ${JSON.stringify(responses)}`);
    console.log(`OBJECTIVE_DECISION: ${parsedPlan.objectiveDecision} (completed=${objectiveCompleted})`);
    console.log(`DEAD_END: ${deadEnd}`);
    console.log(`QUESTION_COUNT: ${questionCount}`);
    console.log(`EMOJI_COUNT: ${emojiCount} (budget=${emojiBudgetCalc.budget})`);
    console.log(`STYLE_LINT: ${turnLog.styleLintResult}`);
  }

  console.log('\n================================================================================');
  console.log(' RESUMO ESTRUTURADO DOS 6 TURNOS NO SANDBOX (PARTE V)');
  console.log('================================================================================\n');

  for (const log of turnLogs) {
    console.log(`TURNO ${log.turnNumber}:`);
    console.log(`INPUT = "${log.input}"`);
    console.log(`CURRENT_OBJECTIVE = ${log.currentObjective}`);
    console.log(`OBJECTIVE_DECISION = ${log.objectiveDecision}`);
    console.log(`OBJECTIVE_COMPLETED = ${log.objectiveCompleted}`);
    console.log(`NEXT_PENDING_OBJECTIVE = ${log.nextPendingObjective}`);
    console.log(`OUTPUT = ${JSON.stringify(log.output)}`);
    console.log(`QUESTION_COUNT = ${log.questionCount}`);
    console.log(`QUESTION_INTENT = ${JSON.stringify(log.questionIntent)}`);
    console.log(`TOPIC_RELATION = "${log.topicRelation}"`);
    console.log(`DEAD_END = ${log.deadEnd}`);
    console.log(`EMOJI_COUNT = ${log.emojiCount}`);
    console.log(`EMOJI_BUDGET = ${log.emojiBudget}`);
    console.log(`STYLE_LINT_RESULT = ${log.styleLintResult}`);
    console.log('');
  }

  // Salva resultado em artifact/arquivo json para documentação
  fs.writeFileSync(
    path.resolve('scripts/sandbox_luna_6turns_result.json'),
    JSON.stringify(turnLogs, null, 2),
    'utf8'
  );
  console.log('Resultado salvo em scripts/sandbox_luna_6turns_result.json');
}

runSandboxTest().catch((err) => {
  console.error('Erro fatal ao rodar teste no sandbox Luna:', err);
  process.exit(1);
});
