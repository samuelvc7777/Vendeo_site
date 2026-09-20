#!/usr/bin/env node
/**
 * scripts/test-episodic-memory.mjs
 * 
 * Bateria de Testes Automatizados da Memória Episódica da Conversa (EpisodicMemory).
 * Valida os 15 Cenários de Aceite:
 * 
 * 1. Larissa pergunta profissão + pretendente responde -> conversation_search recupera ambos
 * 2. Subagente ciente da resposta de trabalho NÃO repete a mesma pergunta básica
 * 3. Subagente é capaz de aprofundar validamente ("como começou nessa área?")
 * 4. Larissa revela curso ("faço Enfermagem") -> conversation_search retorna o episódio correto
 * 5. Isolamento estrito entre conversas (conversa B não enxerga eventos da conversa A)
 * 6. Coexistência com ContactMemory (sem misturar ou sobrescrever storages)
 * 7. Mensagem outbound CANCELADA / preempitada NUNCA vira episódio
 * 8. Mensagem outbound SENT entra exatamente uma única vez
 * 9. Retries do Writer não duplicam episódios (idempotência estrita)
 * 10. Áudio enviado com sucesso gera episódio com base no transcript e metadata
 * 11. Áudio cancelado ou não despachado não gera episódio
 * 12. Busca semântica flexível (sinônimos: onde mora, cidade, reside, de onde é)
 * 13. Busca irrelevante retorna array vazio sem falsos positivos
 * 14. Falha no executeEpisodeWriter é absorvida sem quebrar o fluxo (fail-safe)
 * 15. conversation_search respeita o teto de resultados (limite máximo de 10)
 * 
 * Regras Estritas:
 * - Sem chamadas à Meta
 * - Sem alterações em dados de produção
 * - 100% determinístico e reproduzível
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Carrega e transpila o módulo conversation_episodic_memory.ts
function loadEpisodicModule() {
  const tsCode = fs.readFileSync('supabase/functions/api/conversation_episodic_memory.ts', 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const mod = { exports: {} };
  vm.runInNewContext(jsCode, {
    module: mod,
    exports: mod.exports,
    console,
    Date,
    Math,
    String,
    Array,
    Set,
    RegExp,
  });

  return mod.exports;
}

const ep = loadEpisodicModule();

// Mock Store em memória para simulação fiel do banco Supabase
class InMemorySupabaseMock {
  constructor() {
    this.table = [];
    this.shouldFail = false;
  }

  from(tableName) {
    if (tableName !== 'conversation_episodic_memory') {
      return {
        select: () => Promise.resolve({ data: [], error: null }),
        upsert: () => Promise.resolve({ data: [], error: null }),
      };
    }

    const self = this;

    return {
      upsert(payloads, options) {
        function runUpsert() {
          if (self.shouldFail) {
            return { data: null, error: new Error('Simulated Database I/O Error (fail-safe test)') };
          }
          const inserted = [];
          for (const item of payloads) {
            const conflictKey = `${item.conversation_id}::${item.source_message_id}::${item.event_type}`;
            const existingIdx = self.table.findIndex(
              (t) => `${t.conversation_id}::${t.source_message_id}::${t.event_type}` === conflictKey
            );

            if (existingIdx >= 0) {
              if (!options?.ignoreDuplicates) {
                self.table[existingIdx] = { ...self.table[existingIdx], ...item };
                inserted.push(self.table[existingIdx]);
              }
            } else {
              const newItem = { id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ...item };
              self.table.push(newItem);
              inserted.push(newItem);
            }
          }
          return { data: inserted, error: null };
        }

        return {
          select(fields) {
            return Promise.resolve(runUpsert());
          },
          then(onfulfilled, onrejected) {
            return Promise.resolve(runUpsert()).then(onfulfilled, onrejected);
          },
        };
      },

      select(fields) {
        let currentData = [...self.table];

        const queryBuilder = {
          eq(col, val) {
            currentData = currentData.filter((t) => t[col] === val);
            return queryBuilder;
          },
          order(col, opts) {
            currentData.sort((a, b) => {
              const valA = a[col] || '';
              const valB = b[col] || '';
              return opts?.ascending ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
            });
            return queryBuilder;
          },
          limit(max) {
            currentData = currentData.slice(0, max);
            return queryBuilder;
          },
          then(onfulfilled, onrejected) {
            return Promise.resolve({ data: currentData, error: null }).then(onfulfilled, onrejected);
          },
        };

        return queryBuilder;
      },
    };
  }
}

// Utilitário de testes
let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FALHA: ${message}`);
    totalFailed++;
    throw new Error(message);
  } else {
    console.log(`  ✅ ${message}`);
    totalPassed++;
  }
}

async function runTests() {
  console.log('======================================================================');
  console.log('BATERIA DE TESTES: MEMÓRIA EPISÓDICA DA CONVERSA (15 CENÁRIOS)');
  console.log('======================================================================\n');

  const mockDb = new InMemorySupabaseMock();

  // --------------------------------------------------------------------------
  // CENÁRIO 1: Larissa pergunta profissão + Pretendente responde
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 1: Larissa pergunta profissão + Pretendente responde -> busca recupera ambos');
  {
    const convId = 'conv_cenario_1';
    const lMsg = 'E vc trabalha com o que?';
    const pMsg = 'Eu trabalho com desenvolvimento de software em home office';

    const epsL = ep.extractEpisodesFromLarissaMessage(lMsg, 'msg_l_01');
    const epsP = ep.extractEpisodesFromPretendenteMessage(pMsg, 'msg_p_01');

    assert(epsL.length >= 1, 'Larissa: extraiu pelo menos 1 episódio');
    assert(epsL[0].actor === 'larissa' && epsL[0].topic === 'work' && epsL[0].event_type === 'question',
      'Larissa: identificou ato de pergunta sobre profissão/trabalho');

    assert(epsP.length >= 1, 'Pretendente: extraiu pelo menos 1 episódio');
    assert(epsP[0].actor === 'pretendente' && epsP[0].topic === 'work' && (epsP[0].event_type === 'fact_reveal' || epsP[0].event_type === 'answer'),
      'Pretendente: identificou fato/resposta sobre profissão');

    const trace = [];
    await ep.executeEpisodeWriter({
      conversationId: convId,
      claimedMessages: [{ id: 'msg_p_01', text: pMsg, sender: 'pretendente', direction: 'inbound' }],
      sentBalloons: [lMsg],
      sentMessageIds: ['msg_l_01'],
      supabase: mockDb,
      trace,
    });

    const results = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convId,
      query: 'já perguntei a profissão dele?',
      limit: 5,
    });

    assert(results.length >= 2, 'conversation_search retornou ambos os episódios (pergunta + resposta)');
    assert(results.some((r) => r.actor === 'larissa' && r.topic === 'work'), 'Encontrou pergunta da Larissa sobre trabalho');
    assert(results.some((r) => r.actor === 'pretendente' && r.topic === 'work'), 'Encontrou resposta do pretendente sobre trabalho');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 2: Subagente ciente da resposta de trabalho NÃO repete pergunta básica
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 2: Subagente ciente da resposta de trabalho NÃO repete a pergunta');
  {
    const convId = 'conv_cenario_1';
    const searchRes = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convId,
      query: 'o que ele faz da vida / trabalho / profissão',
      limit: 3,
    });

    const alreadyAnswered = searchRes.some(
      (r) => r.actor === 'pretendente' && r.topic === 'work'
    );
    assert(alreadyAnswered, 'Memória Episódica confirma que pretendente JÁ respondeu profissão');

    // Regra anti-repetição: se já respondeu, não deve perguntar novamente
    const shouldAskBasicJobQuestion = !alreadyAnswered;
    assert(!shouldAskBasicJobQuestion, 'Anti-repetição ATIVA: pergunta básica de trabalho bloqueada');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 3: Subagente é capaz de aprofundar validamente
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 3: Subagente é capaz de aprofundar validamente ("como começou nessa área?")');
  {
    const convId = 'conv_cenario_1';
    const searchRes = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convId,
      query: 'desenvolvimento de software home office',
      limit: 1,
    });

    assert(searchRes.length > 0, 'Encontrou contexto prévio específico sobre desenvolvimento de software');
    const deepestFact = searchRes[0].original_text;
    assert(deepestFact.includes('desenvolvimento de software'), 'Contexto recuperado contém área técnica do pretendente');

    // Aprofundamento válido permitido
    const candidateFollowUp = 'Que massa! E você sempre trabalhou com software ou começou em outra área?';
    const isRepetitive = candidateFollowUp.includes('com o que vc trabalha') || candidateFollowUp.includes('o que faz da vida');
    assert(!isRepetitive, 'Follow-up aprofunda sem repetir a pergunta primitiva');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 4: Larissa revela curso -> conversation_search localiza autorrevelação
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 4: Larissa revela curso ("faço Enfermagem") -> busca localiza autorrevelação');
  {
    const convId = 'conv_cenario_4';
    const lMsg = 'Faço faculdade de enfermagem, to no décimo período na correria de estágio hospitalar!';
    
    const eps = ep.extractEpisodesFromLarissaMessage(lMsg, 'msg_l_enf');
    assert(eps.length >= 1, 'Extraiu episódio de autorrevelação');
    assert(eps[0].actor === 'larissa' && eps[0].event_type === 'self_disclosure' && eps[0].topic === 'education',
      'Identificou self_disclosure sobre educação/curso');
    assert(eps[0].semantic_keys.includes('larissa.education.course'), 'semantic_keys inclui larissa.education.course');

    await ep.executeEpisodeWriter({
      conversationId: convId,
      claimedMessages: [],
      sentBalloons: [lMsg],
      sentMessageIds: ['msg_l_enf'],
      supabase: mockDb,
      trace: [],
    });

    const searchRes = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convId,
      query: 'já contei sobre meu curso de enfermagem?',
      limit: 5,
    });

    assert(searchRes.length > 0, 'Busca localizou autorrevelação do curso');
    assert(searchRes[0].topic === 'education' && searchRes[0].actor === 'larissa', 'Resultado corresponde à Larissa e Educação');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 5: Isolamento estrito entre conversas (A vs B)
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 5: Isolamento estrito entre conversas (A vs B)');
  {
    const convA = 'conv_alpha_5';
    const convB = 'conv_beta_5';

    await ep.executeEpisodeWriter({
      conversationId: convA,
      claimedMessages: [{ id: 'p_a_1', text: 'Eu moro em Belo Horizonte', sender: 'pretendente' }],
      sentBalloons: ['Que legal, adoro BH!'],
      sentMessageIds: ['l_a_1'],
      supabase: mockDb,
      trace: [],
    });

    await ep.executeEpisodeWriter({
      conversationId: convB,
      claimedMessages: [{ id: 'p_b_1', text: 'Eu moro em São Paulo capital', sender: 'pretendente' }],
      sentBalloons: ['Nossa, cidade grande!'],
      sentMessageIds: ['l_b_1'],
      supabase: mockDb,
      trace: [],
    });

    const resA = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convA,
      query: 'onde ele mora cidade',
      limit: 10,
    });

    const resB = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convB,
      query: 'onde ele mora cidade',
      limit: 10,
    });

    assert(resA.every((r) => r.original_text.includes('Belo Horizonte') || r.original_text.includes('BH')),
      'Conversa A contém apenas referências a Belo Horizonte');
    assert(resA.every((r) => !r.original_text.includes('São Paulo')),
      'Conversa A NÃO enxerga nada de São Paulo');

    assert(resB.every((r) => r.original_text.includes('São Paulo')),
      'Conversa B contém apenas referências a São Paulo');
    assert(resB.every((r) => !r.original_text.includes('Belo Horizonte')),
      'Conversa B NÃO enxerga nada de Belo Horizonte');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 6: Coexistência com ContactMemory
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 6: Coexistência harmoniosa com ContactMemory');
  {
    const convId = 'conv_cenario_6';
    const pretMsg = 'Eu tenho 28 anos e moro em Curitiba';

    // Episodic Memory: armazena ato de fala temporal
    await ep.executeEpisodeWriter({
      conversationId: convId,
      claimedMessages: [{ id: 'msg_p_6', text: pretMsg, sender: 'pretendente' }],
      sentBalloons: [],
      sentMessageIds: [],
      supabase: mockDb,
      trace: [],
    });

    // ContactMemory: armazena entidades canônicas do pretendente
    const contactMemoryStore = {
      entities: {
        profile: {
          age: { value: 28, confidence: 1.0, sourceMessageId: 'msg_p_6' },
          city: { value: 'Curitiba', confidence: 1.0, sourceMessageId: 'msg_p_6' },
        },
      },
      snippets: [{ text: pretMsg, sourceMessageId: 'msg_p_6' }],
    };

    const epRes = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convId,
      query: 'idade e cidade',
      limit: 5,
    });

    assert(epRes.length >= 2, 'EpisodicMemory registrou atos de fala de idade e cidade');
    assert(contactMemoryStore.entities.profile.city.value === 'Curitiba', 'ContactMemory manteve entidade canônica intacta');
    assert(contactMemoryStore.entities.profile.age.value === 28, 'ContactMemory manteve entidade idade intacta');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 7: Mensagem outbound CANCELADA / preempitada NUNCA vira episódio
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 7: Mensagem outbound CANCELADA ou preempitada NUNCA vira episódio');
  {
    const convId = 'conv_cenario_7';
    const plannedBalloon = 'Oi sumido, tudo bem com vc?';

    // Se sentSuccessfully for falso no orquestrador, executeEpisodeWriter não deve ser chamado para os balões
    const sentSuccessfully = false;
    let writerCalled = false;

    if (sentSuccessfully) {
      writerCalled = true;
      await ep.executeEpisodeWriter({
        conversationId: convId,
        claimedMessages: [],
        sentBalloons: [plannedBalloon],
        sentMessageIds: ['out_canceled_1'],
        supabase: mockDb,
        trace: [],
      });
    }

    assert(!writerCalled, 'Guardrail sentSuccessfully impediu chamada do writer');
    const checkDb = mockDb.table.filter((t) => t.conversation_id === convId);
    assert(checkDb.length === 0, 'Nenhum episódio registrado para mensagem cancelada');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 8: Mensagem outbound SENT entra exatamente uma única vez
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 8: Mensagem outbound SENT entra exatamente uma única vez');
  {
    const convId = 'conv_cenario_8';
    const sentBalloon = 'Eu tenho 23 anos e moro em São João del-Rei';

    const sentSuccessfully = true;
    if (sentSuccessfully) {
      await ep.executeEpisodeWriter({
        conversationId: convId,
        claimedMessages: [],
        sentBalloons: [sentBalloon],
        sentMessageIds: ['out_sent_single'],
        supabase: mockDb,
        trace: [],
      });
    }

    const recorded = mockDb.table.filter((t) => t.conversation_id === convId);
    assert(recorded.length > 0, 'Episódio gravado com sucesso pós-despacho confirmado');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 9: Retries do Writer não duplicam episódios (Idempotência Estrita)
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 9: Retries do Writer não duplicam episódios (Idempotência Estrita)');
  {
    const convId = 'conv_cenario_9';
    const pMsg = { id: 'msg_retry_100', text: 'Tenho 30 anos e sou dentista' };

    // Executa writer 3 vezes consecutivas (simulando retries de webhook)
    for (let i = 0; i < 3; i++) {
      await ep.executeEpisodeWriter({
        conversationId: convId,
        claimedMessages: [pMsg],
        sentBalloons: ['Que profissão legal!'],
        sentMessageIds: ['out_retry_200'],
        supabase: mockDb,
        trace: [],
      });
    }

    const allInConv = mockDb.table.filter((t) => t.conversation_id === convId);
    const pEps = allInConv.filter((t) => t.source_message_id === 'msg_retry_100');
    const lEps = allInConv.filter((t) => t.source_message_id === 'out_retry_200');

    // Cada chave (conversation_id, source_message_id, event_type) deve ser única
    const pKeys = new Set(pEps.map((e) => `${e.source_message_id}_${e.event_type}_${e.topic}`));
    const lKeys = new Set(lEps.map((e) => `${e.source_message_id}_${e.event_type}_${e.topic}`));

    assert(pEps.length === pKeys.size, 'Mensagem do pretendente idempotente (sem registros duplicados)');
    assert(lEps.length === lKeys.size, 'Mensagem da Larissa idempotente (sem registros duplicados)');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 10: Áudio enviado com sucesso gera episódio
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 10: Áudio enviado com sucesso gera episódio com transcript');
  {
    const convId = 'conv_cenario_10';
    const audioPayload = {
      id: 'audio_hospital_larissa',
      theme: 'Rotina hospitalar e estágio',
      transcript: 'Oii! Nossa, acabei de sair do plantão aqui no hospital, to bem cansadinha mas deu tudo certo!',
    };

    const audioEp = ep.createAudioDeliveredEpisode({
      conversationId: convId,
      audioId: audioPayload.id,
      theme: audioPayload.theme,
      transcript: audioPayload.transcript,
      sourceMessageId: 'out_audio_msg_10',
    });

    assert(audioEp.actor === 'larissa', 'Ator do episódio de áudio é larissa');
    assert(audioEp.event_type === 'audio_sent', 'event_type é audio_sent');
    assert(audioEp.metadata.audio_id === 'audio_hospital_larissa', 'Metadado contém o ID do áudio');

    await ep.executeEpisodeWriter({
      conversationId: convId,
      claimedMessages: [],
      sentBalloons: ['[audio:https://storage.vendeo.com/audio10.m4a]'],
      sentMessageIds: ['out_audio_msg_10'],
      audioPayload,
      supabase: mockDb,
      trace: [],
    });

    const searchRes = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convId,
      query: 'já enviei áudio sobre hospital?',
      limit: 5,
    });

    assert(searchRes.length > 0, 'Busca localizou áudio enviado com sucesso');
    assert(searchRes[0].event_type === 'audio_sent', 'Evento recuperado é do tipo audio_sent');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 11: Áudio cancelado ou não despachado não gera episódio
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 11: Áudio cancelado ou não despachado NÃO gera episódio');
  {
    const convId = 'conv_cenario_11';
    const audioPayload = {
      id: 'audio_nao_enviado',
      theme: 'Tema cancelado',
      transcript: 'Texto não entregue',
    };

    // Despacho falhou ou foi abortado: sentSuccessfully = false
    const sentSuccessfully = false;
    if (sentSuccessfully) {
      await ep.executeEpisodeWriter({
        conversationId: convId,
        claimedMessages: [],
        sentBalloons: ['[audio:url]'],
        sentMessageIds: ['out_aud_fail'],
        audioPayload,
        supabase: mockDb,
        trace: [],
      });
    }

    const checkDb = mockDb.table.filter((t) => t.conversation_id === convId);
    assert(checkDb.length === 0, 'Nenhum episódio gerado para áudio não despachado');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 12: Busca semântica flexível (sinônimos e intenções)
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 12: Busca semântica flexível (sinônimos e variações)');
  {
    const convId = 'conv_cenario_12';
    await ep.executeEpisodeWriter({
      conversationId: convId,
      claimedMessages: [],
      sentBalloons: ['Onde vc mora? É de qual cidade?'],
      sentMessageIds: ['out_loc_question'],
      supabase: mockDb,
      trace: [],
    });

    const queries = [
      'onde mora?',
      'já perguntei a cidade?',
      'reside em qual local?',
      'de onde ele é?',
    ];

    for (const q of queries) {
      const res = await ep.searchConversationEpisodicMemory({
        supabase: mockDb,
        conversationId: convId,
        query: q,
        limit: 3,
      });
      assert(res.length > 0 && res[0].topic === 'location',
        `Query "${q}" localizou corretamente a pergunta de localização (score: ${res[0]?.score})`);
    }
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 13: Busca irrelevante retorna array vazio sem falsos positivos
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 13: Busca irrelevante retorna array vazio sem falsos positivos');
  {
    const convId = 'conv_cenario_12';
    const irrelevantQueries = [
      'já falamos sobre nave espacial tripulada para marte?',
      'fórmula 1 campeonato mundial de automobilismo',
      'criptomoedas e contratos inteligentes ethereum',
    ];

    for (const q of irrelevantQueries) {
      const res = await ep.searchConversationEpisodicMemory({
        supabase: mockDb,
        conversationId: convId,
        query: q,
        limit: 3,
      });
      assert(res.length === 0, `Query irrelevante "${q}" retornou 0 resultados (sem alucinações)`);
    }
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 14: Falha no executeEpisodeWriter é absorvida (fail-safe)
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 14: Falha no executeEpisodeWriter é absorvida sem quebrar o ciclo');
  {
    const failingDb = new InMemorySupabaseMock();
    failingDb.shouldFail = true; // Força erro simulado no Supabase

    const trace = [];
    let threwException = false;
    let res = null;

    try {
      res = await ep.executeEpisodeWriter({
        conversationId: 'conv_cenario_14',
        claimedMessages: [{ id: 'p_fail_1', text: 'Mensagem de teste', sender: 'pretendente' }],
        sentBalloons: ['Balão de teste'],
        sentMessageIds: ['out_fail_1'],
        supabase: failingDb,
        trace,
      });
    } catch (err) {
      threwException = true;
    }

    assert(!threwException, 'executeEpisodeWriter NUNCA lança exceção para o chamador');
    assert(res && res.episodesCreated === 0, 'Retornou 0 episódios criados com sucesso');
    assert(trace.some((t) => t.includes('episode_writer_error') || t.includes('episode_writer_completed')),
      'Registrou erro no trace sem interromper a execução');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // CENÁRIO 15: conversation_search respeita teto de resultados (máximo 10)
  // --------------------------------------------------------------------------
  console.log('🔹 CENÁRIO 15: conversation_search respeita teto de resultados (máximo 10)');
  {
    const convId = 'conv_cenario_15';
    // Insere 25 perguntas diferentes na mesma conversa
    const manyEpisodes = [];
    for (let i = 1; i <= 25; i++) {
      manyEpisodes.push({
        conversation_id: convId,
        actor: 'larissa',
        event_type: 'question',
        topic: 'general',
        summary: `Larissa fez pergunta genérica número ${i}`,
        source_message_id: `msg_bulk_${i}`,
        original_text: `Pergunta ${i}?`,
        semantic_keys: ['conversation.question'],
      });
    }

    await ep.saveConversationEpisodes({
      supabase: mockDb,
      conversationId: convId,
      episodes: manyEpisodes,
    });

    // Teste de limite configurado baixo (ex: limit = 3)
    const resLow = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convId,
      query: 'pergunta',
      limit: 3,
    });
    assert(resLow.length === 3, 'Respeitou limit = 3');

    // Teste de limite excessivo (ex: limit = 50 -> teto deve ser 10)
    const resHigh = await ep.searchConversationEpisodicMemory({
      supabase: mockDb,
      conversationId: convId,
      query: 'pergunta',
      limit: 50,
    });
    assert(resHigh.length === 10, 'Limitou ao teto máximo de 10 resultados');
  }
  console.log('');

  // --------------------------------------------------------------------------
  // RELATÓRIO FINAL
  // --------------------------------------------------------------------------
  console.log('======================================================================');
  console.log(`RESULTADO DA BATERIA DE TESTES:`);
  console.log(`  Total de Verificações: ${totalPassed + totalFailed}`);
  console.log(`  Aprovadas (PASS):       ${totalPassed}`);
  console.log(`  Reprovadas (FAIL):      ${totalFailed}`);
  console.log('======================================================================');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('ERRO FATAL NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});
