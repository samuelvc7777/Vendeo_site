import test from "node:test";
import assert from "node:assert/strict";

import {
  searchPersonaAudios,
  searchCofreAudios,
} from "../supabase/functions/api/brain_orchestrator.ts";

import {
  runConversationQualityGate,
  safeHighConfidenceFallback,
  isOutingInvite,
  detectAcceptedOutingInvite,
  isPhoneRequest,
  detectPhoneNumberLeak,
  isTextRedundantWithAudioTranscript,
  detectMetaBotRoboticLeak,
  detectInappropriateIntimacyLeak,
  sanitizeInappropriateIntimacy,
  isDatingQuestion,
  isChildrenOrMarriageQuestion,
} from "../supabase/functions/api/ConversationQualityGate.ts";

test("DEDUP ABSOLUTO DE ÁUDIOS: Áudio já enviado NUNCA deve ser retornado por searchPersonaAudios nem por searchCofreAudios", async () => {
  const mockAudios = [
    {
      id: "audio_profissao_1",
      title: "Profissão e Estudos",
      transcript: "faço faculdade de enfermagem e estágio em hospital",
      usageInstruction: "Quando perguntar sobre o que ela faz da vida ou faculdade",
      enabled: true,
      duration: 25,
    },
    {
      id: "audio_praia_2",
      title: "Gosta de Praia",
      transcript: "eu amo praia, acho uma delícia tomar sol de biquíni",
      usageInstruction: "Quando perguntar se gosta de praia",
      enabled: true,
      duration: 18,
    }
  ];

  // Simula supabase mock com áudio 1 já entregue no histórico da conversa
  const mockSupabase = {
    __mockPersonaAudios: mockAudios,
    __mockAudioHistory: [
      {
        conversationId: "conv_test_dedup",
        audioId: "audio_profissao_1",
        status: "sent",
      }
    ],
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              stage_completed_rules: {
                orchestration: { deliveredAudios: ["audio_profissao_1"] }
              }
            }
          }),
          in: async () => ({ data: [] }),
          limit: async () => ({ data: [] }),
        }),
        order: () => ({ data: mockAudios }),
      }),
    }),
  };

  // 1. Busca por profissão (que bateria com audio_profissao_1)
  const personaHits = await searchPersonaAudios({
    supabase: mockSupabase,
    conversationId: "conv_test_dedup",
    intent: "o que você faz da vida e onde estuda",
  });

  // O audio_profissao_1 já foi enviado -> NUNCA deve aparecer
  assert.equal(personaHits.some((a) => a.id === "audio_profissao_1"), false, "Áudio já enviado não pode aparecer em searchPersonaAudios");

  // 2. Busca via searchCofreAudios
  const cofreHits = await searchCofreAudios({
    supabase: mockSupabase,
    conversationId: "conv_test_dedup",
    query: "qual sua profissão?",
  });

  assert.equal(cofreHits.some((c) => c.audio_id === "audio_profissao_1"), false, "Áudio já enviado não pode aparecer em searchCofreAudios");

  // 3. Busca por praia (audio_praia_2 não foi enviado -> DEVE aparecer)
  const praiaHits = await searchPersonaAudios({
    supabase: mockSupabase,
    conversationId: "conv_test_dedup",
    intent: "você gosta de praia?",
  });

  assert.equal(praiaHits.some((a) => a.id === "audio_praia_2"), true, "Áudio não enviado deve continuar perfeitamente elegível");
});

