#!/usr/bin/env node
/**
 * scripts/audit-old-episodic-memory.mjs
 * 
 * Auditoria READ-ONLY dos episódios existentes na tabela conversation_episodic_memory.
 * NÃO altera nada, NÃO exclui nada. Apenas diagnostica.
 */

import fs from 'node:fs';
import path from 'node:path';

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

async function runAudit() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  console.log('======================================================================');
  console.log('AUDITORIA READ-ONLY DOS EPISÓDIOS NA CONVERSATION_EPISODIC_MEMORY');
  console.log('======================================================================\n');

  // 1. Paginação para buscar todos os registros existentes
  let allEpisodes = [];
  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('conversation_episodic_memory')
      .select('*')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('❌ Erro ao paginar episódios:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    allEpisodes.push(...data);
    if (data.length < pageSize) {
      hasMore = false;
    } else {
      offset += pageSize;
    }
  }

  console.log(`Total de episódios no banco: ${allEpisodes.length}`);

  // 2. Análise de fingerprints ausentes
  const missingFingerprint = allEpisodes.filter((e) => !e.episode_fingerprint);
  console.log(`Episódios com episode_fingerprint ausente: ${missingFingerprint.length}`);

  // 3. Análise de audio_sent sem topic ou semantic_keys adequados
  const audioEpisodes = allEpisodes.filter((e) => e.event_type === 'audio_sent');
  const audioGenericTopic = audioEpisodes.filter((e) => !e.topic || e.topic === 'audio');
  const audioMissingThemeKeys = audioEpisodes.filter((e) => {
    const keys = e.semantic_keys || [];
    return !keys.some((k) => k.startsWith('audio.topic.') || k.startsWith('larissa.education') || k.startsWith('larissa.raffle'));
  });

  console.log(`Episódios de áudio total: ${audioEpisodes.length}`);
  console.log(`  - Com topic genérico ('audio'): ${audioGenericTopic.length}`);
  console.log(`  - Sem semantic_keys enriquecidas: ${audioMissingThemeKeys.length}`);

  // 4. Análise de work contendo termos esportivos (ex: corredor amador)
  const workWithSports = allEpisodes.filter((e) => {
    if (e.topic !== 'work') return false;
    const summary = (e.summary || '').toLowerCase();
    const orig = (e.original_text || '').toLowerCase();
    return /\b(corredor|ciclista|atleta|maratonista|muscula|futebol|crossfit)\b/i.test(summary) ||
           /\b(corredor|ciclista|atleta|maratonista|muscula|futebol|crossfit)\b/i.test(orig);
  });

  console.log(`Episódios de work contendo termos esportivos: ${workWithSports.length}`);
  for (const item of workWithSports) {
    console.log(`   [ID ${item.id}] conv=${item.conversation_id}: "${item.summary}" (original: "${item.original_text}")`);
  }

  // 5. Análise de work contendo preposição de cidade ("de lavras", etc.)
  const workWithCityPrep = allEpisodes.filter((e) => {
    if (e.topic !== 'work') return false;
    const summary = (e.summary || '').toLowerCase();
    return /\b(trabalha com de |sou de |trabalha com aqui|trabalha com la)\b/i.test(summary);
  });
  console.log(`Episódios de work com preposição de cidade/lugar: ${workWithCityPrep.length}`);
  for (const item of workWithCityPrep) {
    console.log(`   [ID ${item.id}] conv=${item.conversation_id}: "${item.summary}" (original: "${item.original_text}")`);
  }

  // 6. Colisões semânticas ou fingerprints duplicados
  const fpMap = new Map();
  const duplicateFps = [];
  for (const ep of allEpisodes) {
    if (ep.episode_fingerprint) {
      const k = `${ep.conversation_id}::${ep.episode_fingerprint}`;
      if (fpMap.has(k)) {
        duplicateFps.push({ k, first: fpMap.get(k), current: ep.id });
      } else {
        fpMap.set(k, ep.id);
      }
    }
  }
  console.log(`Fingerprints duplicados encontrados: ${duplicateFps.length}`);

  // 7. Exemplos de registros potencialmente obsoletos
  const obsoleteCandidates = [
    ...workWithSports,
    ...workWithCityPrep,
  ];

  console.log(`\nTotal de registros com anomalias semânticas identificadas: ${obsoleteCandidates.length}`);
  console.log('======================================================================\n');
}

runAudit().catch(console.error);
