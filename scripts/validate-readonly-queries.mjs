#!/usr/bin/env node
/**
 * scripts/validate-readonly-queries.mjs
 * 
 * Validação READ-ONLY de consultas semânticas na Memória Episódica.
 * Testa Moose, Douglas Silva e 5 outras conversas recentes.
 * 
 * Consultas:
 * 1. "já perguntei profissão?"
 * 2. "ele já falou onde mora?"
 * 3. "já falei meu curso?"
 * 4. "já mandei áudio sobre faculdade?"
 * 5. "já falei de filhos em áudio?"
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

const queries = [
  'já perguntei profissão?',
  'ele já falou onde mora?',
  'já falei meu curso?',
  'já mandei áudio sobre faculdade?',
  'já falei de filhos em áudio?',
];

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

  console.log('======================================================================');
  console.log('VALIDAÇÃO READ-ONLY DA MEMÓRIA EPISÓDICA (7 CONVERSAS REAIS)');
  console.log('======================================================================\n');

  // Identifica as conversas alvo
  const targetTargets = [
    { name: 'Moose', pattern: /moose/i },
    { name: 'Douglas Silva', pattern: /^douglas silva$/i },
    { name: 'Gabriel', pattern: /^gabriel$/i },
    { name: 'Daniel', pattern: /^daniel$/i },
    { name: 'João Victor Calazans', pattern: /calazans/i },
    { name: 'Pablo Damasceno', pattern: /damasceno/i },
    { name: 'Alexandre Gindre', pattern: /gindre/i },
  ];

  const resolvedTargets = [];

  for (const t of targetTargets) {
    const { data: cList } = await supabase
      .from('instagram_conversations')
      .select('id, full_name, username, display_name')
      .limit(300);

    const found = (cList || []).find((c) => {
      const fn = c.full_name || '';
      const un = c.username || '';
      const dn = c.display_name || '';
      return t.pattern.test(fn) || t.pattern.test(un) || t.pattern.test(dn);
    });

    if (found) {
      resolvedTargets.push({
        label: t.name,
        id: found.id,
        name: found.full_name || found.display_name || found.username,
      });
    }
  }

  console.log(`Conversas mapeadas para validação: ${resolvedTargets.length}\n`);

  let allQueriesPassed = true;

  for (const target of resolvedTargets) {
    console.log(`----------------------------------------------------------------------`);
    console.log(`CONVERSA: ${target.label} (ID: ${target.id} | Nome: "${target.name}")`);
    console.log(`----------------------------------------------------------------------`);

    // Busca episódios totais da conversa no banco
    const { data: convEpisodes } = await supabase
      .from('conversation_episodic_memory')
      .select('*')
      .eq('conversation_id', target.id)
      .order('created_at', { ascending: false });

    console.log(`Total de episódios gravados nesta conversa: ${convEpisodes?.length || 0}`);

    for (const q of queries) {
      const results = await ep.searchConversationEpisodicMemory({
        supabase,
        conversationId: target.id,
        query: q,
        limit: 3,
      });

      console.log(`\n  Q: "${q}" -> Encontrados: ${results.length}`);
      if (results.length > 0) {
        for (const r of results) {
          console.log(`     [${r.actor}::${r.event_type}::${r.topic || 'none'}] (relevance: ${r.relevance})`);
          console.log(`     "${r.summary}"`);
        }
      } else {
        console.log(`     (Nenhum episódio relevante para este contato)`);
      }

      // Validação estrita: "já falei de filhos em áudio?" NUNCA pode retornar áudio de faculdade
      if (q === 'já falei de filhos em áudio?') {
        const falsePositive = results.some((r) => r.event_type === 'audio_sent' && r.topic !== 'children');
        if (falsePositive) {
          console.error(`     ❌ ERRO: Falso positivo de áudio detectado em "${q}"!`);
          allQueriesPassed = false;
        }
      }
    }
    console.log('\n');
  }

  console.log('======================================================================');
  console.log(`RESULTADO DA VALIDAÇÃO READ-ONLY: ${allQueriesPassed ? '100% PASS' : 'FAIL'}`);
  console.log('======================================================================');
}

main().catch(console.error);