test("QUALITY GATE: Larissa NUNCA pode aceitar convite para sair diretamente", () => {
  const defaultContract = {
    directQuestions: [],
    mustAnswerFirst: false,
    newQuestionBudget: 1,
    responseShape: "free_conversation",
    avoidEchoPhrases: [],
    maxBalloons: 3,
    preferNoEmoji: false,
  };

  const inviteInbound = ["vamos sair hoje pra tomar alguma coisa?"];

  // 1. Detectores
  assert.equal(isOutingInvite(inviteInbound[0]), true, "isOutingInvite deve reconhecer convite de sair");
  assert.equal(detectAcceptedOutingInvite("vamos sim! onde a gente vai?"), true, "detectAcceptedOutingInvite deve flaggar aceite direto");
  assert.equal(detectAcceptedOutingInvite("ah hoje não consigo sair, o plantão do hospital me deixou moída kkk"), false, "Recusa gentil não é aceite");

  // 2. Teste no Quality Gate - Resposta inadequada aceitando convite
  const failedResult = runConversationQualityGate({
    inboundMessages: inviteInbound,
    candidateBalloons: ["vamos sim!", "que horas a gente vai?"],
    turnContract: defaultContract,
  });

  assert.equal(failedResult.passed, false, "Aceitar convite para sair deve reprovar no Quality Gate");
  assert.equal(failedResult.issues.some((i) => i.code === "ACCEPTED_OUTING_INVITE"), true, "Deve conter issue ACCEPTED_OUTING_INVITE");

  // 3. Resposta correta da Larissa: desvio gentil com a rotina do hospital
  const passedResult = runConversationQualityGate({
    inboundMessages: inviteInbound,
    candidateBalloons: [
      "ah hoje não consigo sair, o plantão do hospital me deixou moída kkk",
      "mas quem sabe outra hora com calma"
    ],
    turnContract: defaultContract,
  });

  assert.equal(passedResult.issues.some((i) => i.code === "ACCEPTED_OUTING_INVITE"), false, "Recusa gentil com a rotina não gera issue");
});

test("QUALITY GATE: Larissa NUNCA pode passar número de telefone ou WhatsApp", () => {
  const defaultContract = {
    directQuestions: [],
    mustAnswerFirst: false,
    newQuestionBudget: 1,
    responseShape: "free_conversation",
    avoidEchoPhrases: [],
    maxBalloons: 3,
    preferNoEmoji: false,
  };

  const phoneInbound = ["me passa seu whats pra gente conversar por lá"];

  // 1. Detectores
  assert.equal(isPhoneRequest(phoneInbound[0]), true, "isPhoneRequest deve identificar pedido de WhatsApp");
  assert.equal(detectPhoneNumberLeak("meu whats é 31 99876-5432 me chama lá"), true, "detectPhoneNumberLeak deve flaggar vazamento com regex e frase");
  assert.equal(detectPhoneNumberLeak("vamos conversar por aqui no direct primeiro"), false, "Sem telefone não deve flaggar vazamento");

  // 2. Teste no Quality Gate - Vazamento de número
  const leakResult = runConversationQualityGate({
    inboundMessages: phoneInbound,
    candidateBalloons: ["meu whats é 31 99876-5432 me chama lá"],
    turnContract: defaultContract,
  });

  assert.equal(leakResult.passed, false, "Passar número de telefone deve reprovar no Quality Gate");
  assert.equal(leakResult.issues.some((i) => i.code === "PHONE_NUMBER_LEAK"), true, "Deve conter issue PHONE_NUMBER_LEAK");

  // 3. Resposta correta da Larissa: manter no direct com charme
  const properResult = runConversationQualityGate({
    inboundMessages: phoneInbound,
    candidateBalloons: [
      "vamos continuar conversando por aqui no direct primeiro kkk",
      "pra gente ir se conhecendo melhor, o que vc acha?"
    ],
    turnContract: defaultContract,
  });

  assert.equal(properResult.issues.some((i) => i.code === "PHONE_NUMBER_LEAK"), false, "Manter no direct não gera issue de vazamento");
});

test("FALLBACK DE SEGURANÇA: safeHighConfidenceFallback para convites e pedidos de telefone", () => {
  const defaultContract = {
    directQuestions: [],
    mustAnswerFirst: false,
    newQuestionBudget: 1,
    responseShape: "free_conversation",
    avoidEchoPhrases: [],
    maxBalloons: 3,
    preferNoEmoji: false,
  };

  // Fallback para convite de sair
  const outingFallback = safeHighConfidenceFallback(["vamos sair hoje?"], defaultContract);
  assert.ok(outingFallback && outingFallback.length > 0, "Deve gerar fallback para convite de sair");
  assert.equal(outingFallback[0].includes("não consigo sair") || outingFallback[0].includes("hospital"), true, "Fallback de convite deve ter desculpa meiga com rotina");

  // Fallback para telefone
  const phoneFallback = safeHighConfidenceFallback(["passa seu whatsapp"], defaultContract);
  assert.ok(phoneFallback && phoneFallback.length > 0, "Deve gerar fallback para pedido de WhatsApp");
  assert.equal(phoneFallback[0].includes("direct"), true, "Fallback de WhatsApp deve manter no direct com charme");
});

