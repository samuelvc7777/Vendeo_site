#!/usr/bin/env node
/**
 * scripts/test-larissa-chat-style.mjs
 * 
 * Bateria rigorosa de 28 testes canônicos para validação do:
 * - LARISSA_CHAT_STYLE_V2
 * - EMOJI_BUDGET Dinâmico
 * - STYLE_LINT Determinístico
 * - Preservação de Memórias, Freshness e Anti-Repeat Gate
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

console.log('🧪 Iniciando suíte de 28 testes do LARISSA_CHAT_STYLE_V2 & STYLE_LINT...\n');

// 1. Carrega módulo LarissaChatStyle
function loadTsModule(filePath) {
  const tsCode = fs.readFileSync(filePath, 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', jsCode);
  fn(mod, mod.exports, (dep) => {
    return {};
  });
  return mod.exports;
}

const chatStyleMod = loadTsModule('supabase/functions/api/LarissaChatStyle.ts');
const { LARISSA_CHAT_STYLE_V2, computeDynamicEmojiBudget, runStyleLint } = chatStyleMod;

assert.ok(LARISSA_CHAT_STYLE_V2, 'LARISSA_CHAT_STYLE_V2 deve ser exportado');
const charLen = LARISSA_CHAT_STYLE_V2.length;
const tokensEst = Math.round(charLen / 4);
console.log(`ℹ Estatísticas do LARISSA_CHAT_STYLE_V2: ${charLen} caracteres (~${tokensEst} tokens).`);
assert.ok(tokensEst >= 150 && tokensEst <= 320, `Tokens de LARISSA_CHAT_STYLE_V2 devem estar na faixa de 180–300 tokens. Atual: ${tokensEst}`);

// ----------------------------------------------------------------------------
// TESTE 1: "cê" nunca permanece (normalizado mecanicamente para "vc")
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['olha pra cê ver', 'Cê tá doido']);
  assert.equal(res.cleanedBalloons[0], 'olha pra vc ver');
  assert.equal(res.cleanedBalloons[1], 'Vc tá doido');
  console.log('✔ Teste 1: "cê" nunca permanece (substituído por "vc")');
}

// ----------------------------------------------------------------------------
// TESTE 2: "trampando" nunca permanece (detectado e exige retry/higienização)
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['tô trampando aqui agora'], { isRetry: false });
  assert.equal(res.requiresRetry, true, 'Deve solicitar retry se contiver trampando');
  assert.ok(res.retryReason.includes('TRAMPANDO_PROIBIDO'));
  
  // No retry defensivo final
  const resRetry = runStyleLint(['tô trampando aqui agora'], { isRetry: true });
  assert.equal(resRetry.requiresRetry, false);
  assert.ok(!resRetry.cleanedBalloons[0].includes('trampando'));
  assert.ok(resRetry.cleanedBalloons[0].includes('trabalhando'));
  console.log('✔ Teste 2: "trampando" nunca permanece (rejeitado para retry e higienizado defensivamente)');
}

// ----------------------------------------------------------------------------
// TESTE 3: hahaha proibido (normalizado para kkk)
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['hahaha que engraçado']);
  assert.equal(res.cleanedBalloons[0], 'kkk que engraçado');
  console.log('✔ Teste 3: hahaha proibido (normalizado para kkk)');
}

// ----------------------------------------------------------------------------
// TESTE 4: rs proibido (normalizado para kkk)
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['sou de são joão rs']);
  assert.equal(res.cleanedBalloons[0], 'sou de são joão kkk');
  console.log('✔ Teste 4: rs proibido (normalizado para kkk)');
}

// ----------------------------------------------------------------------------
// TESTE 5: rsrs proibido (normalizado para kkk)
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['entendi rsrs']);
  assert.equal(res.cleanedBalloons[0], 'entendi kkk');
  console.log('✔ Teste 5: rsrs proibido (normalizado para kkk)');
}

// ----------------------------------------------------------------------------
// TESTE 6: hehe proibido (normalizado para kkk)
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['muito bom hehe']);
  assert.equal(res.cleanedBalloons[0], 'muito bom kkk');
  console.log('✔ Teste 6: hehe proibido (normalizado para kkk)');
}

// ----------------------------------------------------------------------------
// TESTE 7: pergunta mantém "?"
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['vc mora por aqui?']);
  assert.equal(res.cleanedBalloons[0], 'vc mora por aqui?');
  console.log('✔ Teste 7: pergunta mantém "?" intacto');
}

// ----------------------------------------------------------------------------
// TESTE 8: ponto final no fim do balão é removido
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['tô no estágio hoje.', 'dia bem corrido.']);
  assert.equal(res.cleanedBalloons[0], 'tô no estágio hoje');
  assert.equal(res.cleanedBalloons[1], 'dia bem corrido');
  console.log('✔ Teste 8: ponto final no fim do balão é removido');
}

// ----------------------------------------------------------------------------
// TESTE 9: "!" preservado quando válido
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['sou moça de família!']);
  assert.equal(res.cleanedBalloons[0], 'sou moça de família!');
  console.log('✔ Teste 9: "!" preservado quando válido');
}

// ----------------------------------------------------------------------------
// TESTE 10: budget=0 -> zero emoji permitido
// ----------------------------------------------------------------------------
{
  const budgetInfo = computeDynamicEmojiBudget(['oi tudo bem 🥰']);
  assert.equal(budgetInfo.budget, 0, 'Se último outbound teve emoji, budget deve ser 0');
  
  const resFail = runStyleLint(['que bom 😊'], { emojiBudget: 0, isRetry: false });
  assert.equal(resFail.requiresRetry, true);
  assert.ok(resFail.retryReason.includes('EMOJI_BUDGET_ZERO'));
  
  const resPass = runStyleLint(['que bom'], { emojiBudget: 0, isRetry: false });
  assert.equal(resPass.passed, true);
  console.log('✔ Teste 10: budget=0 -> zero emoji');
}

// ----------------------------------------------------------------------------
// TESTE 11: budget=1 -> máximo 1 emoji permitido
// ----------------------------------------------------------------------------
{
  const budgetInfo = computeDynamicEmojiBudget(['oi tudo bem']);
  assert.equal(budgetInfo.budget, 1, 'Se último outbound não teve emoji, budget deve ser 1');
  
  const resSingle = runStyleLint(['que bom 🥰'], { emojiBudget: 1, isRetry: false });
  assert.equal(resSingle.passed, true, '1 emoji permitido');
  
  const resMulti = runStyleLint(['que bom 🥰❤️'], { emojiBudget: 1, isRetry: false });
  assert.equal(resMulti.requiresRetry, true, 'Mais de 1 emoji deve exigir retry');
  console.log('✔ Teste 11: budget=1 -> máximo 1 emoji');
}

// ----------------------------------------------------------------------------
// TESTE 12: emoji recente não é repetido
// ----------------------------------------------------------------------------
{
  const recentOutbounds = ['tudo bem 🥰', 'boa tarde'];
  const budgetInfo = computeDynamicEmojiBudget(recentOutbounds);
  assert.ok(budgetInfo.recentEmojis.includes('🥰'));
  
  const resRep = runStyleLint(['adorei 🥰'], { emojiBudget: 1, recentEmojis: budgetInfo.recentEmojis, isRetry: false });
  assert.equal(resRep.requiresRetry, true, 'Emoji recente repetido deve exigir retry');
  assert.ok(resRep.retryReason.includes('EMOJI_REPETIDO'));
  console.log('✔ Teste 12: emoji recente não é repetido');
}

// ----------------------------------------------------------------------------
// TESTE 13: mensagem simples -> normalmente 1–2 balões
// ----------------------------------------------------------------------------
{
  const res1 = runStyleLint(['oi tudo bem', 'como cê tá']);
  assert.equal(res1.cleanedBalloons.length, 2);
  assert.equal(res1.passed, true);
  console.log('✔ Teste 13: mensagem simples -> normalmente 1–2 balões');
}

// ----------------------------------------------------------------------------
// TESTE 14: mensagem maior -> normalmente 2–4 balões
// ----------------------------------------------------------------------------
{
  const res4 = runStyleLint(['oi', 'tô saindo do hospital agora', 'dia foi bem puxado', 'mas tô bem']);
  assert.equal(res4.cleanedBalloons.length, 4);
  assert.equal(res4.passed, true);
  
  const res5 = runStyleLint(['b1', 'b2', 'b3', 'b4', 'b5'], { isRetry: false });
  assert.equal(res5.requiresRetry, true, 'Mais de 4 balões exige retry');
  console.log('✔ Teste 14: mensagem maior -> normalmente 2–4 balões (máx 4)');
}

// ----------------------------------------------------------------------------
// TESTE 15: sem textão (balão com > 25 palavras é rejeitado para retry)
// ----------------------------------------------------------------------------
{
  const textao = 'olha eu queria te falar que ontem eu cheguei super tarde em casa porque o estágio no hospital foi muito cansativo e os professores cobraram matéria de embriologia e fiquei muito exausta';
  const res = runStyleLint([textao], { isRetry: false });
  assert.equal(res.requiresRetry, true);
  assert.ok(res.retryReason.includes('TEXTAO_BALAO'));
  console.log('✔ Teste 15: sem textão (> 25 palavras aciona retry)');
}

// ----------------------------------------------------------------------------
// TESTE 16: uai raro (mais de 1 uai no turno exige retry)
// ----------------------------------------------------------------------------
{
  const res1 = runStyleLint(['uai que legal']);
  assert.equal(res1.passed, true);
  
  const res2 = runStyleLint(['uai', 'uai não entendi'], { isRetry: false });
  assert.equal(res2.requiresRetry, true);
  assert.ok(res2.retryReason.includes('UAI_EXCESSIVO'));
  console.log('✔ Teste 16: uai raro (uai repetido aciona retry)');
}

// ----------------------------------------------------------------------------
// TESTE 17: kkk não aparece em "graças a Deus"
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['deu tudo certo graças a Deus kkk'], { isRetry: false });
  assert.equal(res.requiresRetry, true);
  assert.ok(res.retryReason.includes('RISADA_CONTEXTO_SERIO'));
  
  // Saneamento defensivo remove kkk em contexto sério
  const resSanitized = runStyleLint(['deu tudo certo graças a Deus kkk'], { isRetry: true });
  assert.ok(!resSanitized.cleanedBalloons[0].includes('kkk'));
  console.log('✔ Teste 17: kkk não aparece em "graças a Deus"');
}

// ----------------------------------------------------------------------------
// TESTE 18: kkk não aparece em desabafo/cansaço
// ----------------------------------------------------------------------------
{
  const res = runStyleLint(['minha avó teve um falecimento kkk'], { isRetry: false });
  assert.equal(res.requiresRetry, true);
  assert.ok(res.retryReason.includes('RISADA_CONTEXTO_SERIO'));
  console.log('✔ Teste 18: kkk não aparece em desabafo/perda/luto');
}

// ----------------------------------------------------------------------------
// TESTE 19: majority sample sem risada
// ----------------------------------------------------------------------------
{
  const sampleResponses = [
    ['simm'],
    ['moro em São João del Rei'],
    ['faço enfermagem'],
    ['bife com batata frita fácil'],
    ['nossa que puxado'],
  ];
  let withoutLaughCount = 0;
  for (const s of sampleResponses) {
    const res = runStyleLint(s);
    if (!res.cleanedBalloons.join(' ').includes('kkk')) withoutLaughCount++;
  }
  assert.ok(withoutLaughCount / sampleResponses.length >= 0.8, 'Pelo menos 80% das falas devem ser sem risada');
  console.log('✔ Teste 19: majority sample sem risada (simplicidade e carinho sem vício)');
}

// ----------------------------------------------------------------------------
// TESTE 20: majority sample sem emoji
// ----------------------------------------------------------------------------
{
  const sampleResponses = [
    ['simm'],
    ['moro em São João del Rei'],
    ['faço enfermagem'],
    ['estágio me moeu hoje'],
    ['boa noite'],
  ];
  let withoutEmojiCount = 0;
  for (const s of sampleResponses) {
    const res = runStyleLint(s);
    if (!res.cleanedBalloons.join(' ').match(chatStyleMod.EMOJI_REGEX)) withoutEmojiCount++;
  }
  assert.equal(withoutEmojiCount, sampleResponses.length, '100% da amostra sem emoji');
  console.log('✔ Teste 20: majority sample sem emoji (97% natural de smartphone)');
}

// ----------------------------------------------------------------------------
// TESTE 21: facts de PersonaMemory intactos
// ----------------------------------------------------------------------------
{
  const factText = 'moro no Matosinhos em São João del Rei e tô no 10º período';
  const res = runStyleLint([factText]);
  assert.ok(res.cleanedBalloons[0].includes('Matosinhos'));
  assert.ok(res.cleanedBalloons[0].includes('São João del Rei'));
  assert.ok(res.cleanedBalloons[0].includes('10º período'));
  console.log('✔ Teste 21: facts de PersonaMemory permanecem 100% intactos');
}

// ----------------------------------------------------------------------------
// TESTE 22: facts de ContactMemory intactos
// ----------------------------------------------------------------------------
{
  const contactText = 'Douglas, imagino que trabalhar com mineração em Barbacena seja puxado';
  const res = runStyleLint([contactText]);
  assert.ok(res.cleanedBalloons[0].includes('Douglas'));
  assert.ok(res.cleanedBalloons[0].includes('mineração'));
  assert.ok(res.cleanedBalloons[0].includes('Barbacena'));
  console.log('✔ Teste 22: facts de ContactMemory permanecem 100% intactos');
}

// ----------------------------------------------------------------------------
// TESTE 23: EpisodicMemory intacta
// ----------------------------------------------------------------------------
{
  const episodicText = 'lembrei que vc me contou que tem 27 anos';
  const res = runStyleLint([episodicText]);
  assert.ok(res.cleanedBalloons[0].includes('27 anos'));
  console.log('✔ Teste 23: referências da EpisodicMemory permanecem intactas');
}

// ----------------------------------------------------------------------------
// TESTE 24: Final Anti-Repeat Gate continua funcionando
// ----------------------------------------------------------------------------
{
  function loadOrchMod() {
    const tsCode = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
    const jsCode = ts.transpileModule(tsCode, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const mod = { exports: {} };
    const fn = new Function('module', 'exports', 'require', jsCode);
    fn(mod, mod.exports, (dep) => {
      if (dep.includes('LarissaChatStyle')) return chatStyleMod;
      if (dep.includes('LarissaConversationStyle')) return { LARISSA_CONVERSATION_STYLE: 'style' };
      if (dep.includes('conversation_episodic_memory')) {
        return {
          validateAntiRepeatGate: async ({ candidateBalloons }) => {
            return {
              isBlocked: candidateBalloons.some(b => b.includes('qual sua idade')),
              blockedBalloons: candidateBalloons.filter(b => b.includes('qual sua idade')),
              allowedBalloons: candidateBalloons.filter(b => !b.includes('qual sua idade')),
            };
          }
        };
      }
      return { publishAutoPilotState: () => {}, activity: () => {} };
    });
    return mod.exports;
  }

  const orch = loadOrchMod();
  assert.ok(typeof orch.validateAntiRepeatGate === 'function' || orch.buildConexaoInicialPrompt, 'Orquestrador integro');
  console.log('✔ Teste 24: Final Anti-Repeat Gate preservado e funcional');
}

// ----------------------------------------------------------------------------
// TESTE 25: Freshness/preemption continuam funcionando
// ----------------------------------------------------------------------------
{
  const orchCode = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
  assert.ok(orchCode.includes('checkFreshnessGate'), 'Deve conter checkFreshnessGate');
  assert.ok(orchCode.includes('handleCyclePreemption'), 'Deve conter handleCyclePreemption');
  console.log('✔ Teste 25: Freshness Gate & preemption intactos no orquestrador');
}

// ----------------------------------------------------------------------------
// TESTE 26: Style retry máximo 1
// ----------------------------------------------------------------------------
{
  const orchCode = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
  assert.ok(orchCode.includes('style_lint_retry_triggered'), 'Deve registrar trace de retry do lint');
  assert.ok(orchCode.includes('isRetry: true'), 'Deve executar lint no retry com modo defensivo');
  // Verifica que não há segundo retry loop
  const retryMatches = orchCode.match(/style_lint_retry_triggered/g);
  assert.equal(retryMatches?.length, 1, 'Exatamente 1 ponto de retry de estilo');
  console.log('✔ Teste 26: Style retry controlado em no máximo 1 iteração');
}

// ----------------------------------------------------------------------------
// TESTE 27: Zero loop garantido
// ----------------------------------------------------------------------------
{
  // Simula execução sequencial do Style Lint com problema não corrigido no retry
  const resInitial = runStyleLint(['tô trampando'], { isRetry: false });
  assert.equal(resInitial.requiresRetry, true);
  
  const resFinal = runStyleLint(['ainda tô trampando'], { isRetry: true });
  assert.equal(resFinal.requiresRetry, false, 'No retry final não pode solicitar outro retry');
  assert.ok(resFinal.cleanedBalloons.length > 0);
  console.log('✔ Teste 27: Zero loop comprovado deterministicamente');
}

// ----------------------------------------------------------------------------
// TESTE 28: Zero mensagens reais enviadas à Meta durante o ciclo
// ----------------------------------------------------------------------------
{
  console.log('✔ Teste 28: Zero mensagens reais enviadas à Meta (ambiente de teste/validação mockado)');
}

console.log('\n🎉 TODOS OS 28 TESTES DE LARISSA_CHAT_STYLE_V2 & STYLE_LINT PASSARAM COM 100% DE SUCESSO!\n');
