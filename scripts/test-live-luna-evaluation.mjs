import fs from 'fs';
import path from 'path';

// Carregar variáveis de ambiente de .env.local
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

if (!apiKey) {
  console.error('ERRO: OPENAI_API_KEY não encontrada em .env.local');
  process.exit(1);
}

const headers = {
  Authorization: 'Bearer ' + apiKey,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

// Preços oficiais da OpenAI para GPT-5.6-Luna (por 1 milhão de tokens)
const PRICING_LUNA = {
  inputUncachedPer1M: 0.20,
  inputCachedPer1M: 0.10,
  outputPer1M: 1.20,
};

// Preços para comparação: GPT-5.6-Terra (por 1 milhão de tokens)
const PRICING_TERRA = {
  inputUncachedPer1M: 2.00,
  inputCachedPer1M: 1.00,
  outputPer1M: 12.00,
};

const BRL_EXCHANGE_RATE = 5.50; // Taxa de câmbio USD -> BRL

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

function calculateCallCost(inputTokens, cachedTokens, outputTokens, pricing) {
  const uncached = Math.max(0, inputTokens - cachedTokens);
  const uncachedCost = (uncached / 1_000_000) * pricing.inputUncachedPer1M;
  const cachedCost = (cachedTokens / 1_000_000) * pricing.inputCachedPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return uncachedCost + cachedCost + outputCost;
}

// Execução de uma sessão da Agents API com medição de telemetria
async function executeAgentSession(testCase) {
  console.log(`\n================================================================`);
  console.log(` EXECUTANDO CASO ${testCase.id}: ${testCase.name.toUpperCase()}`);
  console.log(`================================================================`);
  console.log(`Inbound: ${JSON.stringify(testCase.inbound)}`);

  const t0 = Date.now();

  const sessionPayload = {
    agent_id: agentId,
    environment: { type: 'none' },
    vault_ids: ['vault_06e9b5cb8d2d4b0a9fb5bfcbd8700af3cfbe57dc729c4c4e8f'],
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: testCase.contextPrompt,
          },
        ],
      },
    ],
  };

  const createRes = await fetch('https://api.openai.com/v1/agents/sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify(sessionPayload),
  });

  if (!createRes.ok) {
    throw new Error(`Falha ao criar sessão: ${createRes.status} - ${await createRes.text()}`);
  }

  const session = await createRes.json();
  const sessionId = session.id;
  console.log(`Sessão criada: ${sessionId}`);

  // Polling
  let finalStatus = session.status;
  const maxAttempts = 60;
  const intervalMs = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (finalStatus === 'completed' || finalStatus === 'idle') break;
    if (finalStatus === 'failed') break;
    await new Promise(r => setTimeout(r, intervalMs));
    const pollRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}`, { headers });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    finalStatus = pollData.status;
  }

  const latencyMs = Date.now() - t0;
  console.log(`Sessão finalizada com status="${finalStatus}" em ${latencyMs}ms`);

  if (finalStatus !== 'completed' && finalStatus !== 'idle') {
    // Busca turn para extrair mensagem detalhada do erro
    let turnErrorMsg = '';
    try {
      const turnsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/turns`, { headers });
      if (turnsRes.ok) {
        const turnsData = await turnsRes.json();
        const failedTurn = (turnsData.data || []).find(t => t.status === 'failed');
        if (failedTurn?.error) {
          turnErrorMsg = ` Detalhes: ${JSON.stringify(failedTurn.error)}`;
        }
      }
    } catch (_e) {}
    throw new Error(`Sessão ${sessionId} não concluiu com sucesso (status: ${finalStatus}).${turnErrorMsg}`);
  }

  // Coleta métricas de tokens em /turns
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  try {
    const turnsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/turns`, { headers });
    if (turnsRes.ok) {
      const turnsData = await turnsRes.json();
      for (const t of turnsData.data || []) {
        if (t.usage) {
          inputTokens += t.usage.input_tokens || t.usage.prompt_tokens || 0;
          outputTokens += t.usage.output_tokens || t.usage.completion_tokens || 0;
          totalTokens += t.usage.total_tokens || 0;
          if (t.usage.input_tokens_details?.cached_tokens) {
            cachedInputTokens += t.usage.input_tokens_details.cached_tokens;
          } else if (t.usage.prompt_tokens_details?.cached_tokens) {
            cachedInputTokens += t.usage.prompt_tokens_details.cached_tokens;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Aviso ao consultar /turns:', err.message);
  }

  // Se turns não retornou tokens, tenta em /sessions
  if (inputTokens === 0) {
    try {
      const sRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}`, { headers });
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.usage) {
          inputTokens = sData.usage.input_tokens || 0;
          outputTokens = sData.usage.output_tokens || 0;
          totalTokens = sData.usage.total_tokens || 0;
          if (sData.usage.prompt_tokens_details?.cached_tokens) {
            cachedInputTokens = sData.usage.prompt_tokens_details.cached_tokens;
          }
        }
      }
    } catch (_e) {}
  }

  // Coleta items (ferramentas chamadas e resposta do assistente)
  const itemsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers });
  if (!itemsRes.ok) {
    throw new Error(`Falha ao buscar items da sessão: ${itemsRes.status}`);
  }
  const itemsData = await itemsRes.json();
  const items = itemsData.data || [];

  const toolsCalled = [];
  let personaMemoryCalls = 0;
  let contactMemoryCalls = 0;
  let conversationMemoryCalls = 0;

  for (const item of items) {
    const isTool = item.type === 'tool_call' || item.type === 'mcp_call';
    const rawName = String(item.name || item.call?.name || '');
    if (isTool || rawName.includes('memory_search')) {
      toolsCalled.push(rawName);
      if (rawName.includes('persona_memory')) personaMemoryCalls++;
      if (rawName.includes('contact_memory')) contactMemoryCalls++;
      if (rawName.includes('conversation_memory')) conversationMemoryCalls++;
    }
  }

  // Mensagem final do assistente
  const assistantMsg = [...items].reverse().find(
    it => it.type === 'message' && it.role === 'assistant' && (it.phase === 'final_answer' || !it.phase)
  );

  const rawText = assistantMsg?.content?.[0]?.text || '';
  const parsedPlan = extractJson(rawText);

  console.log(`Tools chamadas (${toolsCalled.length}):`, toolsCalled);
  console.log(`Tokens: input=${inputTokens} (cached=${cachedInputTokens}), output=${outputTokens}, total=${totalTokens}`);
  console.log(`Resposta JSON detectada: ${Boolean(parsedPlan)}`);
  if (parsedPlan) {
    console.log(`Subagente: ${parsedPlan.responsibleSubagent}`);
    console.log(`ObjectiveDecision: ${parsedPlan.objectiveDecision} (satisfied=${parsedPlan.satisfiedObjectiveId}, evidence=${parsedPlan.evidenceMessageId})`);
    console.log(`ResolvedQuestionIntentIds:`, parsedPlan.resolvedQuestionIntentIds);
    console.log(`QuestionIntents:`, JSON.stringify(parsedPlan.questionIntents || []));
    console.log(`Responses:`, JSON.stringify(parsedPlan.responses || []));
  } else {
    console.log(`Raw text:`, rawText.slice(0, 300));
  }

  // Validação dos critérios
  const validation = testCase.validate({
    plan: parsedPlan,
    rawText,
    toolsCalled,
    personaMemoryCalls,
    contactMemoryCalls,
    conversationMemoryCalls,
    inputTokens,
    outputTokens,
    latencyMs,
  });

  const costLuna = calculateCallCost(inputTokens, cachedInputTokens, outputTokens, PRICING_LUNA);
  const costTerra = calculateCallCost(inputTokens, cachedInputTokens, outputTokens, PRICING_TERRA);

  return {
    caseId: testCase.id,
    name: testCase.name,
    sessionId,
    latencyMs,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    costLuna,
    costTerra,
    toolsCalled,
    personaMemoryCalls,
    contactMemoryCalls,
    conversationMemoryCalls,
    parsedPlan,
    rawText,
    validation,
  };
}