test("ANTI-DUPLICAÇÃO DE ÁUDIO & TEXTO: isTextRedundantWithAudioTranscript poda balão redundante e preserva acolhimento", () => {
  const audioTranscript = "eu faço faculdade de enfermagem, faço estágio durante o dia no hospital e aula teórica à noite, e também trabalho em casa com vendas online pelo celular";

  // 1. O balão exato que ocorreu no bug real
  const bugBalloon = "eu estudo Enfermagem, faço estágio no hospital e tenho aula à noite, tbm trabalho com vendas online em casa";
  assert.equal(
    isTextRedundantWithAudioTranscript(bugBalloon, audioTranscript),
    true,
    "Balão repetindo o trabalho/estudo da Larissa deve ser classificado como redundante com o áudio"
  );

  // 2. Balão de acolhimento ao trabalho do pretendente (soldador)
  const pretendenteReactionBalloon = "nossaa, soldador industrial deve exigir muito foco e força né kkk";
  assert.equal(
    isTextRedundantWithAudioTranscript(pretendenteReactionBalloon, audioTranscript),
    false,
    "Balão de acolhimento ao pretendente NUNCA deve ser classificado como redundante"
  );

  // 3. Balão devolvendo pergunta (reciprocidade)
  const reciprocityBalloon = "e vc, trabalha com oq por aí?";
  assert.equal(
    isTextRedundantWithAudioTranscript(reciprocityBalloon, audioTranscript),
    false,
    "Balão de reciprocidade não pode ser classificado como redundante"
  );

  // 4. Simulação da poda determinística de outboundActions
  const rawActions = [
    { type: "text", text: bugBalloon },
    { type: "text", text: pretendenteReactionBalloon },
    { type: "audio", audioId: "audio_faculdade_trabalho" },
  ];

  const prunedActions = rawActions.filter((act) => {
    if (act.type === "text" && isTextRedundantWithAudioTranscript(act.text, audioTranscript)) {
      return false; // PODADO!
    }
    return true;
  });

  assert.equal(prunedActions.length, 2, "Deverá restar exatamente 2 ações (áudio + texto de acolhimento)");
  assert.equal(prunedActions[0].text, pretendenteReactionBalloon, "O texto que sobrou deve ser o acolhimento ao rapaz");
  assert.equal(prunedActions[1].type, "audio", "O áudio deve ser preservado intacto");
});

test("PROIBIÇÃO DE METALINGUAGEM ROBÓTICA: detectMetaBotRoboticLeak detecta e flagga frases de IA", () => {
  const leaks = [
    "essa parte eu ainda não te contei, amor kkk",
    "meu bem, não quero inventar uma resposta pra vc",
    "não quero inventar nada pra você",
    "não sei te dizer isso sobre mim",
    "meus dados não têm essa informação",
    "como uma ia não posso responder isso",
  ];

  for (const leak of leaks) {
    assert.equal(
      detectMetaBotRoboticLeak(leak),
      true,
      `Deveria detectar vazamento robótico em: "${leak}"`
    );
  }

  const validHuman = [
    "namoro não kkk, tô solteira",
    "sou de São João del-Rei",
    "estudo enfermagem e tô no estágio",
    "nossa nunca kkkkk, não tenho filhos e nunca casei",
  ];

  for (const valid of validHuman) {
    assert.equal(
      detectMetaBotRoboticLeak(valid),
      false,
      `NÃO deveria acusar vazamento robótico em fala humana normal: "${valid}"`
    );
  }
});

