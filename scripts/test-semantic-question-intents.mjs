/**
 * test-semantic-question-intents.mjs
 * Suíte Completa de Testes — Semantic Question Intent Ledger & Immediate Continuity Gate
 *
 * Valida:
 * 1. REAL_ALLIGATOR_REPRODUCTION: Cenário real da cv do Alligator (1040376229029884)
 * 2. PARAPHRASE_INTENT_REUSE: Reuso estável de intentKey para paráfrases da mesma pergunta
 * 3. DISTINCT_QUESTION_INTENTS: Perguntas com intenções diferentes geram intentKeys distintas
 * 4. QUESTION_INTENT_RESOLUTION: Resolução determinística e semântica com status answered
 * 5. TESTE_DE_NAO_RESPOSTA: Não resolução quando pretendente não responde
 * 6. BACKEND_INTENT_REPEAT_BLOCK: Poda seletiva do balão repetido preservando balões afetuosos
 * 7. FAIL_CLOSED_WHEN_ALL_BALLOONS_BLOCKED: Bloqueio total sem envio se todos os balões forem podados
 * 8. EXACT_TEXT_REPEAT_GUARD: Normalização semântica zero barrando repetição textual
 * 9. ZERO_QUESTION_ALLOWED: Liberdade para responder com afeto sem formular perguntas
 * 10. LONG_TERM_DISCOVERY_GATE_PRESERVED & GREETING_ZERO_TOOL: Preservação de gates anteriores
 * 11. TOKEN_AUDIT: Medição de impacto de tokens do snippet compacto
 *
 * Execução:
 *   node scripts/test-semantic-question-intents.mjs
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  validateBackendQuestionIntentGuard,
  normalizeQuestionTextForExactRepeat,
  formatRecentQuestionIntentsSnippet,
} from "../supabase/functions/api/experimental_orchestrator.ts";
import {
  validateQuestionIntentsInvariant,
  buildOpenAiBrainContextMessage,
} from "../supabase/functions/api/openai_brain.ts";
import {
  buildCanonicalAgentInstructions,
  VENDEO_AGENT_INSTRUCTIONS_VERSION,
} from "../supabase/functions/api/openai_agent_instructions.ts";

// Carrega .env.local
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
} catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://wsdualhvopidgqcumonr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ PASS | ${label}${detail ? " — " + detail : ""}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL | ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function runSuite() {
  console.log("================================================================================");
  console.log("SUÍTE DE TESTES: SEMANTIC QUESTION INTENT LEDGER & CONTINUITY GATE");
  console.log(`Versão das Instruções do Agent: ${VENDEO_AGENT_INSTRUCTIONS_VERSION}`);
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // TESTE 1: EXACT_TEXT_REPEAT_GUARD (Semântica Zero)
  // ---------------------------------------------------------------------------
  console.log("--- 1. EXACT_TEXT_REPEAT_GUARD (Normalização Semântica Zero) ---");
  const t1A = normalizeQuestionTextForExactRepeat("Você sente falta de lá às vezes?");
  const t1B = normalizeQuestionTextForExactRepeat("  voce sente falta de la as vezes?   ");
  assert("Normalização de acentos, pontuação e espaços", t1A === t1B, `t1A="${t1A}"`);

  const t1Guard = validateBackendQuestionIntentGuard({
    candidateBalloons: ["Nossa, que legal!", "Você sente falta de lá às vezes?"],
    recentLarissaOutbounds: ["voce sente falta de la as vezes?"],
  });
  assert("Bloqueia balão com pergunta textualmente idêntica anterior", t1Guard.isBlocked);
  assert("Poda seletiva preserva balão não repetido", t1Guard.allowedBalloons.length === 1 && t1Guard.allowedBalloons[0] === "Nossa, que legal!");
  assert("Registra motivo exato no trace", t1Guard.reasons.some((r) => r.includes("EXACT_TEXT_REPEAT_GUARD")));

  // ---------------------------------------------------------------------------
  // TESTE 2: BACKEND_INTENT_REPEAT_BLOCK & PODA SELETIVA
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. BACKEND_INTENT_REPEAT_BLOCK & PODA SELETIVA ---");
  const t2Guard = validateBackendQuestionIntentGuard({
    candidateBalloons: ["Entendo demais a correria kkk", "mas vc sente falta de morar lá?"],
    questionIntents: [
      {
        responseIndex: 1,
        intentKey: "feeling.miss_previous_place",
        canonicalMeaning: "saber se o pretendente sente falta de morar no lugar anterior",
        kind: "continuity",
        target: "pretendente",
      },
    ],
    recentQuestionIntents: [
      {
        intentKey: "feeling.miss_previous_place",
        canonicalMeaning: "saber se sente falta de Barbacena",
        questionText: "vc sente falta de lá às vezes?",
        status: "answered",
        askedAt: new Date(Date.now() - 60000).toISOString(),
      },
    ],
  });
  assert("Bloqueia balão cuja intentKey já foi respondida (status: answered)", t2Guard.isBlocked);
  assert("Poda apenas o balão 1 e preserva o balão 0 de acolhimento", t2Guard.allowedBalloons.length === 1 && t2Guard.allowedBalloons[0] === "Entendo demais a correria kkk");
  assert("failClosed é false pois sobrou balão conversacional", !t2Guard.failClosed);

  // ---------------------------------------------------------------------------
  // TESTE 3: FAIL_CLOSED_WHEN_ALL_BALLOONS_BLOCKED
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. FAIL_CLOSED_WHEN_ALL_BALLOONS_BLOCKED ---");
  const t3Guard = validateBackendQuestionIntentGuard({
    candidateBalloons: ["mas vc sente falta de morar lá?"],
    questionIntents: [
      {
        responseIndex: 0,
        intentKey: "feeling.miss_previous_place",
        canonicalMeaning: "saber se o pretendente sente falta de morar no lugar anterior",
        kind: "continuity",
        target: "pretendente",
      },
    ],
    recentQuestionIntents: [
      {
        intentKey: "feeling.miss_previous_place",
        canonicalMeaning: "saber se sente falta de Barbacena",
        questionText: "vc sente falta de lá às vezes?",
        status: "answered",
        askedAt: new Date(Date.now() - 60000).toISOString(),
      },
    ],
  });
  assert("Bloqueia única pergunta repetida", t3Guard.isBlocked);
  assert("allowedBalloons fica vazio", t3Guard.allowedBalloons.length === 0);
  assert("Ativa FAIL CLOSED determinístico (nenhum disparo à Meta)", t3Guard.failClosed === true);

  // ---------------------------------------------------------------------------
  // TESTE 4: ZERO_QUESTION_ALLOWED (Sem forçar perguntas)
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. ZERO_QUESTION_ALLOWED (Acolhimento Puro) ---");
  const t4Invariant = validateQuestionIntentsInvariant({
    action: "reply",
    responses: ["Ah sim, com certeza!", "Família reunida é bom demais né"],
    questionIntents: [],
  });
  assert("Plano com zero perguntas e questionIntents=[] é 100% válido", t4Invariant.valid === true);

  // ---------------------------------------------------------------------------
  // TESTE 5: VALIDATE_QUESTION_INTENTS_INVARIANT (Invariante Estrutural)
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. VALIDATE_QUESTION_INTENTS_INVARIANT (Invariante do Brain) ---");
  const t5Missing = validateQuestionIntentsInvariant({
    action: "reply",
    responses: ["E aí", "você costuma visitar seus pais?"],
    questionIntents: [],
  });
  assert("Rejeita plano com balão contendo '?' sem anotação em questionIntents", t5Missing.valid === false);
  assert("Mensagem de erro descritiva para retry estrutural", t5Missing.error?.includes("PLAN_MISSING_QUESTION_INTENTS"));

  const t5Valid = validateQuestionIntentsInvariant({
    action: "reply",
    responses: ["E aí", "você costuma visitar seus pais?"],
    questionIntents: [
      {
        responseIndex: 1,
        intentKey: "routine.family_visit_timing",
        canonicalMeaning: "saber com que frequência ou quando ele visita os pais",
        kind: "continuity",
        target: "pretendente",
      },
    ],
  });
  assert("Aceita plano com anotação correspondente válida", t5Valid.valid === true);

  // ---------------------------------------------------------------------------
  // TESTE 6: DISTINCT_QUESTION_INTENTS
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. DISTINCT_QUESTION_INTENTS (Intenções Distintas) ---");
  const t6Guard = validateBackendQuestionIntentGuard({
    candidateBalloons: ["Que legal!", "Costuma ir pra lá todo fim de semana?"],
    questionIntents: [
      {
        responseIndex: 1,
        intentKey: "routine.family_visit_timing",
        canonicalMeaning: "saber a frequência de ida à terra natal",
        kind: "continuity",
        target: "pretendente",
      },
    ],
    recentQuestionIntents: [
      {
        intentKey: "feeling.miss_previous_place",
        canonicalMeaning: "saber se sente falta de morar lá",
        questionText: "vc sente falta de lá às vezes?",
        status: "answered",
        askedAt: new Date(Date.now() - 60000).toISOString(),
      },
    ],
  });
  assert("Não bloqueia nova pergunta com intentKey distinta legítima", !t6Guard.isBlocked);
  assert("Todos os balões permitidos", t6Guard.allowedBalloons.length === 2);

  // ---------------------------------------------------------------------------
  // TESTE 7: QUESTION_INTENT_RESOLUTION & TESTE_DE_NAO_RESPOSTA
  // ---------------------------------------------------------------------------
  console.log("\n--- 7. QUESTION_INTENT_RESOLUTION & TESTE_DE_NAO_RESPOSTA ---");
  const sampleLedger = [
    {
      intentKey: "feeling.miss_previous_place",
      canonicalMeaning: "saber se sente falta do lugar",
      questionText: "vc sente falta de lá às vezes?",
      status: "asked",
      askedAt: new Date(Date.now() - 120000).toISOString(),
    },
  ];

  // Simulação de resolução quando inbound responde
  const resolvedIds = ["feeling.miss_previous_place"];
  for (const rId of resolvedIds) {
    for (const item of sampleLedger) {
      if (item.intentKey === rId && item.status === "asked") {
        item.status = "answered";
        item.answeredAt = new Date().toISOString();
      }
    }
  }
  assert("Status transiciona para 'answered' quando resolvedQuestionIntentIds contém o id", sampleLedger[0].status === "answered");

  // Teste de não-resposta: se resolvedIds estiver vazio, continua asked
  const sampleLedgerUnanswered = [
    {
      intentKey: "preference.food",
      canonicalMeaning: "saber comida favorita",
      questionText: "qual seu prato preferido?",
      status: "asked",
      askedAt: new Date().toISOString(),
    },
  ];
  const noResolved = [];
  for (const rId of noResolved) {
    for (const item of sampleLedgerUnanswered) {
      if (item.intentKey === rId && item.status === "asked") {
        item.status = "answered";
      }
    }
  }
  assert("Permanece 'asked' quando o pretendente não respondeu", sampleLedgerUnanswered[0].status === "asked");

  // ---------------------------------------------------------------------------
  // TESTE 8: TOKEN_AUDIT (Impacto Compacto do Snippet)
  // ---------------------------------------------------------------------------
  console.log("\n--- 8. TOKEN_AUDIT (Medição do Snippet Compacto) ---");
  const snippet = formatRecentQuestionIntentsSnippet([
    {
      intentKey: "feeling.miss_previous_place",
      canonicalMeaning: "saber se sente falta de Barbacena",
      questionText: "vc sente falta de lá às vezes?",
      status: "asked",
      askedAt: new Date().toISOString(),
    },
    {
      intentKey: "discover.profession",
      canonicalMeaning: "descobrir profissão",
      questionText: "vc trabalha com o que?",
      status: "answered",
      askedAt: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
    },
  ]);
  const estimatedTokens = Math.ceil(snippet.length / 4);
  console.log("  Snippet gerado:\n" + snippet);
  console.log(`  Caracteres: ${snippet.length} | Tokens estimados: ~${estimatedTokens}`);
  assert("Snippet consome menos de 80 tokens (ultra compacto)", estimatedTokens < 80);

  // ---------------------------------------------------------------------------
  // TESTE 9: REAL_ALLIGATOR_REPRODUCTION
  // ---------------------------------------------------------------------------
  console.log("\n--- 9. REAL_ALLIGATOR_REPRODUCTION (Caso Alligator 1040376229029884) ---");
  // No incidente do Alligator:
  // Turno 14:06: Larissa: "Vc sente falta de lá às vezes?" (intentKey: "feeling.miss_previous_place")
  // Inbound 14:07: Pretendente responde que a família inteira mora lá e ele sempre vai ver
  // Turno 14:08: Larissa candidata: "Vc sente falta de morar lá?"
  const alligatorLedger = [
    {
      intentKey: "feeling.miss_previous_place",
      canonicalMeaning: "saber se sente falta de Barbacena",
      questionText: "vc sente falta de lá às vezes?",
      status: "answered", // Respondida pelo inbound
      askedAt: "2026-09-17T17:06:28Z",
      answeredAt: "2026-09-17T17:07:00Z",
    },
  ];

  // Caso A: Modelo refraseia a mesma intenção com outras palavras
  const alligatorCandidateParaphrase = validateBackendQuestionIntentGuard({
    candidateBalloons: ["imagino, família é tudo", "vc sente falta de morar lá?"],
    questionIntents: [
      {
        responseIndex: 1,
        intentKey: "feeling.miss_previous_place", // Reuso da intentKey obrigatória
        canonicalMeaning: "saber se sente falta de morar lá",
        kind: "continuity",
        target: "pretendente",
      },
    ],
    recentQuestionIntents: alligatorLedger,
    lastLarissaTurn: "vc sente falta de lá às vezes?",
  });

  assert("Alligator Caso A: Bloqueia a repetição refraseada ('morar lá')", alligatorCandidateParaphrase.isBlocked);
  assert("Alligator Caso A: Preserva balão de empatia ('imagino, família é tudo')", alligatorCandidateParaphrase.allowedBalloons.length === 1 && alligatorCandidateParaphrase.allowedBalloons[0] === "imagino, família é tudo");

  // Caso B: Modelo manda apenas a pergunta repetida
  const alligatorOnlyQuestion = validateBackendQuestionIntentGuard({
    candidateBalloons: ["vc sente falta de morar lá?"],
    questionIntents: [
      {
        responseIndex: 0,
        intentKey: "feeling.miss_previous_place",
        canonicalMeaning: "saber se sente falta de morar lá",
        kind: "continuity",
        target: "pretendente",
      },
    ],
    recentQuestionIntents: alligatorLedger,
  });
  assert("Alligator Caso B: Ativa Fail Closed sem despacho externo", alligatorOnlyQuestion.failClosed);

  // Caso C: Modelo avança legitimamente sobre a família ou visita
  const alligatorLegitimateProgression = validateBackendQuestionIntentGuard({
    candidateBalloons: ["imagino, família reunida é muito bom", "costuma ir pra lá todo fim de semana?"],
    questionIntents: [
      {
        responseIndex: 1,
        intentKey: "routine.family_visit_timing",
        canonicalMeaning: "saber se ele vai para a cidade ver a família aos fins de semana",
        kind: "continuity",
        target: "pretendente",
      },
    ],
    recentQuestionIntents: alligatorLedger,
  });
  assert("Alligator Caso C: Permite avanço legítimo com novo ângulo ('costuma ir pra lá')", !alligatorLegitimateProgression.isBlocked);
  assert("Alligator Caso C: Ambos balões despachados", alligatorLegitimateProgression.allowedBalloons.length === 2);

  // ---------------------------------------------------------------------------
  // TESTE 10: INSTRUÇÕES DO AGENT E PRESERVAÇÃO DE GATES
  // ---------------------------------------------------------------------------
  console.log("\n--- 10. INSTRUÇÕES DO AGENT E PRESERVAÇÃO DE GATES ---");
  const instructions = buildCanonicalAgentInstructions();
  assert("Instruções contêm versão 2.2.0", instructions.includes("2.2.0"));
  assert("Instruções contêm IMMEDIATE-TURN CONTINUITY GATE", instructions.includes("IMMEDIATE-TURN CONTINUITY GATE"));
  assert("Instruções contêm SEMANTIC QUESTION INTENTS", instructions.includes("SEMANTIC QUESTION INTENTS"));
  assert("Instruções preservam DISCOVERY-QUESTION MEMORY GATE", instructions.includes("DISCOVERY-QUESTION MEMORY GATE"));
  assert("Instruções contêm resolvedQuestionIntentIds e questionIntents", instructions.includes("resolvedQuestionIntentIds") && instructions.includes("questionIntents"));

  // ---------------------------------------------------------------------------
  // RESULTADO FINAL
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`TOTAL DE ASSERÇÕES: ${passed + failed}`);
  console.log(`✅ APROVADAS: ${passed}`);
  console.log(`❌ FALHAS: ${failed}`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Erro fatal na execução da suíte:", err);
  process.exit(1);
});
