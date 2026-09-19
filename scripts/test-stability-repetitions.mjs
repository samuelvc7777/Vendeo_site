#!/usr/bin/env node
/**
 * scripts/test-stability-repetitions.mjs
 * 
 * Bateria de Repetição de Estabilidade (3x por caso) com Atria-Dawn-Preview Real.
 * Avalia os 3 casos FAIL atuais + 9 casos críticos recomendados pelo usuário.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

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
            if (!process.env[key]) process.env[key] = val;
          }
        }
      } catch {}
    }
  }
}

loadEnv();

const atriaApiKey = process.env.ATRIA_API_KEY;
if (!atriaApiKey) {
  console.error('[ERRO] ATRIA_API_KEY não encontrada!');
  process.exit(1);
}

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
    Deno: { env: { get: (k) => process.env[k] } },
  });

  return mod.exports;
}

const orch = loadOrchestrator();
const fullFacts = JSON.parse(fs.readFileSync('data/larissa-persona-memory.json', 'utf8'));

async function callAtriaReal(prompt, model = 'Atria-Dawn-Preview', maxRetries = 4) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const res = await fetch('https://api.atria-asi.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${atriaApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2500,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content || '';
        return { content };
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2500 * attempt));
        continue;
      }
      throw new Error(`Atria API error HTTP ${res.status}`);
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function executeSingleTurn(params) {
  const { subagentName, checkpoint, userMessage, conversationContextText, pretendenteFacts, temporalDate } = params;
  const convId = 'conv_stab_' + Date.now();
  const msgObj = { id: 'msg_stab', conversationId: convId, sender: 'pretendente', direction: 'inbound', timestamp: new Date().toISOString(), type: 'text', text: userMessage, status: 'received' };

  let initialPrompt = '';
  if (subagentName === 'conexao_inicial') {
    initialPrompt = orch.buildConexaoInicialPrompt({ conversationId: convId, currentPhase: 'conexao_inicial', checkpoint, contextText: conversationContextText || undefined, newMessage: msgObj });
  } else {
    initialPrompt = orch.buildDescobertaPrompt({ conversationId: convId, currentPhase: 'descoberta', checkpoint, contextText: conversationContextText || undefined, newMessage: msgObj });
  }

  const toolCallsLog = [];
  let iterations = 0;
  let currentPrompt = initialPrompt;
  let finalDecision = null;

  while (iterations < 3) {
    const atriaRes = await callAtriaReal(currentPrompt);
    let parsed = null;
    try {
      parsed = orch.extractJsonFromText(atriaRes.content);
    } catch {
      parsed = { action: 'reply', suggestedResponse: atriaRes.content };
    }

    if (parsed && parsed.action === 'reply' && typeof parsed.suggestedResponse === 'string' && parsed.suggestedResponse.includes('"call_tool"')) {
      const toolMatch = parsed.suggestedResponse.match(/"tool"\s*:\s*"([^"]+)"/i);
      const fieldMatch = parsed.suggestedResponse.match(/"field"\s*:\s*"([^"]+)"/i);
      const queryMatch = parsed.suggestedResponse.match(/"query"\s*:\s*"([^"]+)"/i);
      if (toolMatch) {
        parsed = { action: 'call_tool', tool: toolMatch[1], parameters: fieldMatch ? { field: fieldMatch[1] } : (queryMatch ? { query: queryMatch[1] } : {}) };
      }
    }

    if (parsed && (parsed.action === 'call_tool' || parsed.action === 'tool_call' || parsed.tool)) {
      iterations++;
      const toolName = String(parsed.tool || parsed.name || 'persona_get_fact').trim();
      const toolParams = parsed.parameters || parsed.params || {};
      const toolField = String(toolParams.field || toolParams.query || '').trim();
      const toolQuery = String(toolParams.query || toolParams.intent || '').trim();

      let toolResult = null;
      if (toolName === 'persona_get_fact') {
        toolResult = await orch.resolvePersonaFact(toolField, { cachedFacts: fullFacts, now: temporalDate || new Date() });
      } else if (toolName === 'persona_search') {
        const results = await orch.searchPersonaMemory({ query: toolQuery || toolField, limit: 5, cachedFacts: fullFacts, now: temporalDate || new Date() });
        toolResult = { tool: 'persona_search', query: toolQuery, found: results.length > 0, results };
      } else if (toolName === 'memory_get_fact') {
        const entity = toolParams.entity || 'self';
        const val = pretendenteFacts ? (pretendenteFacts[toolField] || null) : null;
        toolResult = { tool: 'memory_get_fact', found: val !== null, entity, field: toolField, value: val };
      } else {
        toolResult = { tool: toolName, found: false, message: 'Mock ferramenta' };
      }

      toolCallsLog.push({ tool: toolName, parameters: toolParams, result: toolResult });
      currentPrompt = `${initialPrompt}\n\n### RETORNO DA CONSULTA DE FERRAMENTA (Tool Call #${iterations})\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\`\n[FATO SUFICIENTE ENCONTRADO — REGRA ONE-TOOL-AND-REPLY]\nNÃO chame mais ferramentas. Formule agora a resposta carinhosa e natural da Larissa em JSON com action: "reply":\n{\n  "action": "reply",\n  "checkpoint": "${checkpoint}",\n  "summary": "resposta fundamentada na persona",\n  "suggestedResponse": "fala carinhosa da Larissa para o pretendente",\n  "nextPhase": "descoberta",\n  "reasoning": "análise"\n}`;
      continue;
    }

    finalDecision = parsed;
    break;
  }

  if (!finalDecision || finalDecision.action === 'call_tool' || finalDecision.action === 'tool_call' || !finalDecision.suggestedResponse) {
    const synthPrompt = `${currentPrompt}\n\n[AVISO DO SISTEMA]\nLimite de consultas atingido. Você NÃO pode mais chamar ferramentas.\nCom base em todos os retornos obtidos acima, formule a resposta final da Larissa para o pretendente em JSON puro.\n{\n  "action": "reply",\n  "checkpoint": "${checkpoint}",\n  "summary": "resposta fundamentada na persona",\n  "suggestedResponse": "fala carinhosa da Larissa para o pretendente",\n  "nextPhase": "descoberta",\n  "reasoning": "síntese final"\n}`;
    const rawSynth = await callAtriaReal(synthPrompt);
    try {
      finalDecision = orch.extractJsonFromText(rawSynth.content);
    } catch {
      finalDecision = { suggestedResponse: rawSynth.content };
    }
  }

  return {
    suggestedResponse: finalDecision?.suggestedResponse || finalDecision?.response || '',
    toolCalls: toolCallsLog,
  };
}

// 12 Casos a Testar (3x cada)
const CASES_TO_TEST = [
  // --- Os 3 FAILS da rodada final ---
  {
    id: 'CASO_14',
    name: 'Gosto por Tribo da Periferia (FAIL atual)',
    input: 'gosta de Tribo da Periferia?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('não') || lower.includes('nao') || lower.includes('muito não') || lower.includes('não escuto') || lower.includes('não curto') || lower.includes('nem ouço');
    },
  },
  {
    id: 'CASO_25',
    name: 'O que tem de legal em São João (FAIL atual)',
    input: 'oq tem de legal aí?',
    conversationContextText: `[ESTADO]\nfase: descoberta\ncheckpoint: chk_troca_cidade\n\n[HISTORICO_RECENTE]\nPRETENDENTE | msg_1\nvc é de onde?\n\nLARISSA | msg_2\nsou de São João del-Rei kkk\n\n[MENSAGENS_NOVAS]\nPRETENDENTE | msg_3\noq tem de legal aí?\n\n[FIM]`,
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('centro') || lower.includes('histórico') || lower.includes('igreja') || lower.includes('mirante') || lower.includes('tiradentes') || lower.includes('maria fumaça') || lower.includes('passear');
    },
  },
  {
    id: 'CASO_44_NEGATIVO_TUBARAO',
    name: 'Opinião filme de tubarão (FAIL atual)',
    input: 'qual sua opinião sobre filme de tubarão?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      const rejects = lower.includes('não') || lower.includes('nao') || lower.includes('muito não') || lower.includes('não curto') || lower.includes('não é') || lower.includes('terror') || lower.includes('suspense psicológico') || lower.includes('prefiro');
      const noLike = !lower.includes('adoro filme de tubarão') && !lower.includes('acho legal tubarão');
      return rejects && noLike;
    },
  },

  // --- Os 9 Casos Críticos Resolvidos ---
  {
    id: 'CASO_07',
    name: 'Período acadêmico de enfermagem',
    input: 'qual período vc tá?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return (lower.includes('10') || lower.includes('décimo') || lower.includes('decimo')) && !lower.includes('noturno') && !lower.includes('noite');
    },
  },
  {
    id: 'CASO_24',
    name: 'Bairro em São João del-Rei',
    input: 'mora onde em São João?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('matosinhos');
    },
  },
  {
    id: 'CASO_21',
    name: 'Matéria mais difícil / que sofreu',
    input: 'qual matéria vc mais sofreu?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('embriologia');
    },
  },
  {
    id: 'CASO_22',
    name: 'Matéria que não gosta',
    input: 'e qual matéria vc não gosta?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('farmacologia');
    },
  },
  {
    id: 'CASO_03',
    name: 'Bebida alcoólica',
    input: 'vc bebe?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return (lower.includes('não') || lower.includes('nao')) && !lower.includes('cerveja') && !lower.includes('vinho');
    },
  },
  {
    id: 'CASO_42_NEGATIVO_TRIBO',
    name: 'Tribo da Periferia (Formulação direta)',
    input: 'vc curte Tribo da Periferia?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('não') || lower.includes('nao') || lower.includes('muito não') || lower.includes('sertanejo');
    },
  },
  {
    id: 'CASO_17',
    name: 'Filme de tubarão (Formulação direta)',
    input: 'vc gosta daqueles filme de tubarão?',
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('não') || lower.includes('nao') || lower.includes('muito não') || lower.includes('não é');
    },
  },
  {
    id: 'CASO_33',
    name: 'Saudação sem ferramentas',
    input: 'oi, tudo bem?',
    subagentName: 'conexao_inicial',
    checkpoint: 'chk_saudacao_feita',
    evaluate: (res, tools) => {
      return tools.length === 0 && res.length > 3;
    },
  },
  {
    id: 'CASO_36',
    name: 'Isolamento idade pretendente vs Larissa',
    input: 'e vc quantos anos tem?',
    pretendenteFacts: { age: 38 },
    evaluate: (res) => {
      const lower = res.toLowerCase();
      return lower.includes('23') && !lower.includes('38');
    },
  },
];

async function runStabilityBattery() {
  console.log('===============================================================');
  console.log('BATERIA DE REPETIÇÃO DE ESTABILIDADE (3x por caso)');
  console.log('Casos a testar: 12 (3 FAIL + 9 Críticos)');
  console.log('Total de invocações: 36 execuções reais com Atria-Dawn-Preview');
  console.log('===============================================================\n');

  const args = process.argv.slice(2);
  const targetCaseArg = args.find((a) => a.startsWith('--case='));
  const targetCaseId = targetCaseArg ? targetCaseArg.split('=')[1] : null;

  const reportPath = path.resolve('data/persona-stability-audit-report.json');
  let summaryResults = [];
  if (fs.existsSync(reportPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (Array.isArray(prev.results)) summaryResults = prev.results;
    } catch {}
  }

  const casesToRun = targetCaseId ? CASES_TO_TEST.filter((c) => c.id === targetCaseId) : CASES_TO_TEST;

  for (let cIdx = 0; cIdx < casesToRun.length; cIdx++) {
    const c = casesToRun[cIdx];
    console.log(`[${cIdx + 1}/${casesToRun.length}] Testando ${c.id} (${c.name}): "${c.input}"`);

    const attempts = [];
    for (let rep = 1; rep <= 3; rep++) {
      process.stdout.write(`   Repetição #${rep}... `);
      try {
        const out = await executeSingleTurn({
          subagentName: c.subagentName || 'descoberta',
          checkpoint: c.checkpoint || 'chk_pergunta_sobre_ele',
          userMessage: c.input,
          pretendenteFacts: c.pretendenteFacts,
        });

        const pass = c.evaluate(out.suggestedResponse, out.toolCalls);
        const toolsUsed = out.toolCalls.map((t) => t.tool).join(', ') || 'nenhuma';
        console.log(pass ? `✔ PASS` : `✖ FAIL`, `(tools: ${toolsUsed}) -> "${out.suggestedResponse}"`);
        attempts.push({
          rep,
          status: pass ? 'PASS' : 'FAIL',
          response: out.suggestedResponse,
          tools: toolsUsed,
        });
      } catch (err) {
        console.log(`✖ ERRO: ${err.message}`);
        attempts.push({ rep, status: 'ERROR', error: err.message });
      }
    }

    const passCount = attempts.filter((a) => a.status === 'PASS').length;
    console.log(`   -> Resultado consolidado: ${passCount}/3 PASS\n`);

    const existingIndex = summaryResults.findIndex((r) => r.id === c.id);
    const newEntry = {
      id: c.id,
      name: c.name,
      input: c.input,
      passCount,
      attempts,
    };
    if (existingIndex >= 0) summaryResults[existingIndex] = newEntry;
    else summaryResults.push(newEntry);
  }

  // Grava relatório de estabilidade
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalCases: CASES_TO_TEST.length,
    repetitionsPerCase: 3,
    results: summaryResults,
  }, null, 2), 'utf8');

  console.log(`\nRelatório de estabilidade salvo em: ${reportPath}`);
}

runStabilityBattery().catch(console.error);
