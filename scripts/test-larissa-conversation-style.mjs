#!/usr/bin/env node
/**
 * scripts/test-larissa-conversation-style.mjs
 * 
 * Bateria de validação unitária e integridade do bloco canônico LARISSA_CONVERSATION_STYLE.
 * Verifica a presença das 16 regras de ouro, compacidade, e inclusão em todos os prompt builders.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

console.log('🧪 Iniciando validação do LARISSA_CONVERSATION_STYLE...\n');

// 1. Validação do arquivo canônico de documentação em .agents/
const docPath = path.resolve('.agents', 'LARISSA_CONVERSATION_STYLE.md');
assert.ok(fs.existsSync(docPath), 'Arquivo .agents/LARISSA_CONVERSATION_STYLE.md deve existir');
const docContent = fs.readFileSync(docPath, 'utf8');

const requiredRules = [
  'REAÇÃO > PERGUNTA',
  'ZERO PAPAGAIO',
  'ANTI-INTERROGATÓRIO',
  'ANTI-VÁCUO',
  'RECIPROCIDADE',
  'NÃO VOMITAR MEMÓRIA',
  'APROFUNDAMENTO NATURAL',
  'ANTI-MASTIGAÇÃO',
  'TRANSIÇÃO NATURAL',
  'MENSAGEM SECA',
  'ASSUNTO SÉRIO',
  'FLERTE',
  'PROPORCIONALIDADE',
  'NÃO FORÇAR OBJETIVO',
  'CONVERSATION SEARCH',
  'RESULTADO ESPERADO',
];

for (const rule of requiredRules) {
  assert.ok(
    docContent.includes(rule),
    `Documentação .agents/LARISSA_CONVERSATION_STYLE.md deve conter a regra: "${rule}"`
  );
}
console.log('✔ 1. .agents/LARISSA_CONVERSATION_STYLE.md contém todos os 16 pilares canônicos.');

// 2. Validação do módulo TypeScript no domínio (src/domain/services/LarissaConversationStyle.ts)
const domainStylePath = path.resolve('src', 'domain', 'services', 'LarissaConversationStyle.ts');
assert.ok(fs.existsSync(domainStylePath), 'src/domain/services/LarissaConversationStyle.ts deve existir');
const domainStyleContent = fs.readFileSync(domainStylePath, 'utf8');

for (const rule of requiredRules) {
  assert.ok(
    domainStyleContent.includes(rule),
    `Módulo domain LarissaConversationStyle.ts deve conter a regra: "${rule}"`
  );
}

// 3. Validação do módulo TypeScript no backend (supabase/functions/api/LarissaConversationStyle.ts)
const supaStylePath = path.resolve('supabase', 'functions', 'api', 'LarissaConversationStyle.ts');
assert.ok(fs.existsSync(supaStylePath), 'supabase/functions/api/LarissaConversationStyle.ts deve existir');
const supaStyleContent = fs.readFileSync(supaStylePath, 'utf8');

for (const rule of requiredRules) {
  assert.ok(
    supaStyleContent.includes(rule),
    `Módulo supabase LarissaConversationStyle.ts deve conter a regra: "${rule}"`
  );
}
console.log('✔ 2. Módulos TypeScript (domínio e supabase) exportam as 16 regras canônicas.');

// 4. Validação de compacidade (baixo consumo de tokens)
const matchBlock = domainStyleContent.match(/export const LARISSA_CONVERSATION_STYLE = `([\s\S]*?)`;/);
assert.ok(matchBlock, 'LARISSA_CONVERSATION_STYLE deve ser exportado como string');
const styleText = matchBlock[1];
const charCount = styleText.length;
const estimatedTokens = Math.round(charCount / 4);

console.log(`ℹ Estatísticas do bloco compacto: ${charCount} caracteres (~${estimatedTokens} tokens).`);
assert.ok(charCount <= 2400, `O bloco condensado deve estar na faixa de 350-500 tokens (< 2400 caracteres). Atual: ${charCount}`);
assert.ok(charCount >= 1400, `O bloco deve conter as 16 regras completas (> 1400 caracteres). Atual: ${charCount}`);
console.log('✔ 3. Compacidade e pegada de tokens rigorosamente validadas (meta 350-500 tokens cumprida).');

// 5. Validação da integração no LarissaPromptBuilder do domínio
function loadTsModule(filePath) {
  const tsCode = fs.readFileSync(filePath, 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', jsCode);
  fn(mod, mod.exports, (dep) => {
    if (dep.includes('LarissaConversationStyle')) {
      const styleTs = fs.readFileSync(path.resolve(path.dirname(filePath), dep.endsWith('.ts') ? dep : dep + '.ts'), 'utf8');
      const styleJs = ts.transpileModule(styleTs, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText;
      const sMod = { exports: {} };
      new Function('module', 'exports', styleJs)(sMod, sMod.exports);
      return sMod.exports;
    }
    return {};
  });
  return mod.exports;
}

const domainBuilderMod = loadTsModule('src/domain/services/LarissaPromptBuilder.ts');
assert.ok(domainBuilderMod.LARISSA_CONVERSATION_STYLE, 'LarissaPromptBuilder deve reexportar LARISSA_CONVERSATION_STYLE');

const domainResultDirect = new domainBuilderMod.GenerateAiPromptUseCase().execute({
  pretendente: { id: 'test_1', name: 'Douglas', platform: 'instagram' },
  messagesToRespond: [{ id: 'm1', sender: 'them', text: 'Oi Larissa' }],
  mode: 'direct_api',
});
assert.ok(domainResultDirect.systemPrompt.includes('LARISSA_CONVERSATION_STYLE'), 'systemPrompt deve conter LARISSA_CONVERSATION_STYLE');
assert.ok(domainResultDirect.systemPrompt.includes('REAÇÃO > PERGUNTA'), 'systemPrompt deve conter regra REAÇÃO > PERGUNTA');
assert.ok(domainResultDirect.systemPrompt.includes('ZERO PAPAGAIO'), 'systemPrompt deve conter regra ZERO PAPAGAIO');

const domainResultMarkdown = new domainBuilderMod.GenerateAiPromptUseCase().execute({
  pretendente: { id: 'test_1', name: 'Douglas', platform: 'instagram' },
  messagesToRespond: [{ id: 'm1', sender: 'them', text: 'Oi Larissa' }],
  mode: 'markdown',
});
assert.ok(domainResultMarkdown.prompt.includes('LARISSA_CONVERSATION_STYLE'), 'prompt markdown deve conter LARISSA_CONVERSATION_STYLE');
console.log('✔ 4. GenerateAiPromptUseCase do domínio injeta o estilo em modo direct_api e markdown.');

// 6. Validação da integração no LarissaPromptBuilder do Supabase
const supaBuilderMod = loadTsModule('supabase/functions/api/LarissaPromptBuilder.ts');
assert.ok(supaBuilderMod.LARISSA_CONVERSATION_STYLE, 'supabase/LarissaPromptBuilder deve reexportar LARISSA_CONVERSATION_STYLE');

const supaResultDirect = new supaBuilderMod.GenerateAiPromptUseCase().execute({
  pretendente: { id: 'test_2', name: 'Moose', platform: 'instagram' },
  messagesToRespond: [{ id: 'm2', sender: 'them', text: 'Tudo bem?' }],
  mode: 'direct_api',
});
assert.ok(supaResultDirect.systemPrompt.includes('LARISSA_CONVERSATION_STYLE'), 'supabase systemPrompt deve conter LARISSA_CONVERSATION_STYLE');
assert.ok(supaResultDirect.systemPrompt.includes('ANTI-INTERROGATÓRIO'), 'supabase systemPrompt deve conter regra ANTI-INTERROGATÓRIO');
assert.ok(supaResultDirect.systemPrompt.includes('ANTI-VÁCUO'), 'supabase systemPrompt deve conter regra ANTI-VÁCUO');
console.log('✔ 5. GenerateAiPromptUseCase do Supabase injeta o estilo com paridade idêntica.');

// 7. Validação da integração nos subagentes do experimental_orchestrator
function loadOrchestratorPrompts() {
  const tsCode = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', jsCode);
  fn(mod, mod.exports, (dep) => {
    if (dep.includes('LarissaConversationStyle')) {
      return { LARISSA_CONVERSATION_STYLE: styleText };
    }
    return {
      publishAutoPilotState: () => {},
      activity: () => {},
    };
  });
  return mod.exports;
}

const orchMod = loadOrchestratorPrompts();

const pConexao = orchMod.buildConexaoInicialPrompt({
  conversationId: 'c1',
  currentPhase: 'conexao_inicial',
  newMessage: { id: 'm1', text: 'Oi', timestamp: 'Agora', sender: 'them' },
});
assert.ok(pConexao.includes('LARISSA_CONVERSATION_STYLE'), 'buildConexaoInicialPrompt deve conter LARISSA_CONVERSATION_STYLE');
assert.ok(pConexao.includes('REAÇÃO > PERGUNTA'), 'buildConexaoInicialPrompt deve conter regra REAÇÃO > PERGUNTA');

const pDescoberta = orchMod.buildDescobertaPrompt({
  conversationId: 'c2',
  currentPhase: 'descoberta',
  newMessage: { id: 'm2', text: 'Trabalho com mineração', timestamp: 'Agora', sender: 'them' },
});
assert.ok(pDescoberta.includes('LARISSA_CONVERSATION_STYLE'), 'buildDescobertaPrompt deve conter LARISSA_CONVERSATION_STYLE');
assert.ok(pDescoberta.includes('ZERO PAPAGAIO'), 'buildDescobertaPrompt deve conter regra ZERO PAPAGAIO');
assert.ok(pDescoberta.includes('ANTI-MASTIGAÇÃO'), 'buildDescobertaPrompt deve conter regra ANTI-MASTIGAÇÃO');

const pRouter = orchMod.buildConversationAgentPrompt({
  conversationId: 'c_router',
  currentPhase: 'conexao_inicial',
  newMessage: { id: 'm1', text: 'Oi', timestamp: 'Agora', sender: 'them' },
});
assert.ok(!pRouter.includes('LARISSA_CONVERSATION_STYLE'), 'buildConversationAgentPrompt (Router) NÃO deve conter LARISSA_CONVERSATION_STYLE para economizar tokens');

const pOrch = orchMod.buildOrchestratorPrompt({
  conversationId: 'c3',
  currentPhase: 'conexao_inicial',
  newMessage: { text: 'Boa tarde', sender: 'them', timestamp: 'Agora' },
  conversationSummary: 'Resumo',
  relevantMemories: [],
  allowedTools: ['send_text'],
  phaseRules: ['Regra 1'],
});
assert.ok(!pOrch.includes('LARISSA_CONVERSATION_STYLE'), 'buildOrchestratorPrompt (Router/Orquestrador) NÃO deve conter LARISSA_CONVERSATION_STYLE');
console.log('✔ 6. Subagentes contêm LARISSA_CONVERSATION_STYLE e Router NÃO recebe o bloco (economia estrita de tokens).');

console.log('\n🎉 TODOS OS 6 TESTES DE LARISSA_CONVERSATION_STYLE PASSARAM COM 100% DE SUCESSO!\n');
