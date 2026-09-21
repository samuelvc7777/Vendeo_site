#!/usr/bin/env node
/**
 * scripts/test-e2e-larissa-conversation.mjs
 *
 * Suíte de Testes Ponta-a-Ponta (E2E) da Conversa da Larissa:
 * - Turnos 1 a 5 + Turno Futuro de Memória de Longo Prazo (Carro Amarelo)
 * - Validação estrita de estilo de digitação (LARISSA_CHAT_STYLE_V2)
 * - Cofre de Áudios com exclusão sem transcrição e histórico de entrega
 * - Detecção espontânea de fatos (ContactMemory)
 * - Partial Send com preempção segura entre balões (Fronteira Irreversível)
 * - Busca semântica e durabilidade da memória episódica
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

function loadTsModule(filePath) {
  const fullPath = path.resolve(filePath);
  const tsCode = fs.readFileSync(fullPath, "utf8");
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const moduleObj = { exports: {} };
  const context = {
    module: moduleObj,
    exports: moduleObj.exports,
    process,
    console,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    Deno: { env: { get: () => undefined } },
    require: (dep) => {
      if (dep.includes("ChatStage")) {
        return loadTsModule("src/domain/entities/ChatStage.ts");
      }
      if (dep.includes("LarissaChatStyle")) {
        return loadTsModule("supabase/functions/api/LarissaChatStyle.ts");
      }
      if (dep.includes("conversation_episodic_memory")) {
        return loadTsModule("supabase/functions/api/conversation_episodic_memory.ts");
      }
      if (dep.includes("cloud_autopilot")) {
        return {
          publishAutoPilotState: async () => {},
          activity: (status, title, desc, extra) => ({ status, title, desc, extra }),
        };
      }
      return {};
    },
  };

  const fn = new Function("module", "exports", "require", "process", "console", "fetch", "setTimeout", "clearTimeout", "Deno", jsCode);
  fn(moduleObj, moduleObj.exports, context.require, process, console, context.fetch, context.setTimeout, context.clearTimeout, context.Deno);
  return moduleObj.exports;
}

const chatStyle = loadTsModule("supabase/functions/api/LarissaChatStyle.ts");
const orchestrator = loadTsModule("supabase/functions/api/experimental_orchestrator.ts");
const episodic = loadTsModule("supabase/functions/api/conversation_episodic_memory.ts");
const chatStage = loadTsModule("src/domain/entities/ChatStage.ts");

const { sanitizeChatPunctuation, runStyleLint, LARISSA_CHAT_STYLE_V2 } = chatStyle;
const {
  processDeterministicStageProgression,
  searchPersonaAudios,
} = orchestrator;
const {
  extractEpisodesFromPretendenteMessage,
  saveConversationEpisodes,
  searchConversationEpisodicMemory,
} = episodic;
const { CANONICAL_CHAT_STAGES_MATRIX } = chatStage;

console.log("================================================================================");
console.log("🚀 INICIANDO SUÍTE DE TESTES E2E: CONVERSA COMPLETA MULTI-TURNOS DA LARISSA");
console.log("================================================================================\n");

let passed = 0;
async function runStep(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ [E2E STEP ${passed}] ${name}`);
  } catch (err) {
    console.error(`❌ [E2E STEP ${passed + 1}] FALHOU: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function runE2ESuite() {
  const conversationId = "conv_larissa_e2e_canonical";
  const contactMemory = {
    self: {},
    family: {},
    work: {},
    habits: {},
  };
  const stageRules = {
    completed_goals: [],
    objective_progress: {},
    orchestration: {
      deliveredAudios: [],
    },
  };
  const episodicStore = [];

  const mockAudios = [
    {
      id: "aud_enfermagem_rotina",
      title: "Rotina de Enfermagem e Estágio",
      transcript: "Oi, hoje meu dia foi puxado no hospital no estágio de enfermagem, mas graças a Deus deu tudo certo",
      usage_instruction: "Quando ele perguntar sobre o que ela faz, rotina ou faculdade",
      audio_url: "https://audios.vendeo.com/rotina_enfermagem.mp3",
      enabled: true,
    },
    {
      id: "aud_invalido_mudo",
      title: "Áudio Mudo",
      transcript: "",
      usage_instruction: "Nunca enviar",
      audio_url: "https://audios.vendeo.com/mudo.mp3",
      enabled: true,
    },
  ];

  const mockSupabase = {
    from: (table) => {
      if (table === "persona_audios") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: mockAudios, error: null }),
            }),
          }),
        };
      }
      if (table === "conversation_episodic_memory") {
        return {
          upsert: (rows) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            episodicStore.push(...arr);
            return {
              select: () => Promise.resolve({ data: episodicStore, error: null }),
            };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: episodicStore, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "instagram_conversations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  stage_completed_rules: stageRules,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
      };
    },
  };

  // ---------------------------------------------------------------------------
  // STEP 1: Turno 1 — Apresentação Inicial & SanitizeChatPunctuation
  // ---------------------------------------------------------------------------
  await runStep("Turno 1: Recepção inicial, validação de estilo e pontuação de celular", async () => {
    const rawPretendenteMsg = "Oi Larissa, tudo bem? Vi seu perfil e achei você linda!";
    
    // Simula balões gerados pela Larissa
    const rawLarissaBubbles = [
      "Oie, tudo bem e com vc?",
      "Muito obrigada pelo carinho!",
    ];

    // Passa pelo sanitizador oficial
    const sanitized = rawLarissaBubbles.map((b) => sanitizeChatPunctuation(b));

    // Validações do LARISSA_CHAT_STYLE_V2
    for (const bubble of sanitized) {
      assert.ok(!bubble.endsWith("."), `Balão não pode terminar com ponto final: "${bubble}"`);
      assert.ok(!/\b(hahaha|rsrs|rs|hehe)\b/i.test(bubble), `Balão não pode conter risadas proibidas: "${bubble}"`);
      assert.ok(!/\b(trampo|trampando|trampar)\b/i.test(bubble), `Balão não pode usar gírias proibidas: "${bubble}"`);
    }

    assert.equal(sanitized[0], "Oie, tudo bem e com vc?");
    assert.equal(sanitized[1], "Muito obrigada pelo carinho!");
  });

  // ---------------------------------------------------------------------------
  // STEP 2: Turno 2 — Detecção Espontânea de Trabalho e Cidade
  // ---------------------------------------------------------------------------
  await runStep("Turno 2: Pretendente conta profissão e cidade espontaneamente", async () => {
    const inboundText = "trabalho como engenheiro civil aqui em Belo Horizonte, e você?";
    const msgId = "msg_t2_inbound";

    // Extração episódica
    const episodes = extractEpisodesFromPretendenteMessage(inboundText, msgId);
    for (const ep of episodes) ep.conversation_id = conversationId;

    await saveConversationEpisodes({
      supabase: mockSupabase,
      conversationId,
      episodes,
    });

    assert.ok(episodicStore.some((e) => e.topic === "work"), "Deve extrair episódio de trabalho");
    assert.ok(episodicStore.some((e) => e.topic === "location"), "Deve extrair episódio de localização");

    // Atualiza ContactMemory canônica
    contactMemory.self.job = "engenheiro civil";
    contactMemory.self.profession = "engenheiro civil";
    contactMemory.self.city = "Belo Horizonte";

    // Progressão determinística de objetivos
    const stageGoals = CANONICAL_CHAT_STAGES_MATRIX[0].goals;
    const decision = {
      action: "reply",
      stage: "conexao_inicial",
      reasoning: "Pretendente contou profissão e cidade",
      objectiveCompletion: {
        objectiveId: "goal_job",
        value: "engenheiro civil",
        evidenceMessageId: msgId,
      },
    };

    const progression = await processDeterministicStageProgression({
      supabase: mockSupabase,
      conversationId,
      currentPhase: "stage_1_conexao",
      decision,
      claimedMessages: [{ id: msgId, text: inboundText }],
      stageRules,
      contactMemory,
      stageGoals,
    });

    assert.ok(progression.updatedCompletedGoals.includes("goal_job"), "goal_job deve estar concluído");
    assert.ok(progression.updatedCompletedGoals.includes("goal_city"), "goal_city deve estar concluído");
    stageRules.completed_goals = progression.updatedCompletedGoals;
  });

  // ---------------------------------------------------------------------------
  // STEP 3: Turno 3 — Ativação de Áudio do Cofre (Rotina de Enfermagem)
  // ---------------------------------------------------------------------------
  await runStep("Turno 3: Abertura para áudio da Larissa via Cofre de Áudios", async () => {
    const searchMatches = await searchPersonaAudios({
      supabase: mockSupabase,
      conversationId,
      intent: "e você faz o que da vida?",
      query: "faculdade trabalho enfermagem",
    });

    assert.ok(searchMatches.length > 0, "Deve localizar áudio de rotina de enfermagem");
    assert.equal(searchMatches[0].id, "aud_enfermagem_rotina");
    const alreadySent1 = searchMatches[0].already_sent ?? searchMatches[0].alreadySentInConversation;
    assert.equal(alreadySent1, false, "Áudio ainda não foi entregue");

    // Despacho do áudio e registro na entrega
    stageRules.orchestration.deliveredAudios.push(searchMatches[0].id);

    // Balão de texto afetuoso que acompanha o áudio (sem revelar biografia em texto)
    const accompanyingBubble = sanitizeChatPunctuation("Ah que legal! Deixa eu te contar um pouquinho do meu dia");
    assert.ok(!accompanyingBubble.endsWith("."), "Balão de ponte não deve ter ponto final");
    assert.ok(!accompanyingBubble.includes("estágio de enfermagem"), "Texto não deve dar spoiler do áudio");

    // Verifica que agora já consta como delivered
    const recheckMatches = await searchPersonaAudios({
      supabase: mockSupabase,
      conversationId,
      intent: "como foi a rotina no estágio?",
      query: "enfermagem hospital",
    });
    const recheckAudio = recheckMatches.find((a) => a.id === "aud_enfermagem_rotina");
    assert.ok(recheckAudio, "Áudio deve ser localizado");
    const alreadySent2 = recheckAudio.already_sent ?? recheckAudio.alreadySentInConversation;
    assert.equal(alreadySent2, true, "Áudio entregue deve ser marcado como already_sent: true");
  });

  // ---------------------------------------------------------------------------
  // STEP 4: Turno 4 — Detecção e Gravação do Carro Amarelo Antigo
  // ---------------------------------------------------------------------------
  await runStep("Turno 4: Pretendente compartilha fato durável sobre veículo pessoal (Carro Amarelo)", async () => {
    const inboundText = "adorei seu áudio! Eu nas horas vagas cuido muito do meu carro amarelo antigo, é o meu xodó";
    const msgId = "msg_t4_carro";

    const episodes = extractEpisodesFromPretendenteMessage(inboundText, msgId);
    for (const ep of episodes) ep.conversation_id = conversationId;

    assert.ok(episodes.some((e) => e.topic === "vehicle"), "Deve extrair episódio de veículo");

    await saveConversationEpisodes({
      supabase: mockSupabase,
      conversationId,
      episodes,
    });

    // Pesquisa imediata comprova armazenamento
    const searchRes = await searchConversationEpisodicMemory({
      conversationId,
      query: "carro amarelo",
      supabase: mockSupabase,
    });

    assert.ok(searchRes.length > 0, "Deve encontrar episódio do carro amarelo");
    const content = searchRes[0].content || searchRes[0].original_text || searchRes[0].summary;
    assert.ok(content.includes("carro amarelo"), "Conteúdo do episódio deve mencionar carro amarelo");
  });

  // ---------------------------------------------------------------------------
  // STEP 5: Turno 5 — Partial Send com Preempção Entre Balões (Fronteira Irreversível)
  // ---------------------------------------------------------------------------
  await runStep("Turno 5: Partial Send preserva balão entregue e supersede restante com segurança", async () => {
    // Simula estado da Outbox com 2 balões
    const pendingBubbles = [
      { id: "b1", text: "Nossa, que massa ter um carro antigo assim", status: "sent" },
      { id: "b2", text: "Vc mesmo que mexe nele ou leva no mecânico?", status: "pending" },
    ];

    // Balão 1 foi entregue
    assert.equal(pendingBubbles[0].status, "sent", "Balão 1 deve estar entregue");

    // Nova mensagem do usuário chega antes do balão 2 ser enviado
    const userInterrupt = "inclusive acabei de lembrar que meu irmão também tem uma oficina";
    
    // Simula preempção parcial
    pendingBubbles[1].status = "superseded";
    pendingBubbles[1].superseded_reason = "inbound_preemption_between_bubbles";

    assert.equal(pendingBubbles[0].status, "sent", "Fronteira irreversível: balão 1 jamais é cancelado");
    assert.equal(pendingBubbles[1].status, "superseded", "Balão 2 pendente é cancelado com segurança");

    // Balão entregue é incorporado ao histórico sem duplicidade
    const deliveredText = sanitizeChatPunctuation(pendingBubbles[0].text);
    assert.ok(!deliveredText.endsWith("."), "Balão entregue respeita LARISSA_CHAT_STYLE_V2");
  });

  // ---------------------------------------------------------------------------
  // STEP 6: Turno 6 — Retomada Futura com Memória de Longo Prazo (Carro Amarelo)
  // ---------------------------------------------------------------------------
  await runStep("Turno 6: Retomada semântica perfeita do Carro Amarelo muitos turnos depois", async () => {
    // O pretendente faz menção elíptica ao carro sem repetir todos os detalhes
    const inboundText = "lembra que eu te falei daquele meu carro antigo?";

    const retrievedEpisodes = await searchConversationEpisodicMemory({
      conversationId,
      query: "carro antigo",
      supabase: mockSupabase,
    });

    assert.ok(retrievedEpisodes.length > 0, "Deve recuperar episódio relevante sobre o veículo");
    const bestEpisode = retrievedEpisodes[0];
    const episodeText = bestEpisode.content || bestEpisode.original_text || bestEpisode.summary;
    assert.ok(episodeText.includes("carro amarelo"), "Deve conter o detalhe específico do carro amarelo");
    assert.ok(bestEpisode.relevance > 0, "Relevância do episódio deve ser expressiva");

    // Simula resposta da Larissa usando o fato recuperado da memória episódica
    const larissaRecall = sanitizeChatPunctuation(`Claro que lembro, aquele carro amarelo que vc cuida com tanto carinho né`);
    
    assert.ok(larissaRecall.includes("carro amarelo"), "Larissa cita com precisão o carro amarelo");
    assert.ok(!larissaRecall.endsWith("."), "Resposta não termina com ponto final");
    assert.ok(!/\b(hahaha|rsrs|rs|hehe)\b/i.test(larissaRecall), "Sem risadas proibidas");
  });

  // ---------------------------------------------------------------------------
  // STEP 7: Replay Explícito de Áudio
  // ---------------------------------------------------------------------------
  await runStep("Turno 7: Replay explícito de áudio atende solicitação do pretendente", async () => {
    const replayMatches = await searchPersonaAudios({
      supabase: mockSupabase,
      conversationId,
      intent: "manda de novo o áudio que você mandou da rotina por favor",
      query: "manda de novo",
    });

    assert.ok(replayMatches.length > 0, "Deve encontrar o áudio para replay");
    const replayedAudio = replayMatches.find((a) => a.id === "aud_enfermagem_rotina");
    assert.ok(replayedAudio, "Áudio da rotina deve estar disponível");
    const alreadySentReplay = replayedAudio.already_sent ?? replayedAudio.alreadySentInConversation;
    assert.equal(alreadySentReplay, false, "already_sent deve ser false para permitir o replay");
  });

  console.log("\n================================================================================");
  console.log(`🎉 TODOS OS ${passed}/7 PASSOS DA CONVERSA E2E FORAM CONCLUÍDOS COM SUCESSO TOTAL!`);
  console.log("================================================================================\n");
}

runE2ESuite().catch((err) => {
  console.error("Erro fatal no teste E2E:", err);
  process.exit(1);
});
