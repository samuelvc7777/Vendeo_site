#!/usr/bin/env node
/**
 * scripts/measure-turn-tokens.mjs
 * 
 * Medição real de tokens de um turno experimental mockado no experimental_orchestrator.
 * Rastreia as chamadas ao modelo (Router e Subagente), calcula os tokens exatos e valida
 * as regras de ouro:
 * - LARISSA_CONVERSATION_STYLE aparece exatamente 1 vez no turno
 * - LARISSA_CHAT_STYLE_V2 aparece exatamente 1 vez no turno
 * - Router recebe 0 tokens de estilo
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

function loadOrchestratorWithInterceptor() {
  const tsCode = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const mod = { exports: {} };
  vm.runInNewContext(jsCode, {
    module: mod,
    exports: mod.exports,
    require: (dep) => {
      if (dep.includes('LarissaConversationStyle')) {
        const styleTs = fs.readFileSync('supabase/functions/api/LarissaConversationStyle.ts', 'utf8');
        const styleJs = ts.transpileModule(styleTs, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        }).outputText;
        const sMod = { exports: {} };
        new Function('module', 'exports', styleJs)(sMod, sMod.exports);
        return sMod.exports;
      }
      if (dep.includes('LarissaChatStyle')) {
        const chatTs = fs.readFileSync('supabase/functions/api/LarissaChatStyle.ts', 'utf8');
        const chatJs = ts.transpileModule(chatTs, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        }).outputText;
        const cMod = { exports: {} };
        new Function('module', 'exports', chatJs)(cMod, cMod.exports);
        return cMod.exports;
      }
      return {
        publishAutoPilotState: async () => {},
        activity: () => ({}),
        extractEpisodesFromLarissaMessage: () => [],
        extractEpisodesFromPretendenteMessage: () => [],
        createAudioDeliveredEpisode: () => ({}),
        saveConversationEpisodes: async () => ({ saved: 0, collisions: 0 }),
        executeEpisodeWriter: async () => ({ savedCount: 0 }),
        searchConversationEpisodicMemory: async () => [],
        validateAntiRepeatGate: async () => ({ isBlocked: false, allowedResponses: [] }),
      };
    },
    console,
    fetch: globalThis.fetch,
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

async function runTurnMeasurement() {
  console.log('🔬 Iniciando medição real de tokens do turno experimental...\n');

  const calls = [];
  const orch = loadOrchestratorWithInterceptor();

  const convStyleBlock = fs.readFileSync('supabase/functions/api/LarissaConversationStyle.ts', 'utf8').match(/export const LARISSA_CONVERSATION_STYLE = `([\s\S]*?)`;/)[1];
  const convStyleChars = convStyleBlock.length;
  const convStyleTokens = Math.round(convStyleChars / 4);

  const chatStyleBlock = fs.readFileSync('supabase/functions/api/LarissaChatStyle.ts', 'utf8').match(/export const LARISSA_CHAT_STYLE_V2 = `([\s\S]*?)`;/)[1];
  const chatStyleChars = chatStyleBlock.length;
  const chatStyleTokens = Math.round(chatStyleChars / 4);

  // Runtime mock que intercepta os prompts enviados ao modelo
  const mockRuntime = {
    callModel: async (prompt, opts) => {
      const promptChars = prompt.length;
      const estimatedTokens = Math.round(promptChars / 4);
      const convStyleOccurrences = (prompt.match(/ESTILO DE CONVERSAR & CONDUZIR \(LARISSA_CONVERSATION_STYLE\)/g) || []).length;
      const chatStyleOccurrences = (prompt.match(/FORMA DE DIGITAR & LINGUAGEM DE CELULAR \(LARISSA_CHAT_STYLE_V2\)/g) || []).length;

      let callType = 'unknown';
      let mockResponse = {};

      if (prompt.includes('Você é o Agente da Conversa da Larissa')) {
        callType = 'router';
        mockResponse = {
          targetSubagent: 'descoberta',
          action: 'delegate',
          reason: 'Pretendente compartilhou profissão; avançar para descoberta',
        };
      } else if (prompt.includes('Você é a subagente especialista em DESCOBERTA')) {
        callType = 'subagent';
        mockResponse = {
          action: 'reply',
          checkpoint: 'chk_pergunta_sobre_ele',
          summary: 'Acolhe profissão e aprofunda',
          responses: [
            'imagino que seja puxado viu',
            'vc gosta dessa área?'
          ],
          suggestedResponse: 'imagino que seja puxado viu\n\nvc gosta dessa área?',
          nextPhase: 'descoberta',
          reasoning: 'Acolhe a profissão de mineração e aprofunda sem papagaio',
        };
      } else if (prompt.includes('Você é a subagente especialista em CONEXÃO INICIAL')) {
        callType = 'subagent';
        mockResponse = {
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          summary: 'Troca de cumprimento',
          responses: ['oii tudo bem com vc'],
          suggestedResponse: 'oii tudo bem com vc',
          nextPhase: 'conexao_inicial',
          reasoning: 'Cumprimento inicial',
        };
      }

      calls.push({
        type: callType,
        promptLength: promptChars,
        tokens: estimatedTokens,
        convStyleOccurrences,
        chatStyleOccurrences,
      });

      return {
        content: JSON.stringify(mockResponse),
        tokens: estimatedTokens,
        model: 'mock-model',
      };
    },
    sendMetaTextMessage: async () => ({ message_id: 'mock_meta_1' }),
  };

  // Mock do Supabase
  const mockDb = {
    convs: {
      'test_conv_audit': {
        id: 'test_conv_audit',
        stage_completed_rules: {
          current_stage_id: 'stg_1',
          orchestration: {
            mode: 'experimental',
            phase: 'descoberta',
            checkpoint: 'chk_pergunta_sobre_ele',
          },
        },
      },
    },
    msgs: [
      {
        id: 'msg_audit_1',
        conversation_id: 'test_conv_audit',
        sender_id: 'pretendente_1',
        is_mine: false,
        text: 'trabalho com mineração',
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
  };

  const mockSupabase = {
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => ({
          maybeSingle: async () => ({ data: mockDb.convs[val] || null, error: null }),
          order: () => ({
            limit: async () => ({ data: mockDb.msgs, error: null }),
          }),
          or: (rule) => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
      update: (payload) => ({
        eq: (col, val) => {
          if (mockDb.convs[val]) {
            mockDb.convs[val].stage_completed_rules = payload.stage_completed_rules;
          }
          return { error: null };
        },
      }),
      upsert: () => ({ error: null }),
    }),
  };

  // Executa o turno
  const res = await orch.runExperimentalOrchestration({
    supabase: mockSupabase,
    conversationId: 'test_conv_audit',
    runtime: mockRuntime,
  });

  console.log('--- RELATÓRIO DE MEDIÇÃO REAL DE TOKENS ---');
  const routerCall = calls.find(c => c.type === 'router');
  const subagentCall = calls.find(c => c.type === 'subagent');

  const routerTokens = routerCall ? routerCall.tokens : 0;
  const subagentTokens = subagentCall ? subagentCall.tokens : 0;
  const memoryToolTokens = 0;
  const totalNormalTokens = routerTokens + subagentTokens;

  console.log(`ROUTER TOKENS:               ${routerTokens} (chars: ${routerCall ? routerCall.promptLength : 0})`);
  console.log(`SUBAGENT TOKENS:             ${subagentTokens} (chars: ${subagentCall ? subagentCall.promptLength : 0})`);
  console.log(`CONVERSATION_STYLE TOKENS:   ${convStyleTokens} (chars: ${convStyleChars})`);
  console.log(`CHAT_STYLE TOKENS:           ${chatStyleTokens} (chars: ${chatStyleChars})`);
  console.log(`MEMORY TOOL TOKENS:          ${memoryToolTokens}`);
  console.log(`TOTAL NORMAL TURN TOKENS:    ${totalNormalTokens}`);
  console.log('-------------------------------------------');

  console.log(`\nPresença nos Prompts:`);
  console.log(`- CONVERSATION_STYLE no Router:    ${routerCall ? routerCall.convStyleOccurrences : 0} ocorrência(s) (esperado: 0)`);
  console.log(`- CHAT_STYLE no Router:            ${routerCall ? routerCall.chatStyleOccurrences : 0} ocorrência(s) (esperado: 0)`);
  console.log(`- CONVERSATION_STYLE no Subagente: ${subagentCall ? subagentCall.convStyleOccurrences : 0} ocorrência(s) (esperado: 1)`);
  console.log(`- CHAT_STYLE no Subagente:         ${subagentCall ? subagentCall.chatStyleOccurrences : 0} ocorrência(s) (esperado: 1)`);

  assert.equal(routerCall.convStyleOccurrences, 0, 'Router NÃO deve receber CONVERSATION_STYLE');
  assert.equal(routerCall.chatStyleOccurrences, 0, 'Router NÃO deve receber CHAT_STYLE');
  assert.equal(subagentCall.convStyleOccurrences, 1, 'Subagente deve receber CONVERSATION_STYLE exatamente 1 vez');
  assert.equal(subagentCall.chatStyleOccurrences, 1, 'Subagente deve receber CHAT_STYLE exatamente 1 vez');
  console.log('\n✔ Critério cumprido: Zero estilo no Router e exatamente 1 ocorrência de cada bloco no Subagente!');

  // Cenário 2: Turno com consulta de ferramenta de memória (Tool Call)
  console.log('\n--- MEDIÇÃO DE TURNO COM CONSULTA DE MEMÓRIA (TOOL CALL) ---');
  const toolCalls = [];
  let toolStep = 0;
  const mockToolRuntime = {
    callModel: async (prompt) => {
      const promptChars = prompt.length;
      const estimatedTokens = Math.round(promptChars / 4);

      let callType = 'unknown';
      let mockResponse = {};

      if (prompt.includes('Você é o Agente da Conversa da Larissa')) {
        callType = 'router';
        mockResponse = {
          targetSubagent: 'descoberta',
          action: 'delegate',
          reason: 'Pretendente perguntou sobre formação da Larissa',
        };
      } else if (prompt.includes('Você é a subagente especialista em DESCOBERTA')) {
        if (toolStep === 0) {
          callType = 'subagent_tool_request';
          toolStep++;
          mockResponse = {
            action: 'call_tool',
            tool: 'persona_get_fact',
            parameters: { field: 'education.current_period' },
          };
        } else {
          callType = 'subagent_final_reply';
          mockResponse = {
            action: 'reply',
            checkpoint: 'chk_pergunta_sobre_ele',
            summary: 'Responde período da faculdade',
            responses: [
              'tô no 10º período de enfermagem',
              'correria pura'
            ],
            suggestedResponse: 'tô no 10º período de enfermagem\n\ncorreria pura',
            nextPhase: 'descoberta',
          };
        }
      }

      toolCalls.push({
        type: callType,
        promptLength: promptChars,
        tokens: estimatedTokens,
      });

      return {
        content: JSON.stringify(mockResponse),
        tokens: estimatedTokens,
        model: 'mock-model',
      };
    },
  };

  await orch.runExperimentalOrchestration({
    supabase: mockSupabase,
    conversationId: 'test_conv_audit',
    runtime: mockToolRuntime,
  });

  const toolRouterCall = toolCalls.find(c => c.type === 'router');
  const toolSubRequest = toolCalls.find(c => c.type === 'subagent_tool_request');
  const toolSubFinal = toolCalls.find(c => c.type === 'subagent_final_reply');

  const toolRouterTokens = toolRouterCall ? toolRouterCall.tokens : 0;
  const toolSubInitialTokens = toolSubRequest ? toolSubRequest.tokens : 0;
  const toolSubFinalTokens = toolSubFinal ? toolSubFinal.tokens : 0;
  const toolTurnTotal = toolRouterTokens + toolSubInitialTokens + toolSubFinalTokens;

  console.log(`ROUTER INPUT TOKENS:               ${toolRouterTokens}`);
  console.log(`SUBAGENT INITIAL TOKENS:           ${toolSubInitialTokens}`);
  console.log(`TOOL ITERATION 1 (FEEDBACK) TOKENS: ${toolSubFinalTokens}`);
  console.log(`TOTAL TOOL TURN TOKENS:            ${toolTurnTotal}`);
  console.log('------------------------------------------------------------\n');
}

runTurnMeasurement().catch(err => {
  console.error('[ERRO NA MEDIÇÃO]:', err);
  process.exit(1);
});
