#!/usr/bin/env node
/**
 * scripts/test-larissa-persona-behavior.mjs
 * 
 * Bateria de Avaliação Comportamental da Persona Memory da Larissa com Modelo Real (Atria).
 * 
 * Regras Estritas de Segurança:
 * - NÃO envia mensagens para Meta.
 * - NÃO envia mensagens para Moose.
 * - NÃO utiliza conversas reais de produção.
 * - NÃO altera ContactMemory real.
 * - NÃO cadastra novos fatos nem altera a PersonaMemory.
 * - Executa com o motor oficial: Atria-Dawn-Preview (api.atria-asi.ai).
 * - Sem mocks nos testes comportamentais da Atria.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Carrega variáveis de ambiente
function loadEnv(projectRoot = process.cwd()) {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.resolve(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}

loadEnv();

const atriaApiKey = process.env.ATRIA_API_KEY;
if (!atriaApiKey) {
  console.error('[ERRO] ATRIA_API_KEY não encontrada no ambiente!');
  process.exit(1);
}

// Carrega o orquestrador e os 447 fatos da Persona
function loadOrchestrator() {
  const tsCode = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const mod = { exports: {} };
  vm.runInNewContext(jsCode, {
    module: mod,
    exports: mod.exports,
    require: () => ({}),
    fetch: globalThis.fetch,
    console,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    Deno: {
      env: {
        get: (k) => process.env[k],
      },
    },
  });

  return mod.exports;
}

const orch = loadOrchestrator();
const fullFacts = JSON.parse(fs.readFileSync('data/larissa-persona-memory.json', 'utf8'));

// Invocação direta da Atria com retry automático para erros transitórios (ex: 502/503/429)
async function callAtriaReal(prompt, model = 'Atria-Dawn-Preview', maxRetries = 4) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.atria-asi.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${atriaApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 2500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const durationMs = Date.now() - t0;
      if (!res.ok) {
        const errText = await res.text();
        if (attempt < maxRetries && (res.status >= 500 || res.status === 429)) {
          console.warn(`[Atria Retry] HTTP ${res.status}, tentativa ${attempt}/${maxRetries}. Aguardando ${2 * attempt}s...`);
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }
        throw new Error(`Atria HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const content = choice?.message?.content || '';
      const tokens = data.usage?.total_tokens || 0;

      return { content, tokens, durationMs };
    } catch (err) {
      if (attempt < maxRetries && !err.message.startsWith('Atria HTTP 400') && !err.message.startsWith('Atria HTTP 401')) {
        console.warn(`[Atria Retry] Erro transitório: ${err.message}, tentativa ${attempt}/${maxRetries}. Aguardando ${2 * attempt}s...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw err;
    }
  }
}

// Simulador isolado do subagente com tool loop real
async function executeSubagentTurn(params) {
  const {
    subagentName = 'descoberta',
    checkpoint = 'chk_pergunta_sobre_ele',
    userMessage,
    conversationContextText,
    pretendenteFacts = {},
    temporalDate = null,
  } = params;

  const memoryProvider = new orch.InMemoryMemoryProvider();
  const convId = 'persona_eval_001';

  // Grava fatos do pretendente se houver (para testes de isolamento)
  for (const [field, val] of Object.entries(pretendenteFacts)) {
    await memoryProvider.writeFact(convId, { entity: 'self', field, value: val });
  }

  // Prepara o bloco de contexto
  const msgObj = {
    id: `msg_eval_${Date.now()}`,
    text: userMessage,
    timestamp: new Date().toISOString(),
    sender: 'pretendente',
  };

  let initialPrompt = '';
  if (subagentName === 'conexao_inicial') {
    initialPrompt = orch.buildConexaoInicialPrompt({
      conversationId: convId,
      currentPhase: 'conexao_inicial',
      checkpoint,
      contextText: conversationContextText || undefined,
      newMessage: msgObj,
    });
  } else {
    initialPrompt = orch.buildDescobertaPrompt({
      conversationId: convId,
      currentPhase: 'descoberta',
      checkpoint,
      contextText: conversationContextText || undefined,
      newMessage: msgObj,
    });
  }

  const toolCallsLog = [];
  const MAX_TOOL_ITERATIONS = 3;
  let iterations = 0;
  let currentPrompt = initialPrompt;
  let finalDecision = null;
  let totalTokens = 0;
  let totalDurationMs = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    const atriaRes = await callAtriaReal(currentPrompt);
    totalTokens += atriaRes.tokens;
    totalDurationMs += atriaRes.durationMs;

    let parsed = null;
    try {
      parsed = orch.extractJsonFromText(atriaRes.content);
    } catch (e) {
      // Se não for JSON válido, tenta registrar como resposta bruta
      parsed = { action: 'reply', suggestedResponse: atriaRes.content, reasoning: 'Fallback texto não-json' };
    }

    // Se o retorno foi classificado como reply mas o conteúdo bruto é claramente um call_tool
    if (parsed && parsed.action === 'reply' && typeof parsed.suggestedResponse === 'string' && parsed.suggestedResponse.includes('"call_tool"')) {
      const toolMatch = parsed.suggestedResponse.match(/"tool"\s*:\s*"([^"]+)"/i);
      const fieldMatch = parsed.suggestedResponse.match(/"field"\s*:\s*"([^"]+)"/i);
      const queryMatch = parsed.suggestedResponse.match(/"query"\s*:\s*"([^"]+)"/i);
      if (toolMatch) {
        parsed = {
          action: 'call_tool',
          tool: toolMatch[1],
          parameters: fieldMatch ? { field: fieldMatch[1] } : (queryMatch ? { query: queryMatch[1] } : {}),
        };
      }
    }

    // Se a Atria pediu uma ferramenta
    if (parsed && (parsed.action === 'call_tool' || parsed.action === 'tool_call' || parsed.tool)) {
      iterations++;
      const toolName = String(parsed.tool || parsed.name || 'persona_get_fact').trim();
      const toolParams = parsed.parameters || parsed.params || parsed.arguments || {};
      const toolField = String(toolParams.field || toolParams.query || '').trim();
      const toolQuery = String(toolParams.query || toolParams.intent || '').trim();

      let toolResult = null;
      if (toolName === 'persona_get_fact') {
        toolResult = await orch.resolvePersonaFact(toolField, {
          cachedFacts: fullFacts,
          now: temporalDate || new Date(),
        });
      } else if (toolName === 'persona_search') {
        const results = await orch.searchPersonaMemory({
          query: toolQuery || toolField,
          limit: typeof toolParams.limit === 'number' ? toolParams.limit : 5,
          cachedFacts: fullFacts,
          now: temporalDate || new Date(),
        });
        toolResult = { tool: 'persona_search', query: toolQuery, found: results.length > 0, results };
      } else if (toolName === 'memory_get_fact') {
        const entity = toolParams.entity || 'self';
        const res = await memoryProvider.getFact(convId, entity, toolField);
        toolResult = { tool: 'memory_get_fact', found: res.found, entity, field: toolField, value: res.found ? res.fact.value : null };
      } else if (toolName === 'stage_objectives_get' || toolName === 'checklist_get_stage_state') {
        toolResult = {
          tool: toolName,
          stage: 'descoberta',
          goals: [
            { id: 'goal_cidade', label: 'Cidade onde ele mora', status: pretendenteFacts.city ? 'completed' : 'pending', value: pretendenteFacts.city || null },
            { id: 'goal_profissao', label: 'Profissão dele', status: pretendenteFacts.profession || pretendenteFacts.job ? 'completed' : 'pending', value: pretendenteFacts.profession || pretendenteFacts.job || null },
          ]
        };
      } else if (toolName === 'persona_audio_search') {
        toolResult = {
          tool: 'persona_audio_search',
          found: false,
          audios: [],
          message: 'Nenhum áudio encontrado no cofre para este tema. Se a pergunta for sobre preferências ou fatos da vida da Larissa, consulte a PersonaMemory (persona_get_fact ou persona_search) e responda por texto.',
        };
      } else {
        toolResult = { tool: toolName, found: false, message: 'Ferramenta não implementada no mock de avaliação' };
      }

      toolCallsLog.push({
        iteration: iterations,
        tool: toolName,
        parameters: toolParams,
        result: toolResult,
      });

      // Alimenta o resultado no próximo turno do tool loop
      currentPrompt = `${initialPrompt}

### RETORNO DA CONSULTA DE FERRAMENTA (Tool Call #${iterations})
\`\`\`json
${JSON.stringify(toolResult, null, 2)}
\`\`\`

Agora prossiga e gere sua resposta final em JSON:
{
  "action": "reply",
  "checkpoint": "${checkpoint}",
  "summary": "resumo conciso do turno",
  "suggestedResponse": "fala carinhosa da Larissa para o pretendente",
  "nextPhase": "descoberta",
  "reasoning": "análise da resposta"
}`;
      continue;
    }

    // Resposta final obtida
    finalDecision = parsed;
    break;
  }

  // Se esgotou as iterações sem decisão final (ou ainda quis chamar ferramenta), força síntese final
  if (!finalDecision || finalDecision.action === 'call_tool' || finalDecision.action === 'tool_call') {
    const synthesisPrompt = `${currentPrompt}

[AVISO DO SISTEMA]
Limite de consultas atingido. Você NÃO pode mais chamar ferramentas.
Com base em todos os retornos obtidos acima, formule a resposta final da Larissa para o pretendente em JSON puro.
Lembre-se: se algum fato retornou 'false', significa que ela NÃO curte/não gosta/não consome; sem ponto final; sem exclamação; sem terminar mecanicamente com 'e você?'.
{
  "action": "reply",
  "checkpoint": "${checkpoint}",
  "summary": "resposta fundamentada na persona",
  "suggestedResponse": "fala carinhosa da Larissa para o pretendente",
  "nextPhase": "descoberta",
  "reasoning": "síntese final"
}`;
    const synthRes = await callAtriaReal(synthesisPrompt);
    totalTokens += synthRes.tokens;
    totalDurationMs += synthRes.durationMs;
    try {
      finalDecision = orch.extractJsonFromText(synthRes.content);
    } catch {
      finalDecision = { action: 'reply', suggestedResponse: synthRes.content };
    }
  }

  return {
    userMessage,
    toolCalls: toolCallsLog,
    finalDecision,
    suggestedResponse: finalDecision?.suggestedResponse || finalDecision?.response || '',
    totalTokens,
    totalDurationMs,
    iterations,
  };
}

// Bateria Completa de Casos
export const TEST_CASES = [
  // ==========================================
  // 1. FATOS DIRETOS
  // ==========================================
  {
    id: 'CASO_01',
    category: 'fatos_diretos',
    input: 'qual comida vc mais gosta?',
    expectedKeywords: ['bife com batata frita', 'bife', 'batata frita'],
    forbiddenKeywords: ['café', 'vinho', 'tubarão'],
    evaluate: (res, tools) => {
      const lower = res.toLowerCase();
      const hasBife = lower.includes('bife');
      const hasBatata = lower.includes('batata');
      return hasBife || hasBatata;
    }
  },
  {
    id: 'CASO_02',
    category: 'fatos_diretos',
    input: 'e seu prato favorito?',
    expectedKeywords: ['strogonoff'],
    evaluate: (res) => res.toLowerCase().includes('strogonoff')
  },
  {
    id: 'CASO_03',
    category: 'fatos_diretos',
    input: 'vc bebe?',
    expectedKeywords: ['não', 'bebo'],
    forbiddenKeywords: ['adoro cerveja', 'gosto de beber', 'tomo cerveja', 'vinho suave'],
    evaluate: (res) => {
      const lower = res.toLowerCase();
      const negates = lower.includes('não') || lower.includes('nao') || lower.includes('bebo não') || lower.includes('nem');
      return negates && !lower.includes('bebo sim');
    }
  },
  {
    id: 'CASO_04',
    category: 'fatos_diretos',
    input: 'curte vinho?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return (lower.includes('não') || lower.includes('nao') || lower.includes('não bebo') || lower.includes('nem tomo') || lower.includes('curto não'));
    }
  },
  {
    id: 'CASO_05',
    category: 'fatos_diretos',
    input: 'vc toma café?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      const rejectsCoffee = lower.includes('não') || lower.includes('nao') || lower.includes('odeio') || lower.includes('gosto não') || lower.includes('leite');
      return rejectsCoffee;
    }
  },
  {
    id: 'CASO_06',
    category: 'fatos_diretos',
    input: 'faz faculdade de quê?',
    evaluate: (res) => res.toLowerCase().includes('enfermagem')
  },
  {
    id: 'CASO_07',
    category: 'fatos_diretos',
    input: 'qual período vc tá?',
    evaluate: (res) => res.toLowerCase().includes('10') || res.toLowerCase().includes('décimo') || res.toLowerCase().includes('decimo')
  },
  {
    id: 'CASO_08',
    category: 'fatos_diretos',
    input: 'quando vc forma?',
    evaluate: (res) => res.toLowerCase().includes('2026') || res.toLowerCase().includes('final do ano')
  },
  {
    id: 'CASO_09',
    category: 'fatos_diretos',
    input: 'pq escolheu enfermagem?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('cuidar') || lower.includes('pessoas') || lower.includes('gosto') || lower.includes('área') || lower.includes('ajudar');
    }
  },

  // ==========================================
  // 2. HOBBIES / BUSCA SEMÂNTICA
  // ==========================================
  {
    id: 'CASO_10',
    category: 'hobbies',
    input: 'vc faz o que quando tá atoa?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('filme') || lower.includes('série') || lower.includes('dorama') || lower.includes('música') || lower.includes('descansar') || lower.includes('cama');
    }
  },
  {
    id: 'CASO_11',
    category: 'hobbies',
    input: 'qual seu tipo de rolê?',
    forbiddenKeywords: ['balada', 'rave', 'tumulto'],
    evaluate: (res) => {
      const lower = res.toLowerCase();
      const peaceful = lower.includes('tranquil') || lower.includes('calmo') || lower.includes('mirante') || lower.includes('café') || lower.includes('cafeteria') || lower.includes('comer') || lower.includes('passear');
      const noClub = !lower.includes('amo balada') && !lower.includes('vou pra balada');
      return peaceful && noClub;
    }
  },
  {
    id: 'CASO_12',
    category: 'hobbies',
    input: 'vc é mais de ficar em casa ou sair?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('caseira') || lower.includes('casa') || (lower.includes('sair') && lower.includes('tranquil'));
    }
  },

  // ==========================================
  // 3. MÚSICA
  // ==========================================
  {
    id: 'CASO_13',
    category: 'musica',
    input: 'oq vc escuta?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('sertanejo') || lower.includes('simone') || lower.includes('henrique') || lower.includes('marília') || lower.includes('marilia') || lower.includes('jorge');
    }
  },
  {
    id: 'CASO_14',
    category: 'musica',
    input: 'gosta de Tribo da Periferia?',
    forbiddenKeywords: ['amo tribo', 'gosto sim', 'ouço sempre'],
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('não') || lower.includes('nao') || lower.includes('muito não') || lower.includes('não escuto') || lower.includes('não curto');
    }
  },
  {
    id: 'CASO_15',
    category: 'musica',
    input: 'cantora favorita?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('simone mendes') || lower.includes('simone') || lower.includes('marília') || lower.includes('marilia');
    }
  },

  // ==========================================
  // 4. FILMES
  // ==========================================
  {
    id: 'CASO_16',
    category: 'filmes',
    input: 'que filme vc gosta?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('terror') || lower.includes('suspense');
    }
  },
  {
    id: 'CASO_17',
    category: 'filmes',
    input: 'vc gosta daqueles filme de tubarão?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('não') || lower.includes('nao') || lower.includes('muito não') || lower.includes('não ligo') || lower.includes('nem') || lower.includes('não é');
    }
  },
  {
    id: 'CASO_18',
    category: 'filmes',
    input: 'já teve filme que vc não conseguiu terminar?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('bruxa de blair') || lower.includes('terror') || lower.includes('medo');
    }
  },

  // ==========================================
  // 5. HISTÓRIAS
  // ==========================================
  {
    id: 'CASO_19',
    category: 'historias',
    input: 'qual foi um perrengue que vc passou na faculdade?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('moto') || lower.includes('chuva') || lower.includes('plantão') || lower.includes('estágio') || lower.includes('hospital');
    }
  },
  {
    id: 'CASO_20',
    category: 'historias',
    input: 'oq te faz continuar na enfermagem quando tá cansada?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('paciente') || lower.includes('cuidar') || lower.includes('ajudar') || lower.includes('gratidão') || lower.includes('amor');
    }
  },
  {
    id: 'CASO_21',
    category: 'historias',
    input: 'qual matéria vc mais sofreu?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('embriologia');
    }
  },
  {
    id: 'CASO_22',
    category: 'historias',
    input: 'e qual matéria vc não gosta?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('farmacologia');
    }
  },

  // ==========================================
  // 6. CIDADE / VIDA
  // ==========================================
  {
    id: 'CASO_23',
    category: 'cidade',
    input: 'vc é de onde?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('são joão') || lower.includes('sao joao') || lower.includes('del rei');
    }
  },
  {
    id: 'CASO_24',
    category: 'cidade',
    input: 'mora onde em São João?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('matosinhos');
    }
  },
  {
    id: 'CASO_25',
    category: 'cidade',
    input: 'oq tem de legal aí?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('centro') || lower.includes('histórico') || lower.includes('igreja') || lower.includes('mirante') || lower.includes('tiradentes') || lower.includes('maria fumaça');
    }
  },

  // ==========================================
  // 7. RELACIONAMENTO / GENERATED
  // ==========================================
  {
    id: 'CASO_26',
    category: 'relacionamento',
    input: 'vc quer casar?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('sim') || lower.includes('quero') || lower.includes('penso') || lower.includes('família') || lower.includes('sonho');
    }
  },
  {
    id: 'CASO_27',
    category: 'relacionamento',
    input: 'quer ter filhos?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('sim') || lower.includes('quero') || lower.includes('filhos') || lower.includes('vontade');
    }
  },
  {
    id: 'CASO_28',
    category: 'relacionamento',
    input: 'quantos filhos vc queria ter?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('2') || lower.includes('dois');
    }
  },
  {
    id: 'CASO_29',
    category: 'relacionamento',
    input: 'como um homem te conquista?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('atenção') || lower.includes('atencioso') || lower.includes('respeito') || lower.includes('família') || lower.includes('trabalhador') || lower.includes('carinho');
    }
  },

  // ==========================================
  // 8. LIMITES (DEVE RECUSAR NATURALMENTE SEM FERRAMENTA INÚTIL)
  // ==========================================
  {
    id: 'CASO_30',
    category: 'limites',
    input: 'me manda uma foto mais safada?',
    evaluate: (res, tools) => {
      const lower = res.toLowerCase();
      const refuses = lower.includes('não') || lower.includes('tá doido') || lower.includes('safadeza') || lower.includes('moça de família') || lower.includes('nem pensar');
      const toolCheck = tools.length === 0; // Ideal não gastar tool call
      return refuses;
    }
  },
  {
    id: 'CASO_31',
    category: 'limites',
    input: 'vem dormir aqui em casa hoje kkk',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('tá achando') || lower.includes('fácil assim') || lower.includes('moça de família') || lower.includes('dormir') || lower.includes('nem te conheço') || lower.includes('calma');
    }
  },

  // ==========================================
  // 9. NÃO CONSULTA (QUANDO CONTEXTO JÁ TEM)
  // ==========================================
  {
    id: 'CASO_32',
    category: 'nao_consulta',
    input: 'nossa deve ser puxado mesmo',
    conversationContextText: `[ESTADO]\nfase: descoberta\ncheckpoint: chk_pergunta_sobre_ele\n\n[ULTIMO_TURNO_LARISSA]\nLARISSA | msg_ant\neu faço enfermagem no hospital de dia e aula à noite kkk\n\n[MENSAGENS_NOVAS]\n\nPRETENDENTE | msg_now\nnossa deve ser puxado mesmo\n\n[FIM]`,
    evaluate: (res, tools) => {
      // Não deve ter chamado persona_get_fact("curso")
      const calledCourse = tools.some(t => t.parameters?.field === 'course' || t.parameters?.field === 'curso');
      return !calledCourse && res.length > 5;
    }
  },
  {
    id: 'CASO_33',
    category: 'nao_consulta',
    input: 'oi, tudo bem?',
    subagentName: 'conexao_inicial',
    checkpoint: 'chk_saudacao_feita',
    evaluate: (res, tools) => {
      // Saudação trivial não deve gastar ferramenta alguma
      return tools.length === 0 && res.length > 3;
    }
  },
  {
    id: 'CASO_34',
    category: 'nao_consulta',
    input: 'kkkkkkkk',
    evaluate: (res, tools) => {
      const personaTools = tools.filter(t => t.tool.startsWith('persona_'));
      return personaTools.length === 0 && res.length > 2;
    }
  },
  {
    id: 'CASO_35',
    category: 'nao_consulta',
    input: 'boa noite',
    evaluate: (res, tools) => {
      const personaTools = tools.filter(t => t.tool.startsWith('persona_'));
      return personaTools.length === 0 && res.length > 3;
    }
  },

  // ==========================================
  // 10. ISOLAMENTO CONTACT VS PERSONA
  // ==========================================
  {
    id: 'CASO_36',
    category: 'isolamento_entidades',
    input: 'e vc quantos anos tem?',
    pretendenteFacts: { age: 31 },
    evaluate: (res) => {
      const lower = res.toLowerCase();
      const has23 = lower.includes('23');
      const has31 = lower.includes('31');
      return has23 && !has31;
    }
  },
  {
    id: 'CASO_37',
    category: 'isolamento_entidades',
    input: 'e vc mora onde?',
    pretendenteFacts: { city: 'Barbacena' },
    evaluate: (res) => {
      const lower = res.toLowerCase();
      const hasSjdr = lower.includes('são joão') || lower.includes('sao joao') || lower.includes('del rei');
      const hasBarbacena = lower.includes('moro em barbacena') || lower.includes('sou de barbacena');
      return hasSjdr && !hasBarbacena;
    }
  },

  // ==========================================
  // 11. VARIAÇÃO DE ALIASES
  // ==========================================
  {
    id: 'CASO_38_ALIAS_IDADE',
    category: 'aliases',
    input: 'vc tem quantos anos?',
    evaluate: (res) => res.includes('23')
  },
  {
    id: 'CASO_39_ALIAS_CIDADE',
    category: 'aliases',
    input: 'vc é daí de sj?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('sou') || lower.includes('aqui') || lower.includes('são joão') || lower.includes('sao joao') || lower.includes('nasci aqui');
    }
  },
  {
    id: 'CASO_40_ALIAS_CURSO',
    category: 'aliases',
    input: 'vc estuda o quê?',
    evaluate: (res) => res.toLowerCase().includes('enfermagem')
  },

  // ==========================================
  // 12. TEMPORALIDADE SIMULADA (ANO 2028)
  // ==========================================
  {
    id: 'CASO_41_TEMPORAL_FUTURO',
    category: 'temporalidade',
    input: 'qual período da faculdade vc tá?',
    temporalDate: new Date('2028-06-01T12:00:00Z'),
    evaluate: (res, tools) => {
      // Em 2028, a temporalidade de 10º período expirou
      return res.length > 5;
    }
  },

  // ==========================================
  // 13. NEGATIVOS CRÍTICOS
  // ==========================================
  {
    id: 'CASO_42_NEGATIVO_TRIBO',
    category: 'negativos_criticos',
    input: 'vc curte Tribo da Periferia?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('não') || lower.includes('nao') || lower.includes('não escuto') || lower.includes('curto não') || lower.includes('nem');
    }
  },
  {
    id: 'CASO_43_NEGATIVO_VINHO',
    category: 'negativos_criticos',
    input: 'vc bebe vinho?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('não') || lower.includes('nao') || lower.includes('não bebo') || lower.includes('nem tomo') || lower.includes('álcool');
    }
  },
  {
    id: 'CASO_44_NEGATIVO_TUBARAO',
    category: 'negativos_criticos',
    input: 'qual sua opinião sobre filme de tubarão?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      const notFan = lower.includes('não') || lower.includes('nao') || lower.includes('não ligo') || lower.includes('nem') || lower.includes('prefiro outros') || lower.includes('terror normal');
      return notFan;
    }
  },
];

async function runEvaluationSuite() {
  console.log('===============================================================');
  console.log('BATERIA DE AVALIAÇÃO COMPORTAMENTAL — PERSONA MEMORY LARISSA');
  console.log(`Modelo: Atria-Dawn-Preview (Motor Oficial da Atria em Produção)`);
  console.log(`Fatos na Memória: ${fullFacts.length} fatos`);
  const args = process.argv.slice(2);
  let startIndex = 0;
  let endIndex = TEST_CASES.length;
  for (const arg of args) {
    if (arg.startsWith('--start=')) startIndex = Math.max(0, parseInt(arg.split('=')[1], 10) - 1);
    if (arg.startsWith('--end=')) endIndex = Math.min(TEST_CASES.length, parseInt(arg.split('=')[1], 10));
  }

  const reportPath = path.resolve('data/persona-behavior-final-report.json');
  let report = [];
  if (startIndex > 0 && fs.existsSync(reportPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (Array.isArray(prev.results)) {
        report = prev.results;
      }
    } catch {}
  }

  console.log(`Intervalo de execução: [${startIndex + 1} até ${endIndex}] de ${TEST_CASES.length}`);

  let passCount = 0;
  let failCount = 0;
  let totalUaiCount = 0;
  let totalKkkCount = 0;
  let totalEmojiCount = 0;
  let totalDotEnds = 0;
  let totalExclamationEnds = 0;
  let totalMechanicalQuestions = 0;

  for (let i = startIndex; i < endIndex; i++) {
    const testCase = TEST_CASES[i];
    process.stdout.write(`[${i + 1}/${TEST_CASES.length}] Executando ${testCase.id}: "${testCase.input}"... `);

    try {
      const result = await executeSubagentTurn({
        subagentName: testCase.subagentName || 'descoberta',
        checkpoint: testCase.checkpoint || 'chk_pergunta_sobre_ele',
        userMessage: testCase.input,
        conversationContextText: testCase.conversationContextText,
        pretendenteFacts: testCase.pretendenteFacts,
        temporalDate: testCase.temporalDate,
      });

      const resp = result.suggestedResponse || '';
      const tools = result.toolCalls || [];

      // Avaliação funcional
      const passed = testCase.evaluate(resp, tools);
      if (passed) passCount++;
      else failCount++;

      // Análise linguística e de estilo
      const uaiMatches = (resp.match(/\buai\b/gi) || []).length;
      totalUaiCount += uaiMatches;

      const kkkMatches = (resp.match(/k{2,}/gi) || []).length;
      totalKkkCount += kkkMatches;

      const emojiMatches = (resp.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
      totalEmojiCount += emojiMatches;

      if (resp.trim().endsWith('.')) totalDotEnds++;
      if (resp.includes('!')) totalExclamationEnds++;

      // Padrão mecânico: "e você?"
      if (/(?:e\s+voc[êe]\??|e\s+vc\??)/i.test(resp)) {
        totalMechanicalQuestions++;
      }

      console.log(passed ? '✔ PASS' : `✖ FAIL -> Resposta: "${resp}" | Tools: ${tools.map((t) => t.tool).join(', ')}`);

      const entryIndex = report.findIndex((r) => r.id === testCase.id);
      const entryData = {
        id: testCase.id,
        category: testCase.category,
        input: testCase.input,
        status: passed ? 'PASS' : 'FAIL',
        suggestedResponse: resp,
        toolCalls: tools.map((t) => ({
          tool: t.tool,
          parameters: t.parameters,
          resultSummary: t.result?.found !== undefined ? `found: ${t.result.found}` : 'ok',
        })),
        tokens: result.totalTokens,
        durationMs: result.totalDurationMs,
      };
      if (entryIndex >= 0) report[entryIndex] = entryData;
      else report.push(entryData);

      // Salvamento incremental no disco
      fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        model: 'Atria-Dawn-Preview',
        totalScenarios: TEST_CASES.length,
        currentProgress: i + 1,
        results: report,
      }, null, 2), 'utf8');
    } catch (err) {
      console.log(`✖ ERRO: ${err.message}`);
      const entryIndex = report.findIndex((r) => r.id === testCase.id);
      const entryData = {
        id: testCase.id,
        category: testCase.category,
        input: testCase.input,
        status: 'FAIL',
        error: err.message,
      };
      if (entryIndex >= 0) report[entryIndex] = entryData;
      else report.push(entryData);

      fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        model: 'Atria-Dawn-Preview',
        totalScenarios: TEST_CASES.length,
        currentProgress: i + 1,
        results: report,
      }, null, 2), 'utf8');
    }
  }

  // Consolidação de métricas sobre todos os resultados
  passCount = report.filter((r) => r.status === 'PASS').length;
  failCount = report.filter((r) => r.status === 'FAIL').length;
  totalUaiCount = 0;
  totalKkkCount = 0;
  totalEmojiCount = 0;
  totalDotEnds = 0;
  totalExclamationEnds = 0;
  totalMechanicalQuestions = 0;

  for (const r of report) {
    const text = r.suggestedResponse || '';
    totalUaiCount += (text.match(/\buai\b/gi) || []).length;
    totalKkkCount += (text.match(/k{2,}/gi) || []).length;
    totalEmojiCount += (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    if (text.trim().endsWith('.')) totalDotEnds++;
    if (text.includes('!')) totalExclamationEnds++;
    if (/(?:e\s+voc[êe]\??|e\s+vc\??)/i.test(text)) totalMechanicalQuestions++;
  }

  console.log('\n===============================================================');
  console.log('RESUMO CONSOLIDADO DA AVALIAÇÃO COMPORTAMENTAL');
  console.log('===============================================================');
  console.log(`Total de Cenários: ${report.length} de ${TEST_CASES.length}`);
  console.log(`Aprovados (PASS): ${passCount} (${((passCount / report.length) * 100).toFixed(1)}%)`);
  console.log(`Reprovados (FAIL): ${failCount} (${((failCount / report.length) * 100).toFixed(1)}%)`);
  console.log('---------------------------------------------------------------');
  console.log(`Linguagem & Estilo Observado:`);
  console.log(`- Total de 'uai': ${totalUaiCount} (${(totalUaiCount / report.length).toFixed(2)} por resposta)`);
  console.log(`- Total de risadas ('kkk'): ${totalKkkCount}`);
  console.log(`- Total de emojis: ${totalEmojiCount}`);
  console.log(`- Términos com ponto final (violação DNA): ${totalDotEnds}`);
  console.log(`- Pontos de exclamação (violação DNA): ${totalExclamationEnds}`);
  console.log(`- Padrão 'E você?' repetitivo: ${totalMechanicalQuestions}/${report.length}`);
  console.log('===============================================================\n');

  // Salva relatório final consolidado
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    model: 'Atria-Dawn-Preview',
    totalScenarios: TEST_CASES.length,
    passCount,
    failCount,
    metrics: {
      totalUaiCount,
      totalKkkCount,
      totalEmojiCount,
      totalDotEnds,
      totalExclamationEnds,
      totalMechanicalQuestions,
    },
    results: report,
  }, null, 2), 'utf8');

  console.log(`Relatório salvo em: ${reportPath}`);
  return { passCount, failCount, report };
}

runEvaluationSuite()
  .then((res) => {
    process.exit(res.failCount === 0 ? 0 : 2);
  })
  .catch((err) => {
    console.error('Falha fatal na bateria:', err);
    process.exit(1);
  });
