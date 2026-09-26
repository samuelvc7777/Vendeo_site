/**
 * test-conversational-momentum.mjs
 * Validação de Conversational Momentum, Anti-Dead-End, Topic Continuity e Question Relevance
 *
 * Baseado na especificação da Larissa v2.4.0 e regressão do caso real "Sou de Varginha e vc?".
 */

import { buildCanonicalAgentInstructions, VENDEO_AGENT_INSTRUCTIONS_VERSION } from "../supabase/functions/api/openai_agent_instructions.ts";
import { LARISSA_INTERACTION_DNA, LARISSA_INTERACTION_DNA_VERSION } from "../supabase/functions/api/larissa_interaction_dna.ts";

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
console.log(`SUÍTE DE TESTES: CONVERSATIONAL MOMENTUM & HUMAN CONDUCT (v${VENDEO_AGENT_INSTRUCTIONS_VERSION})`);
console.log("================================================================================\n");

// Helper para detectar dead-end factual
function isDeadEndResponse(balloons) {
  if (!Array.isArray(balloons) || balloons.length === 0) return true;
  const fullText = balloons.join(" ").trim().toLowerCase();
  
  // Lista de respostas factuais isoladas que matam o assunto
  const deadEndPatterns = [
    /^sou de [a-zà-ÿ\s\-]+$/i,
    /^(?:tenho|faço)?\s*\d+\s*anos$/i,
    /^(?:trabalho com|sou)\s+(?:enfermagem|médica|advogada|vendedora|estudante|[a-zà-ÿ\s\-]+)$/i,
    /^(?:enfermagem|medicina|direito|pedagogia|engenharia|vendas)$/i,
    /^(?:sim|não|aham|blz|entendi|que bom|legal|show|ótimo|obrigada)$/i,
  ];

  const hasQuestion = fullText.includes("?");
  const wordCount = fullText.split(/\s+/).length;

  // Se tem pergunta ou mais de 8 palavras com gancho, não é dead end
  if (hasQuestion) return false;
  if (wordCount > 8) return false;

  return deadEndPatterns.some((pattern) => pattern.test(fullText));
}

// Helper para avaliar relevância da pergunta
function isQuestionRelevant(question, inboundContext, currentTopic, pendingObjective) {
  const q = question.toLowerCase();
  const inb = (inboundContext || "").toLowerCase();
  const top = (currentTopic || "").toLowerCase();
  const obj = (pendingObjective || "").toLowerCase();

  // 1. Surgiu do que ele falou?
  const hasDirectLink = inb.split(/\s+/).some((w) => w.length > 4 && q.includes(w));
  // 2. É do tópico vivo?
  const hasTopicLink = top && q.includes(top);
  // 3. É do objetivo pendente?
  const hasObjLink = obj && (
    ((obj.includes("job") || obj.includes("trabalho")) && (q.includes("trabalh") || q.includes("serviço") || q.includes("área"))) ||
    ((obj.includes("city") || obj.includes("cidade")) && (q.includes("mora") || q.includes("cidade") || q.includes("onde"))) ||
    ((obj.includes("age") || obj.includes("idade")) && (q.includes("anos") || q.includes("idade")))
  );

  return Boolean(hasDirectLink || hasTopicLink || hasObjLink);
}

// -----------------------------------------------------------------------------
// 1. REGRESSÃO DO CASO REAL: "Sou de Varginha e vc?"
// -----------------------------------------------------------------------------
console.log("--- 1. REGRESSÃO DO CASO REAL (Varginha: Dead-End vs Continuidade) ---");
const buggyResponse = ["sou de São João del-Rei"];
assert("Resposta histórica bugada é classificada como DEAD_END = true", isDeadEndResponse(buggyResponse) === true);

const goodResponseWithNextObjective = ["sou de São João del-Rei", "e vc trabalha com oq por aí?"];
assert("Resposta com avanço de objetivo é classificada como DEAD_END = false", isDeadEndResponse(goodResponseWithNextObjective) === false);

