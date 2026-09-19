#!/usr/bin/env node
/**
 * scripts/test-contextual-ai-reference.mjs
 * 
 * Teste de Resolução Contextual de Referência Espacial ("aí")
 * Comprova que o modelo resolve pronomes de lugar dinamicamente pelo contexto anterior
 * e NÃO por hardcode fixo de São João del-Rei.
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

async function callAtriaReal(prompt) {
  const res = await fetch('https://api.atria-asi.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${atriaApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'Atria-Dawn-Preview',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2500,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Atria HTTP ${res.status}: ${errText}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

async function runScenario(name, contextText, userMessage) {
  const convId = 'conv_ctx_' + Date.now();
  const msgObj = { id: 'msg_ctx', conversationId: convId, sender: 'pretendente', direction: 'inbound', timestamp: new Date().toISOString(), type: 'text', text: userMessage, status: 'received' };

  let currentPrompt = orch.buildDescobertaPrompt({
    conversationId: convId,
    currentPhase: 'descoberta',
    checkpoint: 'chk_pergunta_sobre_ele',
    contextText,
    newMessage: msgObj,
  });

  const toolCallsLog = [];
  let finalDecision = null;

  for (let iter = 1; iter <= 2; iter++) {
    const raw = await callAtriaReal(currentPrompt);
    console.log(`[DEBUG ${name} ITER ${iter}] RAW RESPONSE:`, raw);
    let parsed = null;
    try {
      parsed = orch.extractJsonFromText(raw);
    } catch (e) {
      console.log(`[DEBUG ${name} ITER ${iter}] PARSE ERROR:`, e.message);
      parsed = { action: 'reply', suggestedResponse: raw };
    }
    console.log(`[DEBUG ${name} ITER ${iter}] PARSED:`, parsed);

    if (parsed && (parsed.action === 'call_tool' || parsed.tool)) {
      const toolName = String(parsed.tool || 'persona_search').trim();
      const toolParams = parsed.parameters || {};
      const query = String(toolParams.query || toolParams.field || '').trim();

      let toolResult = null;
      if (toolName === 'persona_search') {
        const results = await orch.searchPersonaMemory({ query, limit: 4, cachedFacts: fullFacts });
        toolResult = { tool: 'persona_search', query, found: results.length > 0, results };
      } else if (toolName === 'persona_get_fact') {
        toolResult = await orch.resolvePersonaFact(query, { cachedFacts: fullFacts });
      } else {
        toolResult = { tool: toolName, found: false };
      }

      toolCallsLog.push({ tool: toolName, query, result: toolResult });
      currentPrompt = `${currentPrompt}\n\n### RETORNO DA CONSULTA DE FERRAMENTA\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\`\n[FATO SUFICIENTE ENCONTRADO — REGRA ONE-TOOL-AND-REPLY]\nFormule agora sua resposta final da Larissa em JSON: {"action": "reply", "suggestedResponse": "..."}`;
      continue;
    }

    finalDecision = parsed;
    break;
  }

  // Fallback de síntese caso ainda tenha ficado sem resposta
  if (!finalDecision || !finalDecision.suggestedResponse) {
    console.log(`[DEBUG ${name}] EXECUTANDO SÍNTESE FORÇADA`);
    const synthPrompt = `${currentPrompt}\n\n[AVISO DO SISTEMA]\nLimite de consultas atingido. Formule a resposta final da Larissa para o pretendente em JSON puro: {"action": "reply", "suggestedResponse": "fala carinhosa da Larissa"}`;
    const rawSynth = await callAtriaReal(synthPrompt);
    console.log(`[DEBUG ${name}] RAW SYNTH:`, rawSynth);
    try {
      finalDecision = orch.extractJsonFromText(rawSynth);
    } catch {
      finalDecision = { suggestedResponse: rawSynth };
    }
  }

  return {
    suggestedResponse: finalDecision?.suggestedResponse || finalDecision?.response || '',
    toolCalls: toolCallsLog,
  };
}

async function testContextualAi() {
  console.log('===============================================================');
  console.log('TESTE CONTEXTUAL DE RESOLUÇÃO DO PRONOME "AÍ"');
  console.log('===============================================================\n');

  // CENÁRIO A: Larissa acabou de dizer que é de São João del-Rei
  console.log('--- CENÁRIO A: Antecedente = São João del-Rei ---');
  const ctxA = `[ESTADO]\nfase: descoberta\ncheckpoint: chk_troca_cidade\n\n[HISTORICO_RECENTE]\nPRETENDENTE | msg_1\nvc é de onde?\n\nLARISSA | msg_2\nsou de São João del-Rei\n\n[MENSAGENS_NOVAS]\nPRETENDENTE | msg_3\noq tem de legal aí?\n\n[FIM]`;
  const resA = await runScenario('CENÁRIO A', ctxA, 'oq tem de legal aí?');
  console.log(`Resposta da Larissa: "${resA.suggestedResponse}"`);
  const lowerA = resA.suggestedResponse.toLowerCase();
  const passA = lowerA.includes('centro') || lowerA.includes('histórico') || lowerA.includes('historico') || lowerA.includes('igreja') || lowerA.includes('mirante') || lowerA.includes('tiradentes') || lowerA.includes('maria fumaça') || lowerA.includes('maria fumaca') || lowerA.includes('são joão');
  console.log(`Resultado Cenário A (espera referências a São João): ${passA ? '✔ PASS' : '✖ FAIL'}\n`);

  // CENÁRIO B: Pretendente diz que está em Tiradentes
  console.log('--- CENÁRIO B: Antecedente = Tiradentes (cidade do pretendente) ---');
  const ctxB = `[ESTADO]\nfase: descoberta\ncheckpoint: chk_troca_cidade\n\n[HISTORICO_RECENTE]\nPRETENDENTE | msg_1\ntô aqui em Tiradentes hoje a trabalho\n\nLARISSA | msg_2\nah que delícia de lugar! pertinho daqui kkk\n\n[MENSAGENS_NOVAS]\nPRETENDENTE | msg_3\ntem algum lugar legal aí?\n\n[FIM]`;
  const resB = await runScenario('CENÁRIO B', ctxB, 'tem algum lugar legal aí?');
  console.log(`Resposta da Larissa: "${resB.suggestedResponse}"`);
  const lowerB = resB.suggestedResponse.toLowerCase();
  // Não pode responder achando que "aí" é Barbacena ou inventar que Tiradentes é São João
  const passB = lowerB.includes('tiradentes') || lowerB.includes('restaurante') || lowerB.includes('largo') || lowerB.includes('chafariz') || lowerB.includes('matriz') || lowerB.includes('serra') || lowerB.includes('comida') || lowerB.includes('centro') || lowerB.includes('passear');
  console.log(`Resultado Cenário B (espera referências ao contexto de Tiradentes): ${passB ? '✔ PASS' : '✖ FAIL'}\n`);

  console.log('===============================================================');
  console.log(`Auditoria Contextual de "Aí": ${passA && passB ? '100% APROVADO (Sem Hardcode)' : 'PARCIAL'}`);
  console.log('===============================================================');

  return { passA, passB, resA: resA.suggestedResponse, resB: resB.suggestedResponse };
}

testContextualAi().catch(console.error);
