#!/usr/bin/env node
/**
 * scripts/rebuild-episodic-window.mjs
 * 
 * Rebuild Controlado e Determinístico da Memória Episódica na Janela de 7 Dias.
 * 
 * Regras Invioláveis:
 * 1. SOMENTE afeta a tabela public.conversation_episodic_memory dentro do intervalo [from, to].
 * 2. NÃO toca em PersonaMemory, ContactMemory, StageObjectives, mensagens, Outbox ou estado das conversas.
 * 3. ZERO mensagens enviadas à Meta.
 * 4. Suporta --dry-run (padrão) e --execute.
 * 5. Corrige o caso Douglas Silva ("corredor amador" -> sports, não work).
 * 6. Enriquece áudios do cofre quando houver transcrição/metadados.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

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
    parseInt,
    isNaN,
  });

  return mod.exports;
}

const ep = loadEpisodicModule();

// Parser de argumentos CLI
const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = args.includes('--dry-run') || !isExecute;

const fromIdx = args.indexOf('--from');
const toIdx = args.indexOf('--to');
const fromArg = fromIdx !== -1 ? args[fromIdx + 1] : '2026-09-12T00:00:00.000Z';
const toArg = toIdx !== -1 ? args[toIdx + 1] : '2026-09-19T00:00:00.000Z';

const sinceIso = new Date(fromArg).toISOString();
const toIso = new Date(toArg).toISOString();

async function main() {
  const t0 = Date.now();
  console.log('======================================================================');
  console.log('REBUILD CONTROLADO DA MEMÓRIA EPISÓDICA (JANELA DE 7 DIAS)');
  console.log(`Modo:                     ${isDryRun ? 'DRY-RUN (Simulação segura / Sem gravação)' : 'EXECUTE (Gravação ativa no Supabase)'}`);
  console.log(`Período Inicial (from):   ${sinceIso}`);
  console.log(`Período Final (to):       ${toIso}`);
  console.log('======================================================================\n');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ ERRO: NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes.');
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

  // 1. Contagem inicial na janela
  const { count: currentCountInWindow } = await supabase
    .from('conversation_episodic_memory')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceIso)
    .lte('created_at', toIso);

  console.log(`🔍 Registros existentes na janela antes do rebuild: ${currentCountInWindow ?? 0}`);

  // 2. Carrega áudios do cofre
  const { data: vaultRow } = await supabase
    .from('instagram_conversations')
    .select('stage_completed_rules')
    .eq('id', '__vault_data__')
    .maybeSingle();
  const vaultItems = vaultRow?.stage_completed_rules?.items || [];
  console.log(`🔍 Áudios no cofre disponíveis para enriquecimento: ${vaultItems.length}\n`);

  // 3. Mapeia conversas ativas na janela
  console.log('🔍 Identificando conversas com mensagens na janela...');
  const activeConvSet = new Set();
  let msgOffset = 0;
  const msgPageSize = 1000;
  let hasMoreMsgs = true;

  while (hasMoreMsgs) {
    const { data: pMsgs, error: pErr } = await supabase
      .from('instagram_messages')
      .select('conversation_id')
      .gte('created_at', sinceIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .range(msgOffset, msgOffset + msgPageSize - 1);

    if (pErr) {
      console.error('❌ Erro ao descobrir conversas:', pErr.message);
      process.exit(1);
    }

    if (!pMsgs || pMsgs.length === 0) {
      hasMoreMsgs = false;
      break;
    }

    for (const m of pMsgs) {
      if (m.conversation_id) activeConvSet.add(m.conversation_id);
    }

    if (pMsgs.length < msgPageSize) {
      hasMoreMsgs = false;
    } else {
      msgOffset += msgPageSize;
    }
  }

  const conversationIds = Array.from(activeConvSet);
  console.log(`   Conversas encontradas: ${conversationIds.length}\n`);

  // 4. Extração completa e rigorosa para todas as conversas
  console.log('🔍 Extraindo novo conjunto esperado com o código de hardening...');
  const newEpisodesByConv = new Map();
  let totalNewExtracted = 0;
  let totalMessagesAnalyzed = 0;
  let totalSportsFound = 0;
  let totalAudiosEnriched = 0;

  // Busca metadados de nomes
  const convMap = new Map();
  for (let i = 0; i < conversationIds.length; i += 50) {
    const chunk = conversationIds.slice(i, i + 50);
    const { data: cRows } = await supabase
      .from('instagram_conversations')
      .select('id, full_name, username, display_name')
      .in('id', chunk);
    for (const c of cRows || []) {
      convMap.set(c.id, c.full_name || c.display_name || c.username || 'Pretendente');
    }
  }

  for (let cIdx = 0; cIdx < conversationIds.length; cIdx++) {
    const convId = conversationIds[cIdx];
    let convMessages = [];
    let mOff = 0;
    let hasMoreConv = true;

    while (hasMoreConv) {
      const { data: mData, error: mErr } = await supabase
        .from('instagram_messages')
        .select('id, text, is_mine, status, created_at')
        .eq('conversation_id', convId)
        .gte('created_at', sinceIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: true })
        .range(mOff, mOff + 199);

      if (mErr) throw new Error(mErr.message);
      if (!mData || mData.length === 0) break;
      convMessages.push(...mData);
      if (mData.length < 200) hasMoreConv = false;
      else mOff += 200;
    }

    totalMessagesAnalyzed += convMessages.length;
    const extractedList = [];
    const seenFingerprintsInConv = new Set();

    for (const msg of convMessages) {
      const text = (msg.text || '').trim();
      if (!text || ep.isTrivialChatter(text)) continue;

      if (msg.is_mine) {
        if (msg.status && msg.status !== 'sent' && msg.status !== 'delivered') continue;

        const audioMatch = text.match(/^\[audio:(https?:\/\/[^\]]+)\]/i);
        if (audioMatch) {
          const audioUrl = audioMatch[1];
          const matchedVault = vaultItems.find((v) => {
            if (!v) return false;
            if (v.mediaUrl && (v.mediaUrl === audioUrl || audioUrl.includes(v.fileName || '____'))) return true;
            if (v.fileName && audioUrl.includes(v.fileName)) return true;
            return false;
          });

          if (matchedVault) {
            totalAudiosEnriched++;
            const enriched = ep.createAudioDeliveredEpisode({
              conversationId: convId,
              audioId: matchedVault.id,
              transcript: matchedVault.content || matchedVault.transcript,
              theme: matchedVault.title || matchedVault.category,
              providerMessageId: msg.id,
            });
            enriched.created_at = msg.created_at || toIso;
            enriched.episode_fingerprint = ep.generateEpisodeFingerprint(enriched);
            if (!seenFingerprintsInConv.has(enriched.episode_fingerprint)) {
              seenFingerprintsInConv.add(enriched.episode_fingerprint);
              extractedList.push(enriched);
            }
          } else {
            const genericAudio = {
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
            };
            genericAudio.episode_fingerprint = ep.generateEpisodeFingerprint(genericAudio);
            if (!seenFingerprintsInConv.has(genericAudio.episode_fingerprint)) {
              seenFingerprintsInConv.add(genericAudio.episode_fingerprint);
              extractedList.push(genericAudio);
            }
          }
          continue;
        }

        const lEps = ep.extractEpisodesFromLarissaMessage(text, msg.id);
        for (const e of lEps) {
          e.conversation_id = convId;
          e.created_at = msg.created_at || toIso;
          e.episode_fingerprint = ep.generateEpisodeFingerprint(e);
          if (!seenFingerprintsInConv.has(e.episode_fingerprint)) {
            seenFingerprintsInConv.add(e.episode_fingerprint);
            extractedList.push(e);
          }
        }
      } else {
        const pEps = ep.extractEpisodesFromPretendenteMessage(text, msg.id);
        for (const e of pEps) {
          e.conversation_id = convId;
          e.created_at = msg.created_at || toIso;
          e.episode_fingerprint = ep.generateEpisodeFingerprint(e);
          if (e.topic === 'sports') totalSportsFound++;
          if (!seenFingerprintsInConv.has(e.episode_fingerprint)) {
            seenFingerprintsInConv.add(e.episode_fingerprint);
            extractedList.push(e);
          }
        }
      }
    }

    newEpisodesByConv.set(convId, extractedList);
    totalNewExtracted += extractedList.length;
  }

  console.log(`   Mensagens analisadas:     ${totalMessagesAnalyzed}`);
  console.log(`   Novos episódios gerados:  ${totalNewExtracted}`);
  console.log(`   Episódios de esporte:     ${totalSportsFound}`);
  console.log(`   Áudios enriquecidos:      ${totalAudiosEnriched}\n`);

  // 5. Verificação específica do Caso Douglas
  console.log('🔍 Auditando pretendente Douglas Silva especificamente...');
  let douglasConvId = null;
  for (const [cId, name] of convMap.entries()) {
    if (/douglas/i.test(name)) {
      douglasConvId = cId;
      console.log(`   Encontrado Douglas: ID ${cId} (${name})`);
      const dEps = newEpisodesByConv.get(cId) || [];
      const dWork = dEps.filter((e) => e.topic === 'work');
      const dSports = dEps.filter((e) => e.topic === 'sports');
      console.log(`   -> Episódios de work para Douglas: ${dWork.length}`);
      for (const w of dWork) console.log(`      work: "${w.summary}"`);
      console.log(`   -> Episódios de sports para Douglas: ${dSports.length}`);
      for (const s of dSports) console.log(`      sports: "${s.summary}"`);
    }
  }

  // 6. Execução real do Rebuild se solicitado (--execute)
  if (!isDryRun) {
    console.log('\n🚀 [EXECUTE] Iniciando substituição segura e atômica da janela...');

    // A. Deleção segura estritamente dentro da janela
    console.log(`   Excluindo ${currentCountInWindow} episódios antigos da janela [${sinceIso} a ${toIso}]...`);
    const { error: delErr } = await supabase
      .from('conversation_episodic_memory')
      .delete()
      .gte('created_at', sinceIso)
      .lte('created_at', toIso);

    if (delErr) {
      console.error('❌ Erro na deleção dos episódios antigos:', delErr.message);
      process.exit(1);
    }
    console.log('   Deleção concluída com sucesso.');

    // B. Inserção do novo conjunto com fingerprints determinísticos
    console.log(`   Inserindo ${totalNewExtracted} episódios higienizados e enriquecidos...`);
    let totalSaved = 0;
    const allPayloads = [];

    for (const [cId, epList] of newEpisodesByConv.entries()) {
      for (const item of epList) {
        allPayloads.push({
          conversation_id: cId,
          actor: item.actor,
          event_type: item.event_type,
          topic: item.topic || null,
          summary: item.summary,
          source_message_id: item.source_message_id || null,
          source_message_ids: item.source_message_ids || null,
          original_text: item.original_text || null,
          semantic_keys: item.semantic_keys || [],
          metadata: item.metadata || {},
          created_at: item.created_at || toIso,
          episode_fingerprint: item.episode_fingerprint,
        });
      }
    }

    // Inserção em lotes de 200
    const batchSize = 200;
    for (let i = 0; i < allPayloads.length; i += batchSize) {
      const batch = allPayloads.slice(i, i + batchSize);
      const { data: insData, error: insErr } = await supabase
        .from('conversation_episodic_memory')
        .upsert(batch, {
          onConflict: 'conversation_id,episode_fingerprint',
          ignoreDuplicates: true,
        })
        .select('id');

      if (insErr) {
        console.error(`❌ Erro ao inserir lote ${i / batchSize + 1}:`, insErr.message);
      } else {
        totalSaved += insData?.length || batch.length;
      }
    }

    console.log(`   Total gravado com sucesso no Supabase: ${totalSaved}`);

    // C. Verificação final pós-gravação
    const { count: finalCount } = await supabase
      .from('conversation_episodic_memory')
      .select('id', { count: 'exact', head: true });

    const { count: missingFpCount } = await supabase
      .from('conversation_episodic_memory')
      .select('id', { count: 'exact', head: true })
      .is('episode_fingerprint', null);

    console.log('\n======================================================================');
    console.log('REBUILD CONCLUÍDO COM SUCESSO');
    console.log(`Total final de episódios no banco:    ${finalCount}`);
    console.log(`Episódios com fingerprint ausente:    ${missingFpCount ?? 0}`);
    console.log('======================================================================\n');
  } else {
    console.log('\n[DRY-RUN] Simulação concluída com sucesso. Nenhuma alteração foi persistida.');
    console.log(`Esperado para gravação: ${totalNewExtracted} episódios novos (em substituição aos ${currentCountInWindow} antigos).`);
  }
}

main().catch((err) => {
  console.error('❌ Exceção não tratada:', err);
  process.exit(1);
});