// Definição dos 6 Casos Canônicos de Teste
function buildTestCases() {
  return [
    // -------------------------------------------------------------------------
    // CASO 1: SAUDAÇÃO
    // -------------------------------------------------------------------------
    {
      id: 1,
      name: 'Saudação Inicial',
      inbound: 'Oii, tudo bem?',
      contextPrompt: `# TURNO DA CONVERSA: conv_live_luna_case_1
ETAPA ATUAL: stage_1_conexao
OBJETIVO ATIVO DA ETAPA: goal_city ("Descobrir onde o pretendente mora") [OBRIGATÓRIO] - Descrição: Identificar de forma leve a cidade ou região

## NOVAS MENSAGENS RECEBIDAS NESTE TURNO
[MENSAGEM id="msg_c1_inbound_1"]: "Oii, tudo bem?"

## SUBAGENTES DISPONÍVEIS
- ID: "conexao_inicial" | Nome: "Conexão Inicial" | Missão: Acolher, estabelecer tom leve, caloroso e informal
- ID: "descoberta" | Nome: "Descoberta" | Missão: Avançar em objetivos de descoberta com perguntas naturais

## INSTRUÇÃO OPERACIONAL DO TURNO
Você opera em TURNO ÚNICO seguindo rigorosamente suas instruções persistentes e o LARISSA_INTERACTION_DNA.
Avalie o turno, consulte memórias sob demanda se houver incerteza ou gancho real, decida objectiveDecision (pursue, defer, already_satisfied ou none), assuma o subagente responsável e gere responses[].

DIRETRIZ DE EVIDÊNCIA:
Se objectiveDecision for "already_satisfied", satisfiedObjectiveId e evidenceMessageId são OBRIGATÓRIOS. Para pursue, defer ou none, evidenceMessageId deve ser null.

CONTRATO DE SAÍDA JSON FINAL:
Emita EXCLUSIVAMENTE um único objeto JSON final com os campos action, responsibleSubagent, objectiveDecision, satisfiedObjectiveId, evidenceMessageId, reasoning, liveStatePatch, currentTopic, bestHook, memoryConsulted, memoryRationale, resolvedQuestionIntentIds, questionIntents, turnContract, responses.`,
      validate: ({ plan, toolsCalled }) => {
        const schemaValid = Boolean(plan && plan.action && plan.responses && Array.isArray(plan.responses) && plan.responses.length > 0);
        // Saudação pura não requer MCP de busca no Supabase
        const zeroUnnecessaryMcp = toolsCalled.length === 0;
        // DNA Larissa: sem ponto final seco, sem gírias proibidas
        const responsesText = (plan?.responses || []).join(' ');
        const dnaValid = !/\btramp/i.test(responsesText) && !/\bcê\b/i.test(responsesText) && !/[a-zA-Z0-9]\.\s*$/.test(responsesText.trim());
        // Se houver pergunta de retribuição (ex: "tudo bem e vc?"), questionIntents deve refletir ou ser vazio se sem pergunta
        const hasQuestion = responsesText.includes('?');
        const questionIntentsCoherent = !hasQuestion || (plan?.questionIntents && plan.questionIntents.length > 0);

        const pass = schemaValid && zeroUnnecessaryMcp && dnaValid && questionIntentsCoherent;
        return {
          pass,
          schemaValid,
          dnaValid,
          toolSelectionValid: zeroUnnecessaryMcp,
          antiRepeatValid: true,
          details: `schema=${schemaValid}, zeroMcp=${zeroUnnecessaryMcp}, dna=${dnaValid}, qCoherent=${questionIntentsCoherent}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // CASO 2: DISCOVERY-QUESTION MEMORY GATE
    // -------------------------------------------------------------------------
    {
      id: 2,
      name: 'Discovery Question Memory Gate',
      inbound: 'hoje o trabalho tá tranquilo kkk',
      contextPrompt: `# TURNO DA CONVERSA: conv_live_luna_case_2
ETAPA ATUAL: stage_1_conexao
OBJETIVO ATIVO DA ETAPA: goal_profession ("Descobrir profissão") [OBRIGATÓRIO] - Descrição: Identificar profissão ou área de atuação do pretendente
MEMORY_SCOPE_ID: "conv_live_luna_case_2" (Obrigatório usar como parâmetro 'scope' ao chamar contact_memory_search ou conversation_memory_search)

## PERGUNTAS RECENTES (SEMANTIC QUESTION INTENTS)
• intentKey: "discover.profession" | status: asked | pergunta: "vc trabalha com o que?" | sentido: "descobrir profissão"

## HISTÓRICO RECENTE
[Larissa]: tudo bem por aqui tbm! vc trabalha com o que?
[Pretendente]: hoje o trabalho tá tranquilo kkk

## NOVAS MENSAGENS RECEBIDAS NESTE TURNO
[MENSAGEM id="msg_c2_inbound_1"]: "hoje o trabalho tá tranquilo kkk"

## SUBAGENTES DISPONÍVEIS
- ID: "conexao_inicial" | Nome: "Conexão Inicial" | Missão: Acolher e bater papo leve
- ID: "descoberta" | Nome: "Descoberta" | Missão: Conduzir descoberta respeitando gates de anti-repetição

## INSTRUÇÃO OPERACIONAL DO TURNO
Você opera em TURNO ÚNICO seguindo rigorosamente suas instruções persistentes e o LARISSA_INTERACTION_DNA.
REGRA DO DISCOVERY-QUESTION MEMORY GATE:
Se cogitar fazer qualquer pergunta sobre profissão/trabalho, verifique o ledger e o histórico recente. A pergunta "vc trabalha com o que?" JÁ FOI FEITA no turno anterior. É EXPRESSAMENTE PROIBIDO perguntar novamente com o que ele trabalha, qual sua profissão ou qual sua área.

CONTRATO DE SAÍDA JSON FINAL:
Emita EXCLUSIVAMENTE um único objeto JSON final com os campos action, responsibleSubagent, objectiveDecision, satisfiedObjectiveId, evidenceMessageId, reasoning, liveStatePatch, currentTopic, bestHook, memoryConsulted, memoryRationale, resolvedQuestionIntentIds, questionIntents, turnContract, responses.`,
      validate: ({ plan }) => {
        const schemaValid = Boolean(plan && plan.responses && Array.isArray(plan.responses) && plan.responses.length > 0);
        const responsesText = (plan?.responses || []).join(' ');
        // Verifica se NÃO repetiu a pergunta de profissão
        const isProfessionRepeat = /(?:trabalha\s+com\s+o\s*qu[eê]|qual\s+(?:sua\s+)?profissão|qual\s+a\s+sua\s+área|oq\s+vc\s+faz\s+da\s+vida|trabalha\s+em\s+qu(?:e|al))/i.test(responsesText);
        const antiRepeatValid = !isProfessionRepeat;
        const dnaValid = !/\btramp/i.test(responsesText) && !/\bcê\b/i.test(responsesText);

        const pass = schemaValid && antiRepeatValid && dnaValid;
        return {
          pass,
          schemaValid,
          dnaValid,
          toolSelectionValid: true,
          antiRepeatValid,
          details: `schema=${schemaValid}, antiRepeatProfession=${antiRepeatValid} (repeatDetected=${isProfessionRepeat})`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // CASO 3: SELF DISCLOSURE CONTINUITY
    // -------------------------------------------------------------------------
    {
      id: 3,
      name: 'Self Disclosure Continuity',
      inbound: 'vc faz faculdade de quê mesmo?',
      contextPrompt: `# TURNO DA CONVERSA: conv_live_luna_case_3
ETAPA ATUAL: stage_1_conexao
OBJETIVO ATIVO DA ETAPA: goal_city ("Descobrir cidade") [OBRIGATÓRIO]
MEMORY_SCOPE_ID: "conv_live_luna_case_3"

## FATOS CONHECIDOS DA PERSONA LARISSA
• Formação: Larissa estuda Enfermagem (ama a área hospitalar e o cuidado humano)
• Cidade: Larissa mora em Belo Horizonte MG

## HISTÓRICO RECENTE
[Larissa]: ah eu faço faculdade de enfermagem, amo a área da saúde
[Pretendente]: sério? que massa
[Pretendente]: vc faz faculdade de quê mesmo?

## NOVAS MENSAGENS RECEBIDAS NESTE TURNO
[MENSAGEM id="msg_c3_inbound_1"]: "vc faz faculdade de quê mesmo?"

## SUBAGENTES DISPONÍVEIS
- ID: "conexao_inicial" | Nome: "Conexão Inicial" | Missão: Responder com naturalidade, manter tom humano e bem humorado

## INSTRUÇÃO OPERACIONAL DO TURNO
Você opera em TURNO ÚNICO seguindo o LARISSA_INTERACTION_DNA.
O pretendente perguntou novamente a faculdade da Larissa ("de quê mesmo?").
Responda de forma autêntica e meiga com o tom da Larissa, demonstrando continuidade (ex: lembrando que é Enfermagem, sem formato de robô ou primeira apresentação formal).

CONTRATO DE SAÍDA JSON FINAL:
Emita EXCLUSIVAMENTE um único objeto JSON final com os campos action, responsibleSubagent, objectiveDecision, satisfiedObjectiveId, evidenceMessageId, reasoning, liveStatePatch, currentTopic, bestHook, memoryConsulted, memoryRationale, resolvedQuestionIntentIds, questionIntents, turnContract, responses.`,
      validate: ({ plan }) => {
        const schemaValid = Boolean(plan && plan.responses && Array.isArray(plan.responses) && plan.responses.length > 0);
        const responsesText = (plan?.responses || []).join(' ');
        // Deve mencionar enfermagem
        const mentionsNursing = /enfermagem/i.test(responsesText);
        // Não deve ser robótico tipo "Como eu havia dito anteriormente, eu curso..."
        const naturalStyle = !/como\s+(?:eu\s+)?havia\s+dito\s+anteriormente/i.test(responsesText);
        const dnaValid = !/\btramp/i.test(responsesText) && !/\bcê\b/i.test(responsesText);

        const pass = schemaValid && mentionsNursing && naturalStyle && dnaValid;
        return {
          pass,
          schemaValid,
          dnaValid,
          toolSelectionValid: true,
          antiRepeatValid: true,
          details: `schema=${schemaValid}, mentionsNursing=${mentionsNursing}, natural=${naturalStyle}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // CASO 4: ALLIGATOR / IMMEDIATE TURN CONTINUITY GATE
    // -------------------------------------------------------------------------
    {
      id: 4,
      name: 'Alligator / Immediate-Turn Continuity',
      inbound: 'Ah nem tanto, vou sempre pra visitar a familia / Aqui ficou eu e meus pais / La ta os tios, primas e tudo sabe',
      contextPrompt: `# TURNO DA CONVERSA: conv_live_luna_case_4
ETAPA ATUAL: stage_1_conexao
OBJETIVO ATIVO DA ETAPA: goal_city ("Descobrir onde o pretendente mora") [OBRIGATÓRIO]
MEMORY_SCOPE_ID: "conv_live_luna_case_4"

## PERGUNTAS RECENTES (SEMANTIC QUESTION INTENTS)
• intentKey: "feeling.miss_previous_place" | status: asked | pergunta: "vc sente falta de lá às vezes?" | sentido: "saber se o pretendente sente falta do lugar anterior (Barbacena)"

## HISTÓRICO RECENTE
[Pretendente]: sou de Barbacena mas moro em São João del-Rei tem uns anos já
[Larissa]: que legal! vc sente falta de lá às vezes?
[Pretendente]: Ah nem tanto, vou sempre pra visitar a familia
[Pretendente]: Aqui ficou eu e meus pais
[Pretendente]: La ta os tios, primas e tudo sabe

## NOVAS MENSAGENS RECEBIDAS NESTE TURNO
[MENSAGEM id="msg_c4_1"]: "Ah nem tanto, vou sempre pra visitar a familia"
[MENSAGEM id="msg_c4_2"]: "Aqui ficou eu e meus pais"
[MENSAGEM id="msg_c4_3"]: "La ta os tios, primas e tudo sabe"

## SUBAGENTES DISPONÍVEIS
- ID: "conexao_inicial" | Nome: "Conexão Inicial" | Missão: Acolher e aprofundar conversa de forma calorosa
- ID: "descoberta" | Nome: "Descoberta" | Missão: Avançar objetivos respeitando anti-repetição

## INSTRUÇÃO OPERACIONAL DO TURNO
Você opera em TURNO ÚNICO seguindo rigorosamente o LARISSA_INTERACTION_DNA e o IMMEDIATE-TURN CONTINUITY GATE.
O pretendente RESPONDEU à sua pergunta anterior ("vc sente falta de lá às vezes?").
Portanto:
1. Adicione "feeling.miss_previous_place" em resolvedQuestionIntentIds.
2. É ESTRITAMENTE PROIBIDO repetir a mesma intenção ou refrasear ("sente saudade de morar lá?", "tem vontade de voltar a morar lá?").
3. Acolha a resposta sobre a família e, se fizer nova pergunta, use um NOVO ângulo (ex: visitas à família, finais de semana) com nova intentKey correspondente.

CONTRATO DE SAÍDA JSON FINAL:
Emita EXCLUSIVAMENTE um único objeto JSON final com os campos action, responsibleSubagent, objectiveDecision, satisfiedObjectiveId, evidenceMessageId, reasoning, liveStatePatch, currentTopic, bestHook, memoryConsulted, memoryRationale, resolvedQuestionIntentIds, questionIntents, turnContract, responses.`,
      validate: ({ plan }) => {
        const schemaValid = Boolean(plan && plan.responses && Array.isArray(plan.responses) && plan.responses.length > 0);
        // resolvedQuestionIntentIds deve conter feeling.miss_previous_place
        const resolvedCorrectly = (plan?.resolvedQuestionIntentIds || []).includes('feeling.miss_previous_place');
        // Não deve repetir pergunta sobre sentir falta de lá
        const responsesText = (plan?.responses || []).join(' ');
        const repeatedMissPlace = /(?:sente|sentir)\s+(?:falta|saudade)\s+de\s+(?:morar\s+)?l[aá]/i.test(responsesText) ||
                                  /vontade\s+de\s+voltar\s+pra\s+morar/i.test(responsesText);
        const antiRepeatValid = !repeatedMissPlace;

        const pass = schemaValid && resolvedCorrectly && antiRepeatValid;
        return {
          pass,
          schemaValid,
          dnaValid: true,
          toolSelectionValid: true,
          antiRepeatValid,
          details: `schema=${schemaValid}, resolved=${resolvedCorrectly}, antiRepeatMissPlace=${antiRepeatValid}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // CASO 5: ALREADY SATISFIED & EVIDENCE BINDING
    // -------------------------------------------------------------------------
    {
      id: 5,
      name: 'Already Satisfied & Evidence Binding',
      inbound: 'Sou de São João del Rei e vc?',
      contextPrompt: `# TURNO DA CONVERSA: conv_live_luna_case_5
ETAPA ATUAL: stage_1_conexao
OBJETIVO ATIVO DA ETAPA: goal_city ("Descobrir onde o pretendente mora") [OBRIGATÓRIO] - Descrição: Identificar cidade ou região

## NOVAS MENSAGENS RECEBIDAS NESTE TURNO
[MENSAGEM id="msg_c5_inbound_1"]: "Sou de São João del Rei e vc?"

## SUBAGENTES DISPONÍVEIS
- ID: "conexao_inicial" | Nome: "Conexão Inicial" | Missão: Acolher e trocar sobre localização
- ID: "descoberta" | Nome: "Descoberta" | Missão: Validar checkpoints e reconciliação factual

## INSTRUÇÃO OPERACIONAL DO TURNO
Você opera em TURNO ÚNICO seguindo rigorosamente o LARISSA_INTERACTION_DNA.
DIRETRIZ DE EVIDÊNCIA DO OBJETIVO:
O pretendente acabou de revelar espontaneamente a cidade dele na mensagem id="msg_c5_inbound_1" ("Sou de São João del Rei e vc?").
Portanto:
- objectiveDecision DEVE ser "already_satisfied"
- satisfiedObjectiveId DEVE ser "goal_city"
- evidenceMessageId DEVE ser exatamente "msg_c5_inbound_1"
- Larissa responde de onde ela é (BH) e NÃO pergunta "de onde você é?".

CONTRATO DE SAÍDA JSON FINAL:
Emita EXCLUSIVAMENTE um único objeto JSON final com os campos action, responsibleSubagent, objectiveDecision, satisfiedObjectiveId, evidenceMessageId, reasoning, liveStatePatch, currentTopic, bestHook, memoryConsulted, memoryRationale, resolvedQuestionIntentIds, questionIntents, turnContract, responses.`,
      validate: ({ plan }) => {
        const schemaValid = Boolean(plan && plan.responses && Array.isArray(plan.responses) && plan.responses.length > 0);
        const rawDecision = plan?.objectiveDecision;
        const decisionStr = typeof rawDecision === 'object' ? rawDecision?.decision : rawDecision;
        const satisfiedId = typeof rawDecision === 'object' ? (rawDecision?.objectiveId || plan?.satisfiedObjectiveId) : plan?.satisfiedObjectiveId;
        const evidenceId = typeof rawDecision === 'object' ? (rawDecision?.evidenceMessageId || plan?.evidenceMessageId) : plan?.evidenceMessageId;

        const decisionValid = decisionStr === 'already_satisfied';
        const satisfiedIdValid = satisfiedId === 'goal_city';
        const evidenceValid = evidenceId === 'msg_c5_inbound_1';
        const responsesText = (plan?.responses || []).join(' ');
        const noWhereFromQuestion = !/(?:de\s+onde\s+v(?:ocê|c)\s+[eé]|qual\s+sua\s+cidade)/i.test(responsesText);

        const pass = schemaValid && decisionValid && satisfiedIdValid && evidenceValid && noWhereFromQuestion;
        return {
          pass,
          schemaValid,
          dnaValid: true,
          toolSelectionValid: true,
          antiRepeatValid: noWhereFromQuestion,
          objectiveDecisionValid: decisionValid && satisfiedIdValid && evidenceValid,
          details: `schema=${schemaValid}, decision=${decisionStr}, satisfiedId=${satisfiedId}, evidenceId=${evidenceId}, noWhereFrom=${noWhereFromQuestion}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // CASO 6: ZERO QUESTION ALLOWED (ACOLHIMENTO PURO)
    // -------------------------------------------------------------------------
    {
      id: 6,
      name: 'Zero Question Allowed (Acolhimento Puro)',
      inbound: 'Nossa, meu dia hoje foi super cansativo, tive que levar minha mãe no hospital mas agr ela tá bem graças a Deus',
      contextPrompt: `# TURNO DA CONVERSA: conv_live_luna_case_6
ETAPA ATUAL: stage_1_conexao
OBJETIVO ATIVO DA ETAPA: goal_city ("Descobrir onde mora") [OBRIGATÓRIO]

## HISTÓRICO RECENTE
[Larissa]: e como foi seu dia por aí?
[Pretendente]: Nossa, meu dia hoje foi super cansativo, tive que levar minha mãe no hospital mas agr ela tá bem graças a Deus

## NOVAS MENSAGENS RECEBIDAS NESTE TURNO
[MENSAGEM id="msg_c6_inbound_1"]: "Nossa, meu dia hoje foi super cansativo, tive que levar minha mãe no hospital mas agr ela tá bem graças a Deus"

## SUBAGENTES DISPONÍVEIS
- ID: "conexao_inicial" | Nome: "Conexão Inicial" | Missão: Acolher com empatia genuína e calor humano

## INSTRUÇÃO OPERACIONAL DO TURNO
Você opera em TURNO ÚNICO seguindo rigorosamente o LARISSA_INTERACTION_DNA.
DIRETRIZ DE ZERO PERGUNTA:
O pretendente relatou uma situação delicada e cansativa envolvendo a mãe dele no hospital.
NÃO force perguntas neste momento. Priorize um acolhimento caloroso e sincero de apoio (ex: desejando melhoras, alívio por ela estar bem, mandando energias boas).
Para este turno:
- questionIntents DEVE ser [] (lista vazia)
- responses NÃO devem terminar com pergunta ou interrogação forçada.

CONTRATO DE SAÍDA JSON FINAL:
Emita EXCLUSIVAMENTE um único objeto JSON final com os campos action, responsibleSubagent, objectiveDecision, satisfiedObjectiveId, evidenceMessageId, reasoning, liveStatePatch, currentTopic, bestHook, memoryConsulted, memoryRationale, resolvedQuestionIntentIds, questionIntents, turnContract, responses.`,
      validate: ({ plan }) => {
        const schemaValid = Boolean(plan && plan.responses && Array.isArray(plan.responses) && plan.responses.length > 0);
        const zeroQuestionIntents = !plan?.questionIntents || (Array.isArray(plan?.questionIntents) && plan.questionIntents.length === 0);
        const responsesText = (plan?.responses || []).join(' ');
        const noQuestionMark = !responsesText.includes('?');

        const pass = schemaValid && zeroQuestionIntents && noQuestionMark;
        return {
          pass,
          schemaValid,
          dnaValid: true,
          toolSelectionValid: true,
          antiRepeatValid: true,
          zeroQuestionValid: zeroQuestionIntents && noQuestionMark,
          details: `schema=${schemaValid}, questionIntentsCount=${plan?.questionIntents?.length || 0}, noQuestionMark=${noQuestionMark}`,
        };
      },
    },
  ];
}

async function runEvaluationSuite() {
  console.log('================================================================================');
  console.log(' AVALIAÇÃO LIVE DO OPENAI AGENT: GPT-5.6-LUNA EM PRODUÇÃO');
  console.log('================================================================================');
  console.log(`Agent ID: ${agentId}`);
  console.log(`API Key: ${apiKey.slice(0, 12)}...`);
  console.log(`Modelo Alvo: gpt-5.6-luna`);

  const testCases = buildTestCases();
  const results = [];

  for (const tc of testCases) {
    try {
      const res = await executeAgentSession(tc);
      results.push(res);
    } catch (err) {
      console.error(`ERRO no caso ${tc.id} (${tc.name}):`, err);
      results.push({
        caseId: tc.id,
        name: tc.name,
        error: err.message,
        validation: { pass: false, details: err.message },
      });
    }
  }

  // Consolidação de métricas
  console.log('\n\n================================================================================');
  console.log(' CONSOLIDAÇÃO DE RESULTADOS & TELEMETRIA');
  console.log('================================================================================');

  const validResults = results.filter(r => !r.error);
  const totalCases = testCases.length;
  const passedCases = validResults.filter(r => r.validation?.pass).length;

  let sumInput = 0;
  let sumCached = 0;
  let sumOutput = 0;
  let sumTotal = 0;
  let sumLatency = 0;
  let sumCostLuna = 0;
  let sumCostTerra = 0;
  let sumTools = 0;

  for (const r of validResults) {
    sumInput += r.inputTokens || 0;
    sumCached += r.cachedInputTokens || 0;
    sumOutput += r.outputTokens || 0;
    sumTotal += r.totalTokens || 0;
    sumLatency += r.latencyMs || 0;
    sumCostLuna += r.costLuna || 0;
    sumCostTerra += r.costTerra || 0;
    sumTools += (r.toolsCalled || []).length;

    console.log(`\nCaso ${r.caseId} [${r.name}]: ${r.validation?.pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  - Latência: ${r.latencyMs}ms`);
    console.log(`  - Tokens: Input=${r.inputTokens} (Cached=${r.cachedInputTokens}), Output=${r.outputTokens}, Total=${r.totalTokens}`);
    console.log(`  - Custo Luna: $${(r.costLuna).toFixed(6)} | Custo Terra equiv: $${(r.costTerra).toFixed(6)}`);
    console.log(`  - Detalhes: ${r.validation?.details}`);
    if (r.parsedPlan?.responses) {
      console.log(`  - Respostas: ${JSON.stringify(r.parsedPlan.responses)}`);
    }
  }

  const count = validResults.length || 1;
  const avgInput = Math.round(sumInput / count);
  const avgCached = Math.round(sumCached / count);
  const avgOutput = Math.round(sumOutput / count);
  const avgTotal = Math.round(sumTotal / count);
  const avgLatency = Math.round(sumLatency / count);
  const avgCostLuna = sumCostLuna / count;
  const avgCostTerra = sumCostTerra / count;
  const avgTools = (sumTools / count).toFixed(2);

  // Projeção: 300 conversas/dia × 40 chamadas = 12.000 chamadas/dia
  const dailyCalls = 300 * 40;
  const costPerConversationLuna = avgCostLuna * 40;
  const dailyCostLunaUsd = avgCostLuna * dailyCalls;
  const dailyCostLunaBrl = dailyCostLunaUsd * BRL_EXCHANGE_RATE;

  const costPerConversationTerra = avgCostTerra * 40;
  const dailyCostTerraUsd = avgCostTerra * dailyCalls;
  const dailyCostTerraBrl = dailyCostTerraUsd * BRL_EXCHANGE_RATE;

  const savingsUsd = dailyCostTerraUsd - dailyCostLunaUsd;
  const savingsBrl = dailyCostTerraBrl - dailyCostLunaBrl;
  const savingsPct = ((1 - (dailyCostLunaUsd / dailyCostTerraUsd)) * 100).toFixed(1);

  console.log('\n--------------------------------------------------------------------------------');
  console.log(' RESUMO EXECUTIVO DE TELEMETRIA & CUSTOS');
  console.log('--------------------------------------------------------------------------------');
  console.log(`Taxa de Sucesso: ${passedCases}/${totalCases} (${((passedCases / totalCases) * 100).toFixed(0)}%)`);
  console.log(`Média de Tokens de Input: ${avgInput} (Cached: ${avgCached})`);
  console.log(`Média de Tokens de Output: ${avgOutput}`);
  console.log(`Média de Tokens Totais: ${avgTotal}`);
  console.log(`Média de Latência: ${avgLatency}ms`);
  console.log(`Média de MCP Calls: ${avgTools}`);
  console.log('');
  console.log(`Custo por chamada (Luna): $${avgCostLuna.toFixed(6)}`);
  console.log(`Custo por conversa de 40 chamadas (Luna): $${costPerConversationLuna.toFixed(4)}`);
  console.log(`Projeção Diária (300 conversas / 12.000 chamadas):`);
  console.log(`  - GPT-5.6-Luna:  $${dailyCostLunaUsd.toFixed(2)} USD  (R$ ${dailyCostLunaBrl.toFixed(2)} BRL)`);
  console.log(`  - GPT-5.6-Terra: $${dailyCostTerraUsd.toFixed(2)} USD  (R$ ${dailyCostTerraBrl.toFixed(2)} BRL)`);
  console.log(`  - ECONOMIA ESTIMADA: $${savingsUsd.toFixed(2)} USD/dia (R$ ${savingsBrl.toFixed(2)} BRL/dia) [${savingsPct}% de redução]`);

  // Salva dados em JSON para consumo
  const summaryReport = {
    agentId,
    model: 'gpt-5.6-luna',
    totalCases,
    passedCases,
    successRate: `${((passedCases / totalCases) * 100).toFixed(0)}%`,
    averages: {
      inputTokens: avgInput,
      cachedInputTokens: avgCached,
      outputTokens: avgOutput,
      totalTokens: avgTotal,
      latencyMs: avgLatency,
      mcpCalls: avgTools,
      costPerCallUsd: avgCostLuna,
      costPerConversation40CallsUsd: costPerConversationLuna,
      dailyCost12kCallsUsd: dailyCostLunaUsd,
      dailyCost12kCallsBrl: dailyCostLunaBrl,
    },
    comparisonWithTerra: {
      dailyCostTerraUsd,
      dailyCostTerraBrl,
      savingsUsd,
      savingsBrl,
      savingsPct,
    },
    cases: results,
  };

  fs.writeFileSync('scripts/luna_evaluation_report.json', JSON.stringify(summaryReport, null, 2), 'utf8');
  console.log('\nRelatório completo gravado em scripts/luna_evaluation_report.json');
}

runEvaluationSuite().catch(err => {
  console.error('Falha crítica na suíte:', err);
  process.exit(1);
});
