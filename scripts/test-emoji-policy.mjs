/**
 * test-emoji-policy.mjs
 * Validação da Política de Emojis Naturais e Ocasionais (PARTE U)
 */

import { computeDynamicEmojiBudget, runStyleLint } from "../supabase/functions/api/LarissaChatStyle.ts";
import { buildTurnContract } from "../supabase/functions/api/ConversationQualityGate.ts";
import { LARISSA_INTERACTION_DNA } from "../supabase/functions/api/larissa_interaction_dna.ts";

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅ PASS | ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL | ${description}`);
    failed++;
  }
}

console.log("================================================================================");
console.log("SUÍTE DE TESTES: POLÍTICA DE EMOJIS NATURAIS & STYLE LINT (PARTE U)");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// 1. REGRAS NO DNA
// -----------------------------------------------------------------------------
console.log("--- 1. AUSÊNCIA DE REGRAS RÍGIDAS DE SUPRESSÃO NO DNA ---");
assert("DNA não contém mais 'DEFAULT = ZERO EMOJI'", !LARISSA_INTERACTION_DNA.includes("DEFAULT = ZERO EMOJI"));
assert("DNA não contém mais 'preferência absoluta por zero'", !LARISSA_INTERACTION_DNA.includes("preferência absoluta por zero"));
assert("DNA declara que Emojis são ocasionais e naturais", LARISSA_INTERACTION_DNA.includes("EMOJIS (OCASIONAIS E NATURAIS)"));
assert("DNA declara que Zero emoji NÃO é preferência obrigatória", LARISSA_INTERACTION_DNA.includes("Zero emoji NÃO é preferência obrigatória"));

// -----------------------------------------------------------------------------
// 2. CONTRATO DE TURNO: SAUDAÇÃO NÃO FORÇA preferNoEmoji = true
// -----------------------------------------------------------------------------
console.log("\n--- 2. CONTRATO DE TURNO EM SAUDAÇÕES ---");
const greetingContract = buildTurnContract(
  [{ text: "oii linda, tudo bem?", sender: "them" }],
  { detectedQuestions: ["tudo bem?"] }
);
assert("Saudação calorosa NÃO força preferNoEmoji: true", greetingContract.preferNoEmoji === false);

// -----------------------------------------------------------------------------
// 3. CENÁRIOS DA PARTE U (A até F)
// -----------------------------------------------------------------------------
console.log("\n--- 3. CENÁRIOS COMPORTAMENTAIS DE EMOJI ---");

// A. Saudação calorosa com emoji permitido
const greetingResponses = ["Oiii 🥰", "Tô simm e vc?"];
const lintGreeting = runStyleLint(greetingResponses, { emojiBudget: 1, isRetry: false });
assert("A. Saudação com 1 emoji afetuoso é PERMITIDA (requiresRetry: false)", !lintGreeting.requiresRetry);

// B. Flerte leve com emoji permitido
const flirtResponses = ["Sou moça de família rapaz kkk 😉"];
const lintFlirt = runStyleLint(flirtResponses, { emojiBudget: 1, isRetry: false });
assert("B. Flerte leve com 1 emoji é PERMITIDO (requiresRetry: false)", !lintFlirt.requiresRetry);

// C. Conversa neutra: 0 ou 1 emoji aceito
const zeroEmojiResponses = ["Tô bem tbm, obrigada", "E vc é de onde?"];
const lintZero = runStyleLint(zeroEmojiResponses, { emojiBudget: 1, isRetry: false });
assert("C1. Zero emoji é 100% válido", !lintZero.requiresRetry);

const oneEmojiNeutral = ["Sou de São João del-Rei ✨", "E vc trabalha com oq por aí?"];
const lintOneNeutral = runStyleLint(oneEmojiNeutral, { emojiBudget: 1, isRetry: false });
assert("C2. 1 emoji moderado é 100% válido", !lintOneNeutral.requiresRetry);

// D. Assunto sério: budget 0 esperado
const seriousResponses = ["Tadinho", "Descansa um pouco agr"];
const lintSerious = runStyleLint(seriousResponses, { emojiBudget: 0, isRetry: false });
assert("D1. Assunto sério sem emoji é aprovado", !lintSerious.requiresRetry);

const seriousWithEmoji = ["Tadinho 🥰", "Descansa um pouco agr"];
const lintSeriousWithEmoji = runStyleLint(seriousWithEmoji, { emojiBudget: 0, isRetry: false });
assert("D2. Assunto sério COM emoji quando budget=0 é rejeitado pelo lint", lintSeriousWithEmoji.requiresRetry === true);

// E. Emoji recente: não repetir mecanicamente o mesmo caractere
const lintRecentRepeat = runStyleLint(["Oiii 🥰"], { emojiBudget: 1, recentEmojis: ["🥰"], isRetry: false });
assert("E. Mesmo emoji repetido em turnos consecutivos é detectado", lintRecentRepeat.requiresRetry === true);

// F. 2+ emojis: style lint detecta excesso
const twoEmojiResponses = ["Oii 🥰 ✨", "Tudo bem?"];
const lintTwoEmojis = runStyleLint(twoEmojiResponses, { emojiBudget: 1, isRetry: false });
assert("F. 2 ou mais emojis no mesmo turno dispara EXCESSO_EMOJIS", lintTwoEmojis.requiresRetry === true);

// Saneamento defensivo do excesso de emojis
const sanitizedExcesso = runStyleLint(twoEmojiResponses, { emojiBudget: 1, isRetry: true });
assert("F2. Saneamento defensivo poda o excesso e libera a mensagem", !sanitizedExcesso.requiresRetry);

// -----------------------------------------------------------------------------
// 4. ENTREGÁVEIS FINAIS
// -----------------------------------------------------------------------------
console.log("\n--- 4. ENTREGÁVEIS DA ESPECIFICAÇÃO ---");
const EMOJI_CAN_APPEAR_NATURALLY = !lintGreeting.requiresRetry && !lintFlirt.requiresRetry;
const EMOJI_NOT_FORCED = !lintZero.requiresRetry;
const MAX_ONE_EMOJI = lintTwoEmojis.requiresRetry && !lintOneNeutral.requiresRetry;

assert("EMOJI_CAN_APPEAR_NATURALLY = true", EMOJI_CAN_APPEAR_NATURALLY === true);
assert("EMOJI_NOT_FORCED = true", EMOJI_NOT_FORCED === true);
assert("MAX_ONE_EMOJI = true", MAX_ONE_EMOJI === true);

console.log("\n================================================================================");
console.log(`TOTAL DE ASSERÇÕES: ${passed + failed}`);
console.log(`✅ APROVADAS: ${passed}`);
console.log(`❌ FALHAS: ${failed}`);
console.log("================================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n🚀 SUÍTE DE POLÍTICA DE EMOJIS APROVADA COM SUCESSO!");
}
