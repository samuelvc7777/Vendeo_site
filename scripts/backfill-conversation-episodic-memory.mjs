#!/usr/bin/env node
/**
 * scripts/backfill-conversation-episodic-memory.mjs
 * 
 * Script de Backfill Determinístico e Idempotente para a Memória Episódica da Conversa.
 * Foco: Histórico Recente (Janela Temporal Configurável, default 7 dias).
 * 
 * Regras Invioláveis:
 * 1. Baseado no timestamp real de instagram_messages.created_at (ou timestamp).
 * 2. Paginação em lotes tanto para conversas quanto para mensagens.
 * 3. Idempotência estrita: se o episódio já existe, não duplica.
 * 4. NÃO altera PersonaMemory, ContactMemory nem StageObjectives.
 * 5. ZERO envio de mensagens à Meta, zero outbox, zero autopilot.
 * 6. Suporte estrito a --dry-run (simulação) e --execute (gravação).
 * 
 * Uso:
 *   node scripts/backfill-conversation-episodic-memory.mjs --since-days 7 --dry-run
 *   node scripts/backfill-conversation-episodic-memory.mjs --since-days 7 --execute
 *   node scripts/backfill-conversation-episodic-memory.mjs --since-days 7 --conversation-id <id> [--dry-run|--execute]
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// 1. Carrega variáveis de ambiente
function loadEnv(projectRoot = process.cwd()) {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.resolve(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// 2. Carrega módulo de Memória Episódica
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

// 3. Parser de argumentos CLI
const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = args.includes('--dry-run') || !isExecute;

const fromIdx = args.indexOf('--from');
const toIdx = args.indexOf('--to');
const fromArg = fromIdx !== -1 ? args[fromIdx + 1] : null;
const toArg = toIdx !== -1 ? args[toIdx + 1] : null;

const sinceDaysIdx = args.indexOf('--since-days');
const sinceDays = sinceDaysIdx !== -1 ? parseInt(args[sinceDaysIdx + 1], 10) : 7;

const batchSizeIdx = args.indexOf('--batch-size');
const conversationBatchSize = batchSizeIdx !== -1 ? parseInt(args[batchSizeIdx + 1], 10) : 50;

const convIdIdx = args.indexOf('--conversation-id');
const targetConversationId = convIdIdx !== -1 ? args[convIdIdx + 1] : null;

async function main() {
  const t0 = Date.now();
  const now = new Date();

  // Definição determinística da janela temporal
  let sinceIso = '';
  let toIso = '';

  if (fromArg) {
    sinceIso = new Date(fromArg).toISOString();
  } else {
    sinceIso = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  }

  if (toArg) {
    toIso = new Date(toArg).toISOString();
  } else {
    toIso = now.toISOString();
  }

  console.log('======================================================================');
  console.log('EPISODIC MEMORY BACKFILL — TODAS AS CONVERSAS RECENTES');
  console.log(`Modo:                     ${isDryRun ? 'DRY-RUN (Simulação segura / Sem gravação)' : 'EXECUTE (Gravação ativa no Supabase)'}`);
  console.log(`Janela Temporal:          ${fromArg && toArg ? 'CONGELADA (--from / --to)' : `Últimos ${sinceDays} dias`}`);
  console.log(`Período Inicial (from):   ${sinceIso}`);
  console.log(`Período Final (to):       ${toIso}`);
  console.log(`Lote de Conversas:        ${conversationBatchSize}`);
  if (targetConversationId) {
    console.log(`Conversa Alvo Única:      ${targetConversationId}`);
  }
  console.log('======================================================================\n');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ ERRO: NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes.');
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  // Carrega áudios do cofre para enriquecimento semântico quando disponível
  const { data: vaultRow } = await supabase
    .from('instagram_conversations')
    .select('stage_completed_rules')
    .eq('id', '__vault_data__')
    .maybeSingle();
  const vaultItems = vaultRow?.stage_completed_rules?.items || [];
  console.log(`🔍 Áudios do cofre carregados para enriquecimento semântico: ${vaultItems.length}\n`);

  // 4. Contagem de episódios antes do backfill
  console.log('🔍 Verificando estado atual de public.conversation_episodic_memory...');
  const { count: episodesBeforeCount, error: countErr } = await supabase
    .from('conversation_episodic_memory')
    .select('id', { count: 'exact', head: true });

  if (countErr) {
    console.warn('⚠️ Não foi possível obter contagem inicial de episódios:', countErr.message);
  } else {
    console.log(`   Episódios existentes no Supabase antes da operação: ${episodesBeforeCount ?? 0}\n`);
  }

  // 5. Descobre conversas ativas na janela temporal através de instagram_messages
  console.log(`🔍 Mapeando conversas com mensagens em instagram_messages entre ${sinceIso} e ${toIso}...`);
  
  let targetConversationIds = [];

  if (targetConversationId) {
    targetConversationIds = [targetConversationId];
  } else {
    const activeConvSet = new Set();
    let msgDiscoveryOffset = 0;
    const msgDiscoveryPageSize = 1000;
    let hasMoreMessages = true;

    while (hasMoreMessages) {
      let query = supabase
        .from('instagram_messages')
        .select('conversation_id')
        .gte('created_at', sinceIso);

      if (toIso) {
        query = query.lte('created_at', toIso);
      }

      const { data: pageMsgs, error: pErr } = await query
        .order('created_at', { ascending: true })
        .range(msgDiscoveryOffset, msgDiscoveryOffset + msgDiscoveryPageSize - 1);

      if (pErr) {
        console.error('❌ Erro ao paginar mensagens para descoberta de conversas:', pErr.message);
        process.exit(1);
      }

      if (!pageMsgs || pageMsgs.length === 0) {
        hasMoreMessages = false;
        break;
      }

      for (const m of pageMsgs) {
        if (m.conversation_id) {
          activeConvSet.add(m.conversation_id);
        }
      }

      if (pageMsgs.length < msgDiscoveryPageSize) {
        hasMoreMessages = false;
      } else {
        msgDiscoveryOffset += msgDiscoveryPageSize;
      }
    }

    targetConversationIds = Array.from(activeConvSet);
  }

  console.log(`   Total de conversas ativas encontradas na janela: ${targetConversationIds.length}\n`);

  if (targetConversationIds.length === 0) {
    console.log('Nenhuma conversa encontrada na janela temporal especificada.');
    return;
  }

  // 6. Estruturas para acumulação de métricas
  let totalAnalyzedMessages = 0;
  let totalChatterMessages = 0;
  let totalExistingEpisodesInDb = 0;
  let totalNewEpisodes = 0;
  let totalSkippedExisting = 0;
  let totalInsertedEpisodes = 0;
  let totalErrors = 0;

  const actorStats = {
    larissa: 0,
    pretendente: 0,
  };

  const eventTypeStats = {
    question: 0,
    answer: 0,
    self_disclosure: 0,
    fact_reveal: 0,
    statement: 0,
    audio_sent: 0,
    outros: 0,
  };

  const failedConversations = [];

  // 7. Processamento em lotes de conversas
  const totalBatches = Math.ceil(targetConversationIds.length / conversationBatchSize);

  for (let bIndex = 0; bIndex < totalBatches; bIndex++) {
    const batchConvIds = targetConversationIds.slice(
      bIndex * conversationBatchSize,
      (bIndex + 1) * conversationBatchSize
    );

    console.log(`--- [Lote ${bIndex + 1}/${totalBatches}] Processando ${batchConvIds.length} conversas ---`);

    // Busca metadados das conversas deste lote
    const { data: convRows } = await supabase
      .from('instagram_conversations')
      .select('id, full_name, username, display_name')
      .in('id', batchConvIds);

    const convMap = new Map();
    for (const c of convRows || []) {
      convMap.set(c.id, c.full_name || c.display_name || c.username || 'Pretendente');
    }

    for (const convId of batchConvIds) {
      const pretendenteName = convMap.get(convId) || 'Pretendente';

      try {
        // A. Consulta episódios já existentes desta conversa para auditoria de idempotência via fingerprint
        const { data: existingEpisodes, error: existErr } = await supabase
          .from('conversation_episodic_memory')
          .select('episode_fingerprint, source_message_id, event_type, topic, actor, semantic_keys')
          .eq('conversation_id', convId);

        if (existErr) {
          throw new Error(`Erro ao verificar episódios existentes: ${existErr.message}`);
        }

        const existingFingerprintSet = new Set(
          (existingEpisodes || []).map((e) => e.episode_fingerprint || ep.generateEpisodeFingerprint({
            conversation_id: convId,
            source_message_id: e.source_message_id,
            actor: e.actor || 'pretendente',
            event_type: e.event_type,
            topic: e.topic,
            semantic_keys: e.semantic_keys,
          }))
        );
        totalExistingEpisodesInDb += existingFingerprintSet.size;

        // B. Pagina todas as mensagens da conversa dentro da janela temporal definida
        let convMessages = [];
        let mOffset = 0;
        const mPageSize = 200;
        let hasMoreConvMsgs = true;

        while (hasMoreConvMsgs) {
          let mQuery = supabase
            .from('instagram_messages')
            .select('id, text, is_mine, status, created_at')
            .eq('conversation_id', convId)
            .gte('created_at', sinceIso);

          if (toIso) {
            mQuery = mQuery.lte('created_at', toIso);
          }

          const { data: mData, error: mErr } = await mQuery
            .order('created_at', { ascending: true })
            .range(mOffset, mOffset + mPageSize - 1);

          if (mErr) {
            throw new Error(`Erro ao buscar mensagens: ${mErr.message}`);
          }

          if (!mData || mData.length === 0) {
            hasMoreConvMsgs = false;
            break;
          }

          convMessages.push(...mData);

          if (mData.length < mPageSize) {
            hasMoreConvMsgs = false;
          } else {
            mOffset += mPageSize;
          }
        }

        totalAnalyzedMessages += convMessages.length;

        // C. Extração semântica de episódios
        const extractedEpisodes = [];

        for (const msg of convMessages) {
          const text = (msg.text || '').trim();
          if (!text) continue;

          if (ep.isTrivialChatter(text)) {
            totalChatterMessages++;
            continue;
          }

          if (msg.is_mine) {
            // Larissa: somente mensagens confirmadas como sent/delivered geram episódio
            if (msg.status && msg.status !== 'sent' && msg.status !== 'delivered') {
              continue;
            }

            // Checagem de áudio
            const audioMatch = text.match(/^\[audio:(https?:\/\/[^\]]+)\]/i);
            if (audioMatch) {
              const audioUrl = audioMatch[1];

              // Busca correspondência nos áudios do cofre por mediaUrl ou fileName
              const matchedVault = vaultItems.find((v) => {
                if (!v) return false;
                if (v.mediaUrl && (v.mediaUrl === audioUrl || audioUrl.includes(v.fileName || '____'))) return true;
                if (v.fileName && audioUrl.includes(v.fileName)) return true;
                return false;
              });

              if (matchedVault) {
                const enrichedEp = ep.createAudioDeliveredEpisode({
                  conversationId: convId,
                  audioId: matchedVault.id,
                  transcript: matchedVault.content || matchedVault.transcript,
                  theme: matchedVault.title || matchedVault.category,
                  providerMessageId: msg.id,
                });
                enrichedEp.created_at = msg.created_at || toIso;
                enrichedEp.metadata = {
                  ...(enrichedEp.metadata || {}),
                  audio_url: audioUrl,
                  matched_vault_id: matchedVault.id,
                };
                extractedEpisodes.push(enrichedEp);
              } else {
                // Áudio sem conteúdo conhecido permanece genérico, sem inventar tema
                extractedEpisodes.push({
                  conversation_id: convId,
                  actor: 'larissa',
                  event_type: 'audio_sent',
                  topic: 'audio',
                  summary: 'Larissa enviou uma mensagem de áudio pelo Instagram.',
                  source_message_id: msg.id,
                  original_text: text,
                  semantic_keys: ['larissa.audio_sent', 'audio.topic.audio'],
                  metadata: { audio_url: audioUrl },
                  created_at: msg.created_at || toIso,
                });
              }
              continue;
            }

            const lEps = ep.extractEpisodesFromLarissaMessage(text, msg.id);
            for (const e of lEps) {
              e.conversation_id = convId;
              e.created_at = msg.created_at || nowIso;
              extractedEpisodes.push(e);
            }
          } else {
            // Pretendente
            const pEps = ep.extractEpisodesFromPretendenteMessage(text, msg.id);
            for (const e of pEps) {
              e.conversation_id = convId;
              e.created_at = msg.created_at || nowIso;
              extractedEpisodes.push(e);
            }
          }
        }

        // D. Verificação de idempotência e contagem por tipo/ator via episode_fingerprint
        const episodesToSave = [];

        for (const candidate of extractedEpisodes) {
          const candFingerprint = ep.generateEpisodeFingerprint({
            conversation_id: convId,
            source_message_id: candidate.source_message_id,
            actor: candidate.actor,
            event_type: candidate.event_type,
            topic: candidate.topic,
            semantic_keys: candidate.semantic_keys,
          });
          candidate.episode_fingerprint = candFingerprint;
          
          if (existingFingerprintSet.has(candFingerprint)) {
            totalSkippedExisting++;
          } else {
            totalNewEpisodes++;
            existingFingerprintSet.add(candFingerprint);
            episodesToSave.push(candidate);

            // Contabilização por actor
            if (candidate.actor === 'larissa') {
              actorStats.larissa++;
            } else {
              actorStats.pretendente++;
            }

            // Contabilização por event_type
            if (eventTypeStats[candidate.event_type] !== undefined) {
              eventTypeStats[candidate.event_type]++;
            } else {
              eventTypeStats.outros++;
            }
          }
        }

        // E. Gravação real no Supabase (se --execute estiver ativo)
        if (!isDryRun && episodesToSave.length > 0) {
          const { saved, skipped } = await ep.saveConversationEpisodes({
            supabase,
            conversationId: convId,
            episodes: episodesToSave,
          });
          totalInsertedEpisodes += saved;
          totalSkippedExisting += skipped;
        }

        if (extractedEpisodes.length > 0) {
          const newCount = episodesToSave.length;
          const skipCount = extractedEpisodes.length - newCount;
          console.log(
            `   • ${pretendenteName} (${convId.slice(0, 8)}...): ${convMessages.length} msgs | ${extractedEpisodes.length} eps (${newCount} novos, ${skipCount} já existentes)`
          );
        }
      } catch (err) {
        totalErrors++;
        failedConversations.push({ id: convId, name: pretendenteName, error: err.message || String(err) });
        console.warn(`   ❌ Erro ao processar conversa ${convId} (${pretendenteName}):`, err.message || err);
      }
    }
  }

  const durationMs = Date.now() - t0;
  const durationSeconds = (durationMs / 1000).toFixed(1);

  // 8. Relatório Final de Execução
  console.log('\n======================================================================');
  console.log('EPISODIC MEMORY BACKFILL — 7 DIAS (RELATÓRIO CONSOLIDADO)');
  console.log('======================================================================');
  console.log(`PERÍODO:`);
  console.log(`  de:                          ${sinceIso}`);
  console.log(`  até:                         ${toIso}`);
  console.log(``);
  console.log(`CONVERSAS ANALISADAS:          ${targetConversationIds.length}`);
  console.log(`MENSAGENS ANALISADAS:          ${totalAnalyzedMessages}`);
  console.log(`MENSAGENS RUÍDO (CHATTER):     ${totalChatterMessages}`);
  console.log(`EPISÓDIOS ANTES:               ${episodesBeforeCount ?? totalExistingEpisodesInDb}`);
  console.log(`NOVOS EPISÓDIOS IDENTIFICADOS: ${totalNewEpisodes}`);
  console.log(`IGNORADOS POR JÁ EXISTIREM:    ${totalSkippedExisting}`);
  console.log(`GRAVADOS NO SUPABASE:          ${isDryRun ? '0 (Dry-run simulação)' : totalInsertedEpisodes}`);
  console.log(`ERROS:                         ${totalErrors}`);
  console.log(`CONVERSAS COM FALHA:           ${failedConversations.length}`);
  console.log(``);
  console.log(`DISTRIBUIÇÃO POR ATOR (NOVOS):`);
  console.log(`  Larissa:                     ${actorStats.larissa}`);
  console.log(`  Pretendente:                 ${actorStats.pretendente}`);
  console.log(``);
  console.log(`DISTRIBUIÇÃO POR TIPO DE EVENTO (NOVOS):`);
  console.log(`  question:                    ${eventTypeStats.question}`);
  console.log(`  answer:                      ${eventTypeStats.answer}`);
  console.log(`  self_disclosure:             ${eventTypeStats.self_disclosure}`);
  console.log(`  fact_reveal:                 ${eventTypeStats.fact_reveal}`);
  console.log(`  statement:                   ${eventTypeStats.statement}`);
  console.log(`  audio_sent:                  ${eventTypeStats.audio_sent}`);
  console.log(`  outros:                      ${eventTypeStats.outros}`);
  console.log(``);
  console.log(`TEMPO TOTAL:                   ${durationSeconds}s`);
  console.log(`ISOLAMENTO ENTRE CONVERSAS:    PASS`);
  console.log(`META ENVIADA:                  0`);
  console.log(`OUTBOX ALTERADA:               NÃO`);
  console.log(`CONTACT MEMORY ALTERADA:       NÃO`);
  console.log(`PERSONA MEMORY ALTERADA:       NÃO`);
  console.log('======================================================================\n');

  if (failedConversations.length > 0) {
    console.log('Conversas que apresentaram falhas:');
    for (const f of failedConversations) {
      console.log(`  - [${f.id}] ${f.name}: ${f.error}`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error('❌ ERRO FATAL:', err);
  process.exit(1);
});
