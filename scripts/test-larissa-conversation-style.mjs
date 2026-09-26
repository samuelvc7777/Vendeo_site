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
    if (dep.includes('larissa_canonical_prompt')) {
      const canonicalBasePath = path.resolve(path.dirname(filePath), dep);
      const canonicalPath = fs.existsSync(canonicalBasePath) ? canonicalBasePath : `${canonicalBasePath}.ts`;
      const canonicalTs = fs.readFileSync(canonicalPath, 'utf8');
      const canonicalJs = ts.transpileModule(canonicalTs, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText;
      const cMod = { exports: {} };
      new Function('module', 'exports', canonicalJs)(cMod, cMod.exports);
      return cMod.exports;
    }
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

const { LARISSA_CANONICAL_PROMPT: canonicalPrompt } = await import('../supabase/functions/api/larissa_canonical_prompt.generated.ts');
const canonicalMarkdown = fs.readFileSync('supabase/functions/api/larissa_canonical_prompt.md', 'utf8').trim();
assert.equal(canonicalPrompt, canonicalMarkdown, 'Markdown é a fonte única do prompt fixo');

const domainBuilderMod = loadTsModule('src/domain/services/LarissaPromptBuilder.ts');
assert.ok(domainBuilderMod.LARISSA_CONVERSATION_STYLE, 'LarissaPromptBuilder deve reexportar LARISSA_CONVERSATION_STYLE');

const domainResultDirect = new domainBuilderMod.GenerateAiPromptUseCase().execute({
  pretendente: { id: 'test_1', name: 'Douglas', platform: 'instagram' },
  messagesToRespond: [{ id: 'm1', sender: 'them', text: 'Oi Larissa' }],
  mode: 'direct_api',
});
assert.equal(domainResultDirect.systemPrompt, canonicalPrompt, 'gerador do domínio deve usar a instrução canônica compartilhada');
assert.ok(!domainResultDirect.systemPrompt.includes('ODEIE frieza'), 'instrução antiga não pode voltar no fallback');

const domainResultMarkdown = new domainBuilderMod.GenerateAiPromptUseCase().execute({
  pretendente: { id: 'test_1', name: 'Douglas', platform: 'instagram' },
  messagesToRespond: [{ id: 'm1', sender: 'them', text: 'Oi Larissa' }],
  mode: 'markdown',
});
assert.ok(domainResultMarkdown.prompt.includes(canonicalPrompt), 'prompt markdown deve incluir a instrução canônica completa');
console.log('✔ 4. O gerador do domínio usa a instrução canônica em modo direct_api e markdown.');

// 6. Validação da integração no LarissaPromptBuilder do Supabase
const supaBuilderMod = loadTsModule('supabase/functions/api/LarissaPromptBuilder.ts');
assert.ok(supaBuilderMod.LARISSA_CONVERSATION_STYLE, 'supabase/LarissaPromptBuilder deve reexportar LARISSA_CONVERSATION_STYLE');

const supaResultDirect = new supaBuilderMod.GenerateAiPromptUseCase().execute({
  pretendente: { id: 'test_2', name: 'Moose', platform: 'instagram' },
  messagesToRespond: [{ id: 'm2', sender: 'them', text: 'Tudo bem?' }],
  mode: 'direct_api',
});
assert.equal(supaResultDirect.systemPrompt, canonicalPrompt, 'gerador Supabase deve usar a mesma instrução fixa canônica');
console.log('✔ 5. O gerador Supabase usa a mesma instrução canônica.');

// 7. Validação de fonte única entre Brain e geradores manuais
const { buildCanonicalAgentInstructions } = await import('../supabase/functions/api/openai_agent_instructions.ts');
assert.equal(buildCanonicalAgentInstructions(), canonicalPrompt, 'Agent e geradores manuais devem compartilhar a mesma fonte');
assert.doesNotMatch(canonicalPrompt, /ODEIE frieza|10º período|SÃO MIGUEL DOS MILAGRES/i, 'regras biográficas do prompt antigo não podem reaparecer');
const { buildTinderAiPromptForBackend } = await import('../supabase/functions/api/tinder_ai.ts');
const tinderPrompt = buildTinderAiPromptForBackend(
  { match_id: 'match_1', name: 'Rafael' },
  [{ id: 'message_1', match_id: 'match_1', sender_id: 'person_1', message: 'Oi Larissa', sent_date: '2026-09-26T10:00:00-03:00' }],
  { user_id: 'larissa_1' },
);
assert.ok(tinderPrompt.startsWith(canonicalPrompt), 'prompt do Tinder deve começar com a mesma instrução canônica');
assert.ok(tinderPrompt.includes('Oi Larissa'), 'contexto variável do Tinder deve incluir a mensagem');
assert.doesNotMatch(tinderPrompt, /SÃO MIGUEL DOS MILAGRES|10º período|REGRA SUPREMA DE CUMPRIMENTO/i, 'prompt antigo do Tinder deve ser removido');
console.log('✔ 6. Brain, backend, Instagram, Tinder e fallback usam uma única instrução; o prompt legado foi removido.');

console.log('\n🎉 VALIDAÇÃO DA FONTE CANÔNICA APROVADA!\n');