test("PROIBIÇÃO DE APELIDOS ÍNTIMOS PRECOCES: detectInappropriateIntimacyLeak e sanitizeInappropriateIntimacy limpam apelidos indevidos", () => {
  const withIntimacy = "essa parte eu ainda não te contei, amor kkk";
  assert.equal(detectInappropriateIntimacyLeak(withIntimacy), true, "Deve detectar 'amor' precoce");

  const sanitized = sanitizeInappropriateIntimacy("essa parte eu ainda não te contei, amor kkk");
  assert.equal(sanitized.includes("amor"), false, "Sanitização deve remover o apelido 'amor'");

  const withMeuBem = "meu bem, tô bem sim e vc?";
  assert.equal(detectInappropriateIntimacyLeak(withMeuBem), true, "Deve detectar 'meu bem' precoce");
  const sanitizedMeuBem = sanitizeInappropriateIntimacy(withMeuBem);
  assert.equal(sanitizedMeuBem.includes("meu bem"), false, "Sanitização deve remover 'meu bem'");
});

test("PERGUNTAS DE NAMORO, FILHOS E CASAMENTO: isDatingQuestion, isChildrenOrMarriageQuestion e safeHighConfidenceFallback", () => {
  assert.equal(isDatingQuestion("Namora bb?"), true, "Deve reconhecer 'Namora bb?' como pergunta de namoro");
  assert.equal(isDatingQuestion("vc tá solteira?"), true, "Deve reconhecer pergunta se tá solteira");
  assert.equal(isChildrenOrMarriageQuestion("vc tem filhos?"), true, "Deve reconhecer pergunta de filhos");
  assert.equal(isChildrenOrMarriageQuestion("já casou alguma vez?"), true, "Deve reconhecer pergunta de casamento");

  const defaultContract = {
    directQuestions: [],
    mustAnswerFirst: true,
    newQuestionBudget: 1,
    responseShape: "free_conversation",
    avoidEchoPhrases: [],
    maxBalloons: 3,
    preferNoEmoji: false,
  };

  // Resposta canônica a pergunta de namoro
  const datingFallback = safeHighConfidenceFallback(["Namora bb?"], defaultContract);
  assert.ok(datingFallback && datingFallback.length > 0, "Deve gerar fallback para pergunta de namoro");
  assert.equal(datingFallback[0], "namoro não kkk, tô solteira", "Primeiro balão deve ser 'namoro não kkk, tô solteira'");

  // Resposta canônica a pergunta de filhos / casamento
  const childrenFallback = safeHighConfidenceFallback(["vc tem filhos ou já casou?"], defaultContract);
  assert.ok(childrenFallback && childrenFallback.length > 0, "Deve gerar fallback para filhos/casamento");
  assert.equal(childrenFallback[0], "nossa nunca kkkkk, não tenho filhos e nunca casei");
  assert.equal(childrenFallback[1], "só namorei uma vez na vida e a experiência nem foi boa kkk");
});

test("QUALITY GATE: ROBOTIC_META_LEAK e UNAUTHORIZED_INTIMACY_LEAK bloqueiam no Quality Gate", () => {
  const defaultContract = {
    directQuestions: [],
    mustAnswerFirst: false,
    newQuestionBudget: 1,
    responseShape: "free_conversation",
    avoidEchoPhrases: [],
    maxBalloons: 3,
    preferNoEmoji: false,
  };

  // Simulação exata da resposta infeliz do pretendente "2G."
  const result = runConversationQualityGate({
    inboundMessages: ["Namora bb?"],
    candidateBalloons: ["essa parte eu ainda não te contei, amor kkk"],
    turnContract: defaultContract,
  });

  assert.equal(result.passed, false, "Resposta com leak robótico e intimidade deve falhar no gate");
  const issueCodes = result.issues.map((i) => i.code);
  assert.ok(issueCodes.includes("ROBOTIC_META_LEAK"), "Deve conter issue ROBOTIC_META_LEAK");
  assert.ok(issueCodes.includes("UNAUTHORIZED_INTIMACY_LEAK"), "Deve conter issue UNAUTHORIZED_INTIMACY_LEAK");
});