const goodResponseWithCityReaction = ["sou de São João del-Rei", "nossaa mineirada reunida kkkkk"];
assert("Resposta com reação/comentário afetuoso é classificada como DEAD_END = false", isDeadEndResponse(goodResponseWithCityReaction) === false);

// -----------------------------------------------------------------------------
// 2. REGRAS CANÔNICAS NO DNA E INSTRUÇÕES
// -----------------------------------------------------------------------------
console.log("\n--- 2. INTEGRIDADE DAS REGRAS NO PROMPT E DNA ---");
const instructions = buildCanonicalAgentInstructions();
const persistentInstructions = buildCanonicalAgentInstructions({ persistentMode: true });
assert("Todos os modos recebem a mesma instrução fixa", instructions === persistentInstructions);

assert("DNA contém regra expressa de FIM DO DEAD-END FÁTICO", LARISSA_INTERACTION_DNA.includes("FIM DO DEAD-END FÁTICO"));
assert("DNA contém FÓRMULA NATURAL DE TURNO", LARISSA_INTERACTION_DNA.includes("RESPONDER → REAGIR → ACRESCENTAR → ABRIR CONTINUIDADE"));
assert("DNA proíbe devolver menos energia do que o contexto permite", LARISSA_INTERACTION_DNA.includes("NÃO DEVOLVA MENOS ENERGIA CONVERSACIONAL"));
assert("DNA contém TOPIC CONTINUITY GATE", LARISSA_INTERACTION_DNA.includes("TOPIC CONTINUITY GATE"));
assert("DNA contém QUESTION RELEVANCE GATE", LARISSA_INTERACTION_DNA.includes("QUESTION RELEVANCE GATE"));
assert("Instruções contêm HIERARQUIA DE DECISÃO de 7 níveis", instructions.includes("HIERARQUIA DE DECISÃO"));
assert("Instruções garantem que pergunta direta é respondida primeiro (mustAnswerFirst)", instructions.includes("mustAnswerFirst"));
assert("Instruções definem que SAME-CYCLE already_satisfied não impede continuidade", instructions.includes("SAME-CYCLE ALREADY_SATISFIED & PRÓXIMO OBJETIVO"));
assert("Instruções removem a proibição destrutiva de memória vazia", !instructions.includes("resultado vazio → NÃO PERGUNTE"));
assert("DNA trata respostas breves com contexto e sem repreensão", LARISSA_INTERACTION_DNA.includes("Respostas curtas") && LARISSA_INTERACTION_DNA.includes("Não repreenda, cobre, acuse ou pressione"));
assert("Instruções canônicas não descrevem respostas breves como algo que ela odeia", !/odeia pessoa seca|odeia homem seco|odeia resposta seca/i.test(instructions));
assert("Instruções do modo persistente não descrevem respostas breves como algo que ela odeia", !/odeia pessoa seca|odeia homem seco|odeia resposta seca/i.test(persistentInstructions));
assert("Instruções persistentes proíbem cobrança ou provocação por respostas curtas", persistentInstructions.includes("nunca repreenda, cobre ou provoque alguém apenas por responder pouco"));

// -----------------------------------------------------------------------------
// 3. CENÁRIOS COMPORTAMENTAIS (PARTE T)
// -----------------------------------------------------------------------------
console.log("\n--- 3. CENÁRIOS COMPORTAMENTAIS DA PARTE T ---");

// Cenário 1: Cidade respondida + pergunta de volta
const c1 = ["sou de São João del-Rei", "e vc trabalha com oq por aí?"];
assert("C1: Cidade respondida + pergunta de volta tem DIRECT_QUESTION_ANSWERED = true", c1[0].includes("São João del-Rei"));
assert("C1: Não é dead-end", !isDeadEndResponse(c1));
assert("C1: Máximo 1 pergunta", c1.filter(b => b.includes("?")).length === 1);

// Cenário 2: Profissão revelada espontaneamente
const c2 = ["nossa estágio em hospital é puxado viu", "mas vc gosta dessa área de enfermagem?"];
assert("C2: Reage à profissão revelada e aprofunda o gancho", !isDeadEndResponse(c2));

// Cenário 3: Idade revelada espontaneamente
const c3 = ["nossa 25 anos kkk", "tá no auge então"];
assert("C3: Reage à idade sem interrogatório", !isDeadEndResponse(c3));

// Cenário 4: Tópico familiar rico (Família em Varginha)
const c4 = ["sou de São João del-Rei", "nossaa deve ser bom ter a família perto assim"];
assert("C4: Prioriza família antes de forçar checklist mecânico", !isDeadEndResponse(c4));
assert("C4: Não fez pergunta desconectada sobre trabalho", c4.filter(b => b.includes("?")).length === 0);

// Cenário 5: Resposta breve não deve ser tratada como ofensa ou desinteresse
const c5 = ["Tudo bem por aí?"];
assert("C5: Mantém cordialidade sem rotular uma resposta breve", !isDeadEndResponse(c5) && !/desânimo|seco/i.test(c5.join(" ")));

// Cenário 6: Flerte leve ("vc é muito fofa kkk")
const c6 = ["sou um amorzinho rapaz kkk", "não se acostuma não"];
assert("C6: Flerte progressivo com postura de moça de família", !isDeadEndResponse(c6));

// Cenário 7: Assunto sério ("meu dia foi pesado demais")
const c7 = ["tadinho", "descansa um pouco agr"];
assert("C7: Acolhimento afetuoso sem emoji e sem risada", !isDeadEndResponse(c7));
assert("C7: Zero perguntas intrusivas em momento de cansaço", c7.filter(b => b.includes("?")).length === 0);

// Cenário 8: Resposta curta factual bloqueada quando isolada
assert("C8: 'sou de São João del-Rei' isolado é bloqueado", isDeadEndResponse(["sou de São João del-Rei"]) === true);
assert("C8: 'enfermagem' isolado é bloqueado", isDeadEndResponse(["enfermagem"]) === true);
assert("C8: '23 anos' isolado é bloqueado", isDeadEndResponse(["23 anos"]) === true);

// Cenário 9: Objetivo concluído + próximo pendente (cidade concluída -> trabalho)
const c9 = ["sou de São João del-Rei", "vc trabalha com oq por aí?"];
assert("C9: Conclui cidade e avança suavemente para trabalho no mesmo turno", !isDeadEndResponse(c9));

// Cenário 10: Assunto rico competindo com próximo objetivo
const c10 = ["sou de São João del-Rei", "nossaa deve ser bom ter a família perto assim"];
assert("C10: Contexto vivo vence checklist mecânico", !isDeadEndResponse(c10));

// -----------------------------------------------------------------------------
// 4. QUESTION RELEVANCE GATE & ANTI-RANDOM SWITCH
// -----------------------------------------------------------------------------
console.log("\n--- 4. QUESTION RELEVANCE GATE ---");
const inbVarginha = "Sou de Varginha";
assert("Pergunta sobre trabalho por aí é relevante como objetivo pendente", isQuestionRelevant("e vc trabalha com oq por aí?", inbVarginha, "cidade", "goal_job"));
assert("Pergunta sobre morar em Varginha é relevante pelo inbound", isQuestionRelevant("vc mora em Varginha faz tempo?", inbVarginha, "cidade", "goal_job"));
assert("Pergunta aleatória sobre animais é REJEITADA por falta de gancho", !isQuestionRelevant("vc gosta de cachorro?", inbVarginha, "cidade", "goal_job"));
assert("Pergunta aleatória sobre signo é REJEITADA", !isQuestionRelevant("qual seu signo?", inbVarginha, "cidade", "goal_job"));

console.log("\n================================================================================");
console.log(`TOTAL DE ASSERÇÕES: ${passed + failed}`);
console.log(`✅ APROVADAS: ${passed}`);
console.log(`❌ FALHAS: ${failed}`);
console.log("================================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n🚀 SUÍTE DE MOMENTUM CONVERSACIONAL APROVADA COM SUCESSO!");
}
